/**
 * Pipeline de traitement d'UN mail, de bout en bout.
 *
 * Idempotence : tout est gardé par messageId (Supabase). Traiter-ou-rejeter :
 *  - succès → pages Notion créées + mail de confirmation à soi-même,
 *  - bruit / non traitable → rien créé + mail d'échec à soi-même.
 */
import type { IncomingMail } from "./types.js";
import type { Extraction } from "./ai/schemas.js";
import { routeExtraction } from "./extract/router.js";
import { classifyMail } from "./ai/classify.js";
import { extractOffer } from "./ai/extract.js";
import { matchMediaToLocal } from "./extract/attachments.js";
import { normalizeKey } from "./util/normalize.js";
import { uploadFile, type UploadedFile } from "./storage/azureBlob.js";
import { resolveContactAndBroker } from "./notion/resolve.js";
import { resolveEmplacement } from "./notion/emplacements.js";
import { createMagasin, patchMagasinNotes } from "./notion/magasins.js";
import { createOffre } from "./notion/offres.js";
import { resolveVille, resolvePays, parseCityFromAddress } from "./notion/places.js";
import { buildOffreTitle, formatDateFr } from "./notion/titles.js";
import { buildMagasinNotesRichText, buildOffreNotesRichText } from "./notion/notes.js";
import { nearbyCities } from "./ai/zone.js";
import { pageUrl } from "./notion/client.js";
import { notifySuccess, notifyFailure, notifyDenseBrochure } from "./mail/reply.js";
import { isProcessed, markProcessed, logRouting, emitEvent } from "./state/supabase.js";
import { technicalGuard } from "./guard.js";
import { isDenseBrochure } from "./dense.js";
import { offerGranularity, denseBrochureMaxCenters, denseBrochureMaxPages } from "./config.js";
import { log, serializeError } from "./log.js";

export type Outcome = "success" | "noise" | "failed" | "skipped";

export async function processMail(mail: IncomingMail): Promise<Outcome> {
  // a. déjà traité ?
  if (await isProcessed(mail.id)) {
    log.info("pipeline: déjà traité, skip", { id: mail.id });
    return "skipped";
  }

  // sujet/expéditeur conservés sur chaque enregistrement (affichage console admin)
  const meta = { subject: mail.subject || null, sender: mail.from.email || mail.from.name || null };
  const mark = (rec: Omit<Parameters<typeof markProcessed>[0], "subject" | "sender">) =>
    markProcessed({ ...rec, ...meta });

  // b. garde-fou technique
  const guard = technicalGuard(mail);
  if (guard.drop) {
    log.info("pipeline: écarté par le garde-fou", { id: mail.id, reason: guard.reason });
    await mark({ messageId: mail.id, status: "skipped", error: guard.reason });
    return "skipped";
  }

  await emitEvent(mail.id, "mail_recu", mail.subject || "(sans objet)");

  // c. extraction multi-format (déterministe)
  await emitEvent(mail.id, "extraction_contenu", "corps, PDF, xlsx, liens, pièces jointes");
  const content = await routeExtraction(mail);

  // d. classification / routage (Haiku)
  await emitEvent(mail.id, "classification", "appel Anthropic (Haiku)");
  const cls = await classifyMail(mail, content);
  await emitEvent(mail.id, "classification_ok", `route=${cls.route} type=${cls.type_offre} confiance=${cls.confiance}`);
  await logRouting({
    messageId: mail.id,
    route: cls.route,
    typeOffre: cls.type_offre,
    confiance: cls.confiance,
    raison: cls.raison,
  });

  if (cls.route === "bruit") {
    await emitEvent(mail.id, "hors_scope", cls.raison);
    await notifyFailure(mail.id);
    await mark({ messageId: mail.id, route: "bruit", status: "noise", error: cls.raison });
    return "noise";
  }

  // e. extraction structurée (Sonnet)
  await emitEvent(mail.id, "extraction_ia", "appel Anthropic (Sonnet)");
  let ext: Extraction;
  try {
    ext = await extractOffer(mail, content);
    await emitEvent(mail.id, "extraction_ia_ok", `${ext.locaux.length} local(aux) extrait(s)`);
  } catch (err) {
    await emitEvent(mail.id, "extraction_ia_echec", serializeError(err), "error");
    log.error("pipeline: extraction échouée", { id: mail.id, err: serializeError(err) });
    await notifyFailure(mail.id, "Extraction impossible.");
    await mark({ messageId: mail.id, route: cls.route, status: "failed", error: serializeError(err) });
    return "failed";
  }

  // e bis. Garde-fou « plaquette dense » : ne PAS extraire en masse, signaler le PDF.
  const maxPdfPages = content.dataDocs.reduce((max, d) => Math.max(max, d.pageCount ?? 0), 0);
  const dense = isDenseBrochure(
    {
      route: cls.route,
      denseFlag: ext.dense_brochure,
      nbCentresEstime: ext.nb_centres_estime,
      nbLocaux: ext.locaux.length,
      maxPdfPages,
    },
    { maxCenters: denseBrochureMaxCenters(), maxPages: denseBrochureMaxPages() }
  );
  if (dense.dense) {
    await emitEvent(mail.id, "plaquette_dense", `~${dense.nbCentres} centres — signalement (pas d'extraction en masse)`, "warn");
    const { offreId, pdfUrl } = await writeDenseTrace(mail, content, ext, dense.nbCentres);
    await notifyDenseBrochure(mail.id, dense.nbCentres, pdfUrl);
    await mark({
      messageId: mail.id,
      route: cls.route,
      nbLocaux: 0,
      notionOffreId: offreId,
      status: "success",
    });
    log.info("pipeline: plaquette dense signalée (pas d'extraction en masse)", { id: mail.id, nbCentres: dense.nbCentres });
    return "success";
  }

  if (!ext.locaux || ext.locaux.length === 0) {
    await notifyFailure(mail.id, "Aucun local exploitable détecté.");
    await mark({ messageId: mail.id, route: cls.route, status: "failed", error: "0 local" });
    return "failed";
  }

  try {
    const { offreId, brokerName } = await writeToNotion(mail, content, ext, cls.type_offre);
    await emitEvent(mail.id, "notification_envoyee", "réponse dans le fil (à soi-même)");
    await notifySuccess(mail.id, pageUrl(offreId), brokerName);
    await mark({
      messageId: mail.id,
      route: cls.route,
      nbLocaux: ext.locaux.length,
      notionOffreId: offreId,
      status: "success",
    });
    await emitEvent(mail.id, "termine", `offre créée : ${pageUrl(offreId)}`);
    return "success";
  } catch (err) {
    await emitEvent(mail.id, "ecriture_notion_echec", serializeError(err), "error");
    log.error("pipeline: écriture Notion échouée", { id: mail.id, err: serializeError(err) });
    await notifyFailure(mail.id, "Écriture Notion impossible.");
    await mark({ messageId: mail.id, route: cls.route, status: "failed", error: serializeError(err) });
    return "failed";
  }
}

