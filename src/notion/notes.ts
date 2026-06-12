/**
 * Construction des Notes en rich text Notion (LOT 9) — ton « compte-rendu de
 * stagiaire », factuel, avec de VRAIES mentions de page (@Magasin, @Emplacement,
 * @Broker, @Contact, @Ville) et des hyperliens Azure vers les documents.
 *
 * Déterministe (pas d'appel IA séparé) : on assemble des phrases à partir de faits
 * réels, sans rien inventer ; une info absente n'est pas mentionnée. Peut évoluer
 * vers une narration Sonnet plus tard sans changer la signature.
 *
 * ⚠️ Les mentions exigent les IDs des pages → ces Notes se rédigent APRÈS création
 * des pages (cf. ordre pipeline).
 */
export type RichText = Record<string, unknown>;

const t = (content: string): RichText => ({ type: "text", text: { content } });
const link = (label: string, url: string): RichText => ({
  type: "text",
  text: { content: label, link: { url } },
});
const pageMention = (id: string): RichText => ({
  type: "mention",
  mention: { type: "page", page: { id } },
});

function eur(n: number): string {
  return `${n.toLocaleString("fr-FR")} €`;
}

/** Intercale un séparateur entre des fragments rich text. */
function join(items: RichText[][], sep: string): RichText[] {
  const out: RichText[] = [];
  items.forEach((frag, i) => {
    if (i > 0) out.push(t(sep));
    out.push(...frag);
  });
  return out;
}

export interface MagasinNotesParams {
  brokerName?: string | null;
  brokerId?: string | null;
  contactId?: string | null;
  magasinId?: string | null;
  emplacementId?: string | null;
  villeId?: string | null;
  centreName?: string | null;
  dateFr?: string | null;
  surfacePonderee?: number | null;
  loyer?: number | null;
  bodyExcerpt?: string | null;
  documents?: { name: string; url: string }[] | null;
}

export function buildMagasinNotesRichText(p: MagasinNotesParams): RichText[] {
  const rt: RichText[] = [];

  // Qui a envoyé quoi, quand.
  rt.push(p.brokerId ? pageMention(p.brokerId) : t(p.brokerName?.trim() || "Le broker"));
  rt.push(t(" a envoyé une offre"));
  if (p.dateFr) rt.push(t(` le ${p.dateFr}`));
  if (p.emplacementId) {
    rt.push(t(" dans le centre "));
    rt.push(pageMention(p.emplacementId));
  } else if (p.centreName) {
    rt.push(t(` dans le centre ${p.centreName}`));
  }
  if (p.villeId) {
    rt.push(t(" à "));
    rt.push(pageMention(p.villeId));
  }
  rt.push(t(". "));

  if (p.surfacePonderee) rt.push(t(`Surface d'environ ${p.surfacePonderee} m². `));
  if (p.loyer) rt.push(t(`Loyer annuel de ${eur(p.loyer)}. `));

  const excerpt = p.bodyExcerpt?.trim().replace(/\s+/g, " ").slice(0, 300);
  if (excerpt) rt.push(t(`Le mail indique : « ${excerpt} ». `));

  const docs = (p.documents ?? []).filter((d) => d.url);
  if (docs.length) {
    rt.push(t("Documents joints : "));
    rt.push(...join(docs.map((d) => [link(d.name, d.url)]), ", "));
    rt.push(t(". "));
  }

  const created = [p.magasinId, p.emplacementId, p.brokerId, p.contactId].filter(Boolean) as string[];
  if (created.length) {
    rt.push(t("J'ai créé les pages : "));
    rt.push(...join(created.map((id) => [pageMention(id)]), ", "));
    rt.push(t("."));
  }
  return rt;
}

export interface OffreNotesParams {
  brokerName?: string | null;
  brokerId?: string | null;
  dateFr?: string | null;
  magasinIds?: string[] | null;
  emplacementId?: string | null;
  source?: { name: string; url: string } | null;
}

export function buildOffreNotesRichText(p: OffreNotesParams): RichText[] {
  const rt: RichText[] = [];
  rt.push(p.brokerId ? pageMention(p.brokerId) : t(p.brokerName?.trim() || "Le broker"));
  rt.push(t(" a transmis cette offre"));
  if (p.dateFr) rt.push(t(` le ${p.dateFr}`));
  rt.push(t(". "));

  const mags = (p.magasinIds ?? []).filter(Boolean);
  if (mags.length) {
    rt.push(t(mags.length > 1 ? "Locaux concernés : " : "Local concerné : "));
    rt.push(...join(mags.map((id) => [pageMention(id)]), ", "));
    rt.push(t(". "));
  }
  if (p.emplacementId) {
    rt.push(t("Centre : "));
    rt.push(pageMention(p.emplacementId));
    rt.push(t(". "));
  }
  if (p.source?.url) {
    rt.push(t("Document source : "));
    rt.push(link(p.source.name || "document", p.source.url));
    rt.push(t("."));
  }
  return rt;
}
