/**
 * Helpers purs de titrage des pages Notion (LOT 2).
 *  - Magasins : « Lot N°<n> - <n° et rue> » (ou juste « <n° et rue> » sans lot).
 *  - Offres   : « Offre de <broker> du <JJ/MM/AAAA> à <adresse> ».
 */
import { normalizeKey } from "../util/normalize.js";

/** ISO (YYYY-MM-DD…) → JJ/MM/AAAA. Renvoie "" si non parsable. */
export function formatDateFr(iso: string | null | undefined): string {
  if (!iso) return "";
  const m = /^(\d{4})-(\d{2})-(\d{2})/.exec(iso.trim());
  if (m) return `${m[3]}/${m[2]}/${m[1]}`;
  const d = new Date(iso);
  if (!Number.isNaN(d.getTime())) {
    return `${String(d.getDate()).padStart(2, "0")}/${String(d.getMonth() + 1).padStart(2, "0")}/${d.getFullYear()}`;
  }
  return "";
}

/**
 * Numéro de lot = qualité d'emplacement, repérée dans `observations`
 * (« Emplacement : Numéro 1 », « n°1 bis »…). Renvoie "1", "1 bis"… ou null.
 */
export function parseLotNumber(observations: string | null | undefined): string | null {
  if (!observations) return null;
  const m = /(?:n[°ºo]\s*|num[ée]ro\s+)(\d+)\s*(bis|ter)?/i.exec(observations);
  if (!m) return null;
  const suffix = m[2] ? ` ${m[2].toLowerCase()}` : "";
  return `${m[1]}${suffix}`;
}

/** Adresse de voirie sans CP/ville : « 15 rue Sommeiller, 74000 Annecy » → « 15 rue Sommeiller ». */
export function streetOnly(address: string | null | undefined): string | null {
  if (!address) return null;
  let s = address.trim();
  if (s.includes(",")) s = s.split(",")[0]!.trim();
  // retirer un CP (5 chiffres) et ce qui suit s'il reste collé
  s = s.replace(/\s+\d{5}\b.*$/, "").trim();
  return s || null;
}

export function buildMagasinTitle(input: {
  observations?: string | null;
  adresse?: string | null;
  nom?: string | null;
}): string {
  const streetOrName = streetOnly(input.adresse) ?? input.nom?.trim() ?? "Local";
  const lot = parseLotNumber(input.observations);
  return lot ? `Lot N°${lot} - ${streetOrName}` : streetOrName;
}

export function buildOffreTitle(input: {
  brokerName?: string | null;
  dateIso?: string | null;
  magasinAddress?: string | null;
}): string {
  const date = formatDateFr(input.dateIso);
  const adresse = (input.magasinAddress ?? "").trim();
  const parts = ["Offre"];
  if (input.brokerName?.trim()) parts.push(`de ${input.brokerName.trim()}`);
  if (date) parts.push(`du ${date}`);
  if (adresse) parts.push(`à ${adresse}`);
  return parts.join(" ");
}

/** Compare deux libellés de lieu (ville/pays/centre) en tolérant casse/accents/St(.)→Saint. */
export function placeKey(s: string | null | undefined): string {
  if (!s) return "";
  let k = normalizeKey(s);
  k = k.replace(/\bST\b/g, "SAINT").replace(/\bSTE\b/g, "SAINTE");
  return k;
}