/**
 * Trace minimale pour une plaquette dense : on NE crée PAS de Magasins/Emplacements
 * en masse. On uploade le PDF source et on crée une seule page Offre « à traiter
 * manuellement » (État « À étudier ») pointant vers le PDF. Si la création échoue,
 * on renvoie quand même l'URL du PDF pour la notification (l'essentiel = signaler).
 */
async function writeDenseTrace(
  mail: IncomingMail,
  content: Awaited<ReturnType<typeof routeExtraction>>,
  ext: Extraction,
  nbCentres: number
): Promise<{ offreId: string | null; pdfUrl: string | null }> {
  let pdfUrl: string | null = mail.webLink ?? null;
  let source: UploadedFile | null = null;
  const mainDoc = content.dataDocs.find((d) => d.attachment.content);
  if (mainDoc?.attachment.content) {
    try {
      source = await uploadFile(mail.id, mainDoc.attachment.name, mainDoc.attachment.content, mainDoc.attachment.contentType);
      pdfUrl = source.url;
    } catch (err) {
      log.warn("dense: upload PDF source échoué", { id: mail.id, err: serializeError(err) });
    }
  }

  let brokerId: string | null = null;
  try {
    ({ brokerId } = await resolveContactAndBroker(ext.broker));
  } catch (err) {
    log.warn("dense: résolution broker échouée", { id: mail.id, err: serializeError(err) });
  }

  const emetteur = ext.broker.societe ?? "Émetteur inconnu";
  const notes = `Plaquette de portefeuille (~${nbCentres} centres) — traitement automatique non effectué pour préserver la fiabilité. À consulter manuellement. Émetteur : ${emetteur}.`;

  let offreId: string | null = null;
  try {
    offreId = await createOffre({
      nom: `${emetteur} — plaquette portefeuille (à traiter manuellement)`,
      magasinIds: [],
      brokerId,
      date: mail.receivedAt ? mail.receivedAt.slice(0, 10) : null,
      notes,
      source,
    });
  } catch (err) {
    log.warn("dense: création Offre de trace échouée", { id: mail.id, err: serializeError(err) });
  }

  return { offreId, pdfUrl };
}

