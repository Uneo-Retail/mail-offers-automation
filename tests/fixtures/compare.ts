/**
 * Comparaison PARTIELLE et tolérante entre une extraction obtenue et un golden
 * `expected.json`. Seuls les champs présents dans l'attendu sont vérifiés.
 *
 * Conventions de l'attendu :
 *  - valeur numérique → comparée en numérique ;
 *  - valeur `null` → le champ obtenu doit être null/absent (utile pour « pas de prix ») ;
 *  - `telephone` → comparé en chiffres seuls (insensible au format) ;
 *  - chaînes → comparées normalisées (casse/accents/espaces).
 */
import { normalizeKey, digitsOnly } from "../../src/util/normalize.js";
import type { Classification, Extraction, Local } from "../../src/ai/schemas.js";

export interface Check {
  label: string;
  ok: boolean;
  expected: unknown;
  got: unknown;
}

export interface ExpectedLocal {
  /** sous-chaîne identifiant le local (cherchée dans nom + adresse) */
  match: string;
  [field: string]: unknown;
}

export interface Expected {
  route?: Classification["route"];
  type_offre?: Classification["type_offre"];
  nb_locaux?: number;
  centre_present?: boolean;
  broker?: { societe?: string; contact?: { email?: string; telephone?: string } };
  /** contraintes appliquées à CHAQUE local retourné (ex. loyer null) */
  locaux_all?: Record<string, unknown>;
  locaux?: ExpectedLocal[];
}

const NUMERIC_FIELDS = new Set([
  "surface_rdc", "surface_r_moins_1", "surface_r_plus_1", "surface_r_plus_2",
  "surface_ponderee", "loyer_annuel_fixe", "loyer_annuel_variable_pct",
  "charges_locatives_annuelles", "droit_au_bail", "tf_annuelle",
]);

function eqValue(field: string, exp: unknown, got: unknown): boolean {
  if (exp === null) return got === null || got === undefined;
  if (field === "telephone") return digitsOnly(String(got ?? "")) === digitsOnly(String(exp));
  if (typeof exp === "number" || NUMERIC_FIELDS.has(field)) {
    const g = got == null ? NaN : Number(got);
    return Number.isFinite(g) && g === Number(exp);
  }
  if (field === "email") return String(got ?? "").trim().toLowerCase() === String(exp).trim().toLowerCase();
  return normalizeKey(String(got ?? "")) === normalizeKey(String(exp));
}

export function compareClassification(expected: Expected, cls: Classification): Check[] {
  const checks: Check[] = [];
  if (expected.route !== undefined) {
    checks.push({ label: "route", ok: cls.route === expected.route, expected: expected.route, got: cls.route });
  }
  if (expected.type_offre !== undefined) {
    checks.push({ label: "type_offre", ok: cls.type_offre === expected.type_offre, expected: expected.type_offre, got: cls.type_offre });
  }
  return checks;
}

function findLocal(locaux: Local[], match: string): Local | undefined {
  const want = normalizeKey(match);
  return locaux.find((l) => normalizeKey(`${l.nom ?? ""} ${l.adresse_complete ?? ""}`).includes(want));
}

export function compareExtraction(expected: Expected, ext: Extraction): Check[] {
  const checks: Check[] = [];

  if (expected.nb_locaux !== undefined) {
    checks.push({ label: "nb_locaux", ok: ext.locaux.length === expected.nb_locaux, expected: expected.nb_locaux, got: ext.locaux.length });
  }

  if (expected.centre_present !== undefined) {
    const present = ext.centre != null && !!ext.centre.nom;
    checks.push({ label: "centre_present", ok: present === expected.centre_present, expected: expected.centre_present, got: present });
  }

  if (expected.broker) {
    if (expected.broker.societe !== undefined) {
      checks.push({ label: "broker.societe", ok: eqValue("societe", expected.broker.societe, ext.broker.societe), expected: expected.broker.societe, got: ext.broker.societe });
    }
    if (expected.broker.contact?.email !== undefined) {
      checks.push({ label: "broker.contact.email", ok: eqValue("email", expected.broker.contact.email, ext.broker.contact.email), expected: expected.broker.contact.email, got: ext.broker.contact.email });
    }
    if (expected.broker.contact?.telephone !== undefined) {
      checks.push({ label: "broker.contact.telephone", ok: eqValue("telephone", expected.broker.contact.telephone, ext.broker.contact.telephone), expected: expected.broker.contact.telephone, got: ext.broker.contact.telephone });
    }
  }

  if (expected.locaux_all) {
    for (const [field, val] of Object.entries(expected.locaux_all)) {
      const offenders = ext.locaux.filter((l) => !eqValue(field, val, (l as Record<string, unknown>)[field]));
      checks.push({
        label: `locaux_all.${field}`,
        ok: offenders.length === 0,
        expected: `tous = ${JSON.stringify(val)}`,
        got: offenders.length === 0 ? "ok" : `${offenders.length} local(aux) divergent(s)`,
      });
    }
  }

  for (const exp of expected.locaux ?? []) {
    const local = findLocal(ext.locaux, exp.match);
    if (!local) {
      checks.push({ label: `local[${exp.match}]`, ok: false, expected: "trouvé", got: "introuvable" });
      continue;
    }
    for (const [field, val] of Object.entries(exp)) {
      if (field === "match") continue;
      const got = (local as Record<string, unknown>)[field];
      // Champ texte libre (ex. observations) : attendu = liste de sous-chaînes à
      // toutes retrouver (insensible casse/accents), pas une égalité stricte.
      if (Array.isArray(val) && typeof got === "string" && field !== "duree_ferme") {
        const missing = (val as string[]).filter((s) => !normalizeKey(got).includes(normalizeKey(s)));
        checks.push({
          label: `local[${exp.match}].${field}`,
          ok: missing.length === 0,
          expected: `contient ${JSON.stringify(val)}`,
          got: missing.length === 0 ? "ok" : `manquant : ${JSON.stringify(missing)}`,
        });
        continue;
      }
      checks.push({ label: `local[${exp.match}].${field}`, ok: eqValue(field, val, got), expected: val, got });
    }
  }

  return checks;
}
