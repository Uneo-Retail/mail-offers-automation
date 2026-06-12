/**
 * Création / résolution d'un Emplacement (centre commercial, niveau parent).
 * Dédoublonnage par nom + ville + pays (LOT 4) : on ne recrée pas un centre déjà
 * présent. Matching de nom normalisé (casse/accents) ; ville/pays comparés par
 * l'ID de relation déjà résolu en amont.
 */
import { notionConfig } from "../config.js";
import { getSchema, queryDataSource, createPage } from "./client.js";
import { PropsBuilder } from "./propsMap.js";
import { placeKey } from "./titles.js";
import { log } from "../log.js";
import type { Extraction } from "../ai/schemas.js";

type Centre = NonNullable<Extraction["centre"]>;

export interface EmplacementLinks {
  villeId?: string | null;
  paysId?: string | null;
  planCentre?: { name: string; url: string } | null;
}

function readTitle(page: { properties: Record<string, unknown> }, name: string): string {
  const p = page.properties[name] as { title?: { plain_text?: string }[] } | undefined;
  return (p?.title ?? []).map((t) => t.plain_text ?? "").join("");
}

function readRelationIds(page: { properties: Record<string, unknown> }, propName: string): string[] {
  const p = page.properties[propName] as { relation?: { id: string }[] } | undefined;
  return p?.relation?.map((r) => r.id) ?? [];
}

/** Un candidat correspond si nom identique ET ville/pays compatibles (quand connus). */
export function emplacementMatches(
  page: { properties: Record<string, unknown> },
  titleName: string,
  centre: Pick<Centre, "nom">,
  links: EmplacementLinks
): boolean {
  if (placeKey(readTitle(page, titleName)) !== placeKey(centre.nom)) return false;
  if (links.villeId) {
    const villes = readRelationIds(page, "Ville");
    if (villes.length > 0 && !villes.includes(links.villeId)) return false;
  }
  if (links.paysId) {
    const pays = readRelationIds(page, "Pays");
    if (pays.length > 0 && !pays.includes(links.paysId)) return false;
  }
  return true;
}

export async function resolveEmplacement(
  centre: Centre,
  links: EmplacementLinks = {}
): Promise<string | null> {
  if (!centre.nom?.trim()) return null;
  const ds = notionConfig().ds.emplacements;
  const schema = await getSchema(ds);
  const titleName = Object.values(schema).find((p) => p.type === "title")?.name ?? "Nom";

  const firstToken = centre.nom.trim().split(/\s+/)[0] ?? centre.nom;
  const candidates = await queryDataSource(ds, { property: titleName, title: { contains: firstToken } }, 25);
  for (const page of candidates) {
    if (emplacementMatches(page, titleName, centre, links)) {
      log.info("emplacement: centre existant réutilisé (pas de doublon)", { nom: centre.nom });
      return page.id;
    }
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
  if (links.villeId) b.relation("Ville", [links.villeId]);
  if (links.paysId) b.relation("Pays", [links.paysId]);
  if (links.planCentre) b.fileOrUrl("Plan du centre", links.planCentre);
  return createPage(ds, b.build());
}
