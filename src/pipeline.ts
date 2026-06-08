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
import { createMagasin } from "./notion/magasins.js";
import { createOffre } from "./notion/offres.js";
import { pageUrl } from "./notion/client.js";
import { notifySuccess, notifyFailure } from "./mail/reply.js";
import { isProcessed, markProcessed, logRouting } from "./state/supabase.js";
import { technicalGuard } from "./guard.js";
import { offerGranularity } from "./config.js";
import { log } from "./log.js";

export type Outcome = "success" | "noise" | "failed" | "skipped";

export async function processMail(mail: IncomingMail): Promise<Outcome> {
  // a. déjà traité ?
  if (await isProcessed(mail.id)) {
    log.info("pipeline: déjà traité, skip", { id: mail.id });
    return "skipped";
  }

  // b. garde-fou technique
  const guard = technicalGuard(mail);
  if (guard.drop) {
    log.info("pipeline: écarté par le garde-fou", { id: mail.id, reason: guard.reason });
    await markProcessed({ messageId: mail.id, status: "skipped", error: guard.reason });
    return "skipped";
  }

  // c. extraction multi-format (déterministe)
  const content = await routeExtraction(mail);

  // d. classification / routage (Haiku)
  const cls = await classifyMail(mail, content);
  await logRouting({
    messageId: mail.id,
    route: cls.route,
    typeOffre: cls.type_offre,
    confiance: cls.confiance,
    raison: cls.raison,
  });

  if (cls.route === "bruit") {
    await notifyFailure(mail.id);
    await markProcessed({ messageId: mail.id, route: "bruit", status: "noise", error: cls.raison });
    return "noise";
  }

  // e. extraction structurée (Sonnet)
  let ext: Extraction;
  try {
    ext = await extractOffer(mail, content);
  } catch (err) {
    log.error("pipeline: extraction échouée", { id: mail.id, err: String(err) });
    await notifyFailure(mail.id, "Extraction impossible.");
    await markProcessed({ messageId: mail.id, route: cls.route, status: "failed", error: String(err) });
    return "failed";
  }

  if (!ext.locaux || ext.locaux.length === 0) {
    await notifyFailure(mail.id, "Aucun local exploitable détecté.");
    await markProcessed({ messageId: mail.id, route: cls.route, status: "failed", error: "0 local" });
    return "failed";
  }

  try {
    const offreId = await writeToNotion(mail, content, ext, cls.type_offre);
    await notifySuccess(mail.id, pageUrl(offreId));
    await markProcessed({
      messageId: mail.id,
      route: cls.route,
      nbLocaux: ext.locaux.length,
      notionOffreId: offreId,
      status: "success",
    });
    return "success";
  } catch (err) {
    log.error("pipeline: écriture Notion échouée", { id: mail.id, err: String(err) });
    await notifyFailure(mail.id, "Écriture Notion impossible.");
    await markProcessed({ messageId: mail.id, route: cls.route, status: "failed", error: String(err) });
    return "failed";
  }
}

async function writeToNotion(
  mail: IncomingMail,
  content: Awaited<ReturnType<typeof routeExtraction>>,
  ext: Extraction,
  typeOffre: string
): Promise<string> {
  // 1. Upload des médias (plans/photos) + matching → local.
  const localKeys = ext.locaux.map((l) =>
    normalizeKey(`${l.nom ?? ""} ${l.adresse_complete ?? ""}`)
  );
  const docsByLocal = new Map<number, UploadedFile[]>();
  const plansByLocal = new Map<number, UploadedFile[]>();
  for (const m of content.media) {
    if (!m.attachment.content) continue;
    let idx = matchMediaToLocal(m, localKeys);
    if (idx < 0 && ext.locaux.length === 1) idx = 0; // un seul local → tout lui revient
    if (idx < 0) continue;
    const uploaded = await uploadFile(mail.id, m.attachment.name, m.attachment.content, m.attachment.contentType);
    const bucket = m.role === "plan" ? plansByLocal : docsByLocal;
    const arr = bucket.get(idx) ?? [];
    arr.push(uploaded);
    bucket.set(idx, arr);
  }

  // 2. Upload du document source principal (xlsx/pdf) pour le lien Offre.
  let source: UploadedFile | null = null;
  const mainDoc = content.dataDocs.find((d) => d.attachment.content);
  if (mainDoc?.attachment.content) {
    source = await uploadFile(mail.id, mainDoc.attachment.name, mainDoc.attachment.content, mainDoc.attachment.contentType);
  }

  // 3. Résolution Contact → Broker.
  const { brokerId } = await resolveContactAndBroker(ext.broker);

  // 4. Emplacement (centre) si applicable.
  let emplacementId: string | null = null;
  if (ext.centre && ext.centre.nom) {
    emplacementId = await resolveEmplacement(ext.centre);
  }

  // 5. Création des N Magasins.
  const magasinIds: string[] = [];
  for (let i = 0; i < ext.locaux.length; i++) {
    const id = await createMagasin(ext.locaux[i]!, {
      brokerId,
      emplacementId,
      documents: docsByLocal.get(i),
      plans: plansByLocal.get(i),
    });
    magasinIds.push(id);
  }

  // 6. Création de l'Offre (1 par lot par défaut, ou 1 par local).
  const dateIso = mail.receivedAt ? mail.receivedAt.slice(0, 10) : null;
  const notes = ext.locaux
    .map((l) => l.environnement_commercial?.trim())
    .filter(Boolean)
    .join("\n") || null;

  if (offerGranularity() === "local") {
    let firstOffre = "";
    for (let i = 0; i < magasinIds.length; i++) {
      const id = await createOffre({
        nom: ext.locaux[i]!.nom,
        magasinIds: [magasinIds[i]!],
        brokerId,
        date: dateIso,
        notes: ext.locaux[i]!.environnement_commercial ?? null,
        source,
      });
      if (!firstOffre) firstOffre = id;
    }
    return firstOffre;
  }

  return createOffre({
    nom: offreTitle(ext, typeOffre),
    magasinIds,
    brokerId,
    date: dateIso,
    notes,
    source,
  });
}

function offreTitle(ext: Extraction, typeOffre: string): string {
  const typeLabel = typeOffre === "cession" ? " — cession" : typeOffre === "location" ? " — location" : "";
  if (ext.centre?.nom) return `${ext.centre.nom}${typeLabel}`;
  if (ext.locaux.length === 1) return ext.locaux[0]!.nom;
  const soc = ext.broker.societe ? ` ${ext.broker.societe}` : "";
  return `Lot${soc}${typeLabel}`.trim();
}
