/**
 * Helpers de normalisation : noms de fichiers, téléphones, montants.
 */

/** Majuscules, sans accents/diacritiques, ponctuation→espace, espaces compactés. */
export function normalizeKey(s: string): string {
  return s
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .toUpperCase()
    .replace(/\.[A-Z0-9]+$/i, "") // retirer l'extension de fichier
    .replace(/[^A-Z0-9]+/g, " ")
    .trim()
    .replace(/\s+/g, " ");
}

/** Ne garder que les chiffres (comparaison de téléphones côté code). */
export function digitsOnly(s: string): string {
  return s.replace(/[^0-9]/g, "");
}

/**
 * Téléphone FR : préférer un mobile (06/07) à un fixe/standard quand plusieurs
 * numéros sont présents. Retourne le numéro brut choisi (formatage conservé) ou null.
 */
export function preferMobile(numbers: string[]): string | null {
  if (numbers.length === 0) return null;
  const scored = numbers
    .map((raw) => ({ raw, d: digitsOnly(raw) }))
    .filter((x) => x.d.length >= 9);
  if (scored.length === 0) return null;

  const isMobile = (d: string): boolean => {
    // ramener à la forme nationale sans préfixe pays ni zéro de tête
    let m = d;
    if (m.startsWith("0033")) m = m.slice(4);
    else if (m.startsWith("33")) m = m.slice(2);
    m = m.replace(/^0+/, "");
    // mobile FR = 6xxxxxxxx / 7xxxxxxxx (9 chiffres après normalisation)
    return /^[67]\d{8}$/.test(m);
  };

  const mobile = scored.find((x) => isMobile(x.d));
  return (mobile ?? scored[0]!).raw.trim();
}

/**
 * Parse un montant français/européen en number.
 * "33 224 €", "1 000 000", "334.900", "12,5" → number ; null si non parsable.
 */
export function parseAmount(input: string | number | null | undefined): number | null {
  if (input == null) return null;
  if (typeof input === "number") return Number.isFinite(input) ? input : null;
  let s = input.trim();
  if (!s) return null;
  // retirer symboles monétaires et libellés courants
  s = s.replace(/€|eur|euros?|ht|hc|\/an|annuel/gi, "").trim();
  // retirer les espaces (séparateurs de milliers) et les espaces insécables
  s = s.replace(/[\s ]/g, "");
  // si virgule ET point : le dernier est le séparateur décimal
  if (s.includes(",") && s.includes(".")) {
    if (s.lastIndexOf(",") > s.lastIndexOf(".")) {
      s = s.replace(/\./g, "").replace(",", ".");
    } else {
      s = s.replace(/,/g, "");
    }
  } else if (s.includes(",")) {
    // virgule = décimale FR si elle précède 1-2 chiffres en fin, sinon milliers
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  } else if (s.includes(".")) {
    // point seul : séparateur de milliers (334.900) si groupes de 3, sinon décimale
    if (/^\d{1,3}(\.\d{3})+$/.test(s)) {
      s = s.replace(/\./g, "");
    }
    // sinon (12.5, 334.50) : on garde le point comme décimale
  }
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}