const MAX_DOCS_PER_LOCAL = 20;
const MAX_PLANS_PER_LOCAL = 10;

/**
 * Écriture Notion dans l'ordre imposé (cf. brief) : résolution Ville/Pays/Emplacement/
 * Broker/Contact → upload fichiers → création Magasins (titre + relations + Documents +
 * Plans + Zone) → création Offre → rédaction des Notes AVEC mentions de page (après
 * création) → renvoi de l'offre + nom du broker pour la notification.
 * Les briques coûteuses/optionnelles (zone de chalandise, résolution de lieu) sont
 * best-effort : un échec n'empêche pas la création de l'offre.
 */
async function writeToNotion(
  mail: IncomingMail,
  content: Awaited<ReturnType<typeof routeExtraction>>,
  ext: Extraction,
  typeOffre: string
): Promise<{ offreId: string; brokerName: string | null }> {
  void typeOffre;
  const dateIso = mail.receivedAt ? mail.receivedAt.slice(0, 10) : null;
  const dateFr = formatDateFr(dateIso);
  const bodyExcerpt = content.bodyText ? content.bodyText.slice(0, 300) : null;

  // 1a. Upload de TOUTES les pièces jointes de données (best-effort), une fois chacune.
  const sharedDocs: UploadedFile[] = [];
  for (const d of content.dataDocs) {
    if (!d.attachment.content) continue;
    try {
      sharedDocs.push(await uploadFile(mail.id, d.attachment.name, d.attachment.content, d.attachment.contentType));
    } catch (err) {
      log.warn("notion: upload document échoué", { name: d.attachment.name, err: serializeError(err) });
    }
  }
  const linkDocs = content.links.map((l) => ({ name: l.url, url: l.url }));
  const source = sharedDocs[0] ?? null;

  // 1b. Médias (plans/photos) → upload + matching local. Les pièces jointes
  // détectées comme PLANS (nom/role, cf. attachments.ts) vont dans « Plan local/CC »
  // (LOT 6). La rastérisation des pages PLAN À L'INTÉRIEUR d'un PDF multi-pages est
  // volontairement différée : elle exige un backend canvas (node-canvas) non embarqué
  // pour garder la fonction serverless légère et stable (best-effort, non bloquant).
  const localKeys = ext.locaux.map((l) => normalizeKey(`${l.nom ?? ""} ${l.adresse_complete ?? ""}`));
  const photosByLocal = new Map<number, UploadedFile[]>();
  const plansByLocal = new Map<number, UploadedFile[]>();
  for (const m of content.media) {
    if (!m.attachment.content) continue;
    let idx = matchMediaToLocal(m, localKeys);
    if (idx < 0 && ext.locaux.length === 1) idx = 0;
    if (idx < 0) continue;
    let up: UploadedFile;
    try {
      up = await uploadFile(mail.id, m.attachment.name, m.attachment.content, m.attachment.contentType);
    } catch (err) {
      log.warn("notion: upload média échoué", { name: m.attachment.name, err: serializeError(err) });
      continue;
    }
    const bucket = m.role === "plan" ? plansByLocal : photosByLocal;
    const arr = bucket.get(idx) ?? [];
    arr.push(up);
    bucket.set(idx, arr);
  }

  await emitEvent(mail.id, "upload_azure", `${sharedDocs.length} document(s), médias inclus`);

  // 2. Broker / Contact.
  const { brokerId, contactId } = await resolveContactAndBroker(ext.broker);
  const brokerName = ext.broker.societe ?? ext.broker.contact.nom_complet ?? null;
  await emitEvent(mail.id, "resolution_broker", brokerName ?? "(broker inconnu)");

  // 3. Pays (partagé, défaut France) — best-effort.
  const paysId = await safe(() => resolvePays(null), null);

  // 4. Emplacement (centre) avec dédoublonnage nom+ville+pays.
  let emplacementId: string | null = null;
  if (ext.centre?.nom) {
    const centreVilleId = await safe(() => resolveVille(parseCityFromAddress(ext.centre!.adresse_complete)), null);
    emplacementId = await safe(
      () => resolveEmplacement(ext.centre!, { villeId: centreVilleId, paysId }),
      null
    );
  }

  // Caches ville + zone de chalandise par nom de ville (évite les appels répétés).
  const villeCache = new Map<string, string | null>();
  const zoneCache = new Map<string, string[]>();
  const cityIds = async (local: Extraction["locaux"][number]) => {
    const city = parseCityFromAddress(local.adresse_complete) ?? parseCityFromAddress(local.nom);
    if (!city) return { villeId: null as string | null, zoneIds: [] as string[] };
    if (!villeCache.has(city)) villeCache.set(city, await safe(() => resolveVille(city), null));
    if (!zoneCache.has(city)) zoneCache.set(city, await resolveZone(city));
    return { villeId: villeCache.get(city) ?? null, zoneIds: zoneCache.get(city) ?? [] };
  };

  // 5. Création des N Magasins (sans rich notes : le self-mention exige l'ID).
  await emitEvent(mail.id, "creation_notion", `création de ${ext.locaux.length} magasin(s) + offre`);
  const magasinIds: string[] = [];
  const perLocalDocs: { name: string; url: string }[][] = [];
  const perLocalVille: (string | null)[] = [];
  for (let i = 0; i < ext.locaux.length; i++) {
    const local = ext.locaux[i]!;
    const { villeId, zoneIds } = await cityIds(local);
    const documents = [...sharedDocs, ...(photosByLocal.get(i) ?? []), ...linkDocs].slice(0, MAX_DOCS_PER_LOCAL);
    const plans = (plansByLocal.get(i) ?? []).slice(0, MAX_PLANS_PER_LOCAL);
    perLocalDocs.push(documents);
    perLocalVille.push(villeId);
    const id = await createMagasin(local, {
      brokerId,
      emplacementId,
      villeId,
      paysId,
      zoneVilleIds: zoneIds,
      documents,
      plans,
    });
    magasinIds.push(id);
  }

  // 6. Création de l'Offre (1 par lot par défaut, ou 1 par local).
  const firstAddr = ext.locaux[0]?.adresse_complete ?? ext.locaux[0]?.nom ?? null;
  let offreId: string;
  if (offerGranularity() === "local") {
    let first = "";
    for (let i = 0; i < magasinIds.length; i++) {
      const local = ext.locaux[i]!;
      const id = await createOffre({
        nom: buildOffreTitle({ brokerName, dateIso, magasinAddress: local.adresse_complete ?? local.nom }),
        magasinIds: [magasinIds[i]!],
        brokerId,
        date: dateIso,
        notesRichText: buildOffreNotesRichText({ brokerName, brokerId, dateFr, magasinIds: [magasinIds[i]!], emplacementId, source }),
        source,
      });
      if (!first) first = id;
    }
    offreId = first;
  } else {
    offreId = await createOffre({
      nom: buildOffreTitle({ brokerName, dateIso, magasinAddress: firstAddr }),
      magasinIds,
      brokerId,
      date: dateIso,
      notesRichText: buildOffreNotesRichText({ brokerName, brokerId, dateFr, magasinIds, emplacementId, source }),
      source,
    });
  }

  // 7. Notes des Magasins AVEC mentions de page (après création de toutes les pages).
  for (let i = 0; i < magasinIds.length; i++) {
    const local = ext.locaux[i]!;
    const rt = buildMagasinNotesRichText({
      brokerName,
      brokerId,
      contactId,
      magasinId: magasinIds[i]!,
      emplacementId,
      villeId: perLocalVille[i] ?? null,
      centreName: ext.centre?.nom ?? null,
      dateFr,
      surfacePonderee: local.surface_ponderee,
      loyer: local.loyer_annuel_fixe,
      bodyExcerpt,
      documents: perLocalDocs[i] ?? [],
    });
    try {
      await patchMagasinNotes(magasinIds[i]!, rt);
    } catch (err) {
      log.warn("notion: patch Notes magasin échoué", { id: magasinIds[i], err: serializeError(err) });
    }
  }

  return { offreId, brokerName };
}

/** Wrapper best-effort : renvoie `fallback` si la promesse échoue (non bloquant). */
async function safe<T>(fn: () => Promise<T>, fallback: T): Promise<T> {
  try {
    return await fn();
  } catch (err) {
    log.warn("notion: étape best-effort échouée", { err: serializeError(err) });
    return fallback;
  }
}

/** Zone de chalandise (LOT 5) : villes ~15 km → relations Villes. Best-effort, borné. */
async function resolveZone(city: string): Promise<string[]> {
  try {
    const names = await nearbyCities(city, "France", 10);
    const ids: string[] = [];
    for (const name of names) {
      const id = await safe(() => resolveVille(name), null);
      if (id) ids.push(id);
    }
    return ids;
  } catch (err) {
    log.warn("notion: zone de chalandise échouée (best-effort)", { city, err: serializeError(err) });
    return [];
  }
}
