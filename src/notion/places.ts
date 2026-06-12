/**
 * Résolution Ville / Pays (LOT 3) : recherche-puis-crée dans les bases dédiées,
 * matching tolérant (casse/accents/St→Saint). Réutilisé par la zone de chalandise.
 */
import { notionConfig } from "../config.js";
import { getSchema, queryDataSource, createPage } from "./client.js";
import { PropsBuilder } from "./propsMap.js";
import { placeKey } from "./titles.js";
import { log } from "../log.js";

function titleOf(page: { properties: Record<string, unknown> }, name: string): string {
  const p = page.properties[name] as { title?: { plain_text?: string }[] } | undefined;
  return (p?.title ?? []).map((t) => t.plain_text ?? "").join("");
}

/** Extrait la ville d'une adresse (« 15 rue Sommeiller, 74000 Annecy » → « Annecy »). */
export function parseCityFromAddress(address: string | null | undefined): string | null {
  if (!address) return null;
  const s = address.trim();
  // après un code postal à 5 chiffres
  const cp = /\b\d{5}\b\s+([^,]+?)\s*$/.exec(s);
  if (cp) return cp[1]!.trim();
  // sinon : dernier segment après une virgule, CP éventuel retiré
  if (s.includes(",")) {
    const last = s.split(",").pop()!.trim().replace(/^\d{5}\s+/, "").trim();
    if (last && !/^\d+/.test(last)) return last;
  }
  return null;
}

/** Recherche (ou crée) une page de lieu par titre normalisé dans `dataSourceId`. */
async function resolvePlace(dataSourceId: string, name: string): Promise<string | null> {
  if (!dataSourceId || !name.trim()) return null;
  const schema = await getSchema(dataSourceId);
  const titleName = Object.values(schema).find((p) => p.type === "title")?.name ?? "Nom";
  const want = placeKey(name);

  const exact = await queryDataSource(dataSourceId, { property: titleName, title: { equals: name.trim() } });
  if (exact[0]) return exact[0].id;

  const firstToken = name.trim().split(/\s+/)[0] ?? name;
  const sample = await queryDataSource(dataSourceId, { property: titleName, title: { contains: firstToken } }, 25);
  for (const page of sample) {
    if (placeKey(titleOf(page, titleName)) === want) return page.id;
  }

  const id = await createPage(dataSourceId, new PropsBuilder(schema).title(titleName, name.trim()).build());
  log.info("places: page de lieu créée", { dataSourceId, name: name.trim() });
  return id;
}

export async function resolveVille(city: string | null | undefined): Promise<string | null> {
  if (!city || !city.trim()) return null;
  return resolvePlace(notionConfig().ds.villes, city);
}

/** Pays par défaut France si non précisé (l'IA peut inférer autrement en amont). */
export async function resolvePays(country: string | null | undefined): Promise<string | null> {
  return resolvePlace(notionConfig().ds.pays, country?.trim() || "France");
}
