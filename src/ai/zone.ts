/**
 * Zone de chalandise (LOT 5) : villes dans un rayon d'~15 km, via l'outil
 * web_search de l'API Anthropic.
 *
 * ⚠️ APPROXIMATIF et COÛTEUX : ce n'est PAS un vrai rayon géodésique mais une
 * estimation par le modèle + recherche web. Latence et coût ajoutés par appel.
 * Borné (max ~10 villes) et entièrement BEST-EFFORT : si la recherche échoue,
 * on renvoie [] sans bloquer la création de l'offre.
 */
import { anthropic } from "./client.js";
import { anthropicConfig } from "../config.js";
import { log, serializeError } from "../log.js";

/** Extrait des noms de communes d'un texte en liste (pur, testable). */
export function parseCityNames(text: string, exclude?: string, max = 10): string[] {
  const out: string[] = [];
  const seen = new Set<string>();
  for (let line of text.split(/\n|;|,/)) {
    line = line
      .replace(/^[\s\-*•\d.)°]+/, "") // puces / numéros
      .replace(/\(.*?\)/g, "") // parenthèses (distances, dpt…)
      .replace(/\s*[:–-]\s*\d.*$/, "") // « Ville - 12 km »
      .trim();
    if (line.length < 2 || line.length > 40) continue;
    if (!/^[A-ZÀ-Ý]/.test(line)) continue; // nom propre
    const key = line.toLowerCase();
    if (exclude && key === exclude.trim().toLowerCase()) continue;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(line);
    if (out.length >= max) break;
  }
  return out;
}

export async function nearbyCities(
  city: string,
  country = "France",
  max = 10
): Promise<string[]> {
  if (!city.trim()) return [];
  try {
    const res = await anthropic().messages.create({
      model: anthropicConfig().modelClassify,
      max_tokens: 600,
      tools: [{ type: "web_search_20250305", name: "web_search", max_uses: 2 }] as never,
      messages: [
        {
          role: "user",
          content: `Donne les villes les plus importantes (les plus peuplées/connues) situées dans un rayon d'environ 15 km de ${city} (${country}). Réponds UNIQUEMENT par une liste de noms de communes, une par ligne, sans numéro ni commentaire.`,
        },
      ],
    });
    const text = res.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("\n");
    return parseCityNames(text, city, max);
  } catch (err) {
    log.warn("zone: recherche villes échouée (best-effort, non bloquant)", {
      city,
      err: serializeError(err),
    });
    return [];
  }
}
