/**
 * Création d'un Magasin (local) — une page par local.
 * ⚠️ Noms de propriétés exacts, dont « Surface R+1 » avec ESPACE final.
 */
import { notionConfig } from "../config.js";
import { getSchema, createPage } from "./client.js";
import { PropsBuilder } from "./propsMap.js";
import type { Local } from "../ai/schemas.js";

export interface MagasinLinks {
  brokerId?: string | null;
  emplacementId?: string | null;
  documents?: { name: string; url: string }[];
  plans?: { name: string; url: string }[];
}

/**
 * Assemble le déversoir Notes (sans reformulation) : environnement commercial
 * puis observations, une info par ligne. Null si les deux sont vides.
 */
export function buildNotes(local: Pick<Local, "environnement_commercial" | "observations">): string | null {
  const parts = [local.environnement_commercial?.trim(), local.observations?.trim()].filter(
    Boolean
  ) as string[];
  return parts.length ? parts.join("\n") : null;
}

export async function createMagasin(local: Local, links: MagasinLinks): Promise<string> {
  const ds = notionConfig().ds.magasins;
  const schema = await getSchema(ds);
  const titleName = Object.values(schema).find((p) => p.type === "title")?.name ?? "Nom";

  const b = new PropsBuilder(schema)
    .title(titleName, local.nom)
    .text("Adresse complète", local.adresse_complete)
    .number("Surface RDC", local.surface_rdc)
    .number("Surface R-1", local.surface_r_moins_1)
    .number("Surface R+1 ", local.surface_r_plus_1) // espace final volontaire
    .number("Surface R+2", local.surface_r_plus_2)
    .number("Surface Pondérée", local.surface_ponderee)
    .number("Loyer annuel fixe", local.loyer_annuel_fixe)
    .number("Loyer annuel variable", local.loyer_annuel_variable_pct)
    .number("Charges locatives annuelle", local.charges_locatives_annuelles)
    .number("Droit au bail", local.droit_au_bail)
    .number("TF annuelle", local.tf_annuelle)
    .select("Type d'Emplacement", local.type_emplacement)
    .multiSelect("Durée ferme", local.duree_ferme)
    .date("Date de fin de bail", local.date_fin_bail)
    .text("Année du bail", local.annee_bail)
    .text("Notes", buildNotes(local))
    .files("Documents", links.documents)
    .files("Plan local/CC", links.plans);

  if (links.brokerId) b.relation("Brokers", [links.brokerId]);
  if (links.emplacementId) b.relation("Emplacement", [links.emplacementId]);

  return createPage(ds, b.build());
}
