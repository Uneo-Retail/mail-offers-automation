/**
 * Création / résolution d'un Emplacement (centre commercial, niveau parent).
 * Matching léger par Nom normalisé (V2 = matching robuste avec Ville).
 */
import { notionConfig } from "../config.js";
import { getSchema, queryDataSource, createPage } from "./client.js";
import { PropsBuilder } from "./propsMap.js";
import { normalizeKey } from "../util/normalize.js";
import type { Extraction } from "../ai/schemas.js";

type Centre = NonNullable<Extraction["centre"]>;

function readTitle(page: { properties: Record<string, unknown> }, name: string): string {
  const p = page.properties[name] as { title?: { plain_text?: string }[] } | undefined;
  return (p?.title ?? []).map((t) => t.plain_text ?? "").join("");
}

export async function resolveEmplacement(
  centre: Centre,
  files?: { planCentre?: { name: string; url: string } }
): Promise<string | null> {
  if (!centre.nom?.trim()) return null;
  const ds = notionConfig().ds.emplacements;
  const schema = await getSchema(ds);
  const titleName = Object.values(schema).find((p) => p.type === "title")?.name ?? "Nom";

  const want = normalizeKey(centre.nom);
  const candidates = await queryDataSource(ds, { property: titleName, title: { equals: centre.nom.trim() } });
  for (const page of candidates) {
    if (normalizeKey(readTitle(page, titleName)) === want) return page.id;
  }

  const b = new PropsBuilder(schema)
    .title(titleName, centre.nom)
    .text("Adresse complète", centre.adresse_complete)
    .select("Type d'emplacement", centre.type_emplacement)
    .select("Locomotive", centre.locomotive)
    .number("Superficie m² ", centre.superficie_m2)
    .number("Surface m² hypermarché", centre.surface_hypermarche_m2)
    .text("Flux visiteurs (en M)", centre.flux_visiteurs)
    .text("Description", centre.description)
    .number("Total Magasins", centre.total_magasins);
  if (files?.planCentre) b.fileOrUrl("Plan du centre", files.planCentre);
  return createPage(ds, b.build());
}
