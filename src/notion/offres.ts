/**
 * Création d'une Offre, reliée aux N Magasins + Broker.
 * État par défaut = « À étudier ».
 */
import { notionConfig } from "../config.js";
import { getSchema, createPage } from "./client.js";
import { PropsBuilder } from "./propsMap.js";

export interface OffreInput {
  nom: string;
  magasinIds: string[];
  brokerId?: string | null;
  /** date de réception du mail (ISO YYYY-MM-DD) */
  date?: string | null;
  notes?: string | null;
  /** lien Azure (ou source) du document principal */
  source?: { name: string; url: string } | null;
}

export async function createOffre(input: OffreInput): Promise<string> {
  const ds = notionConfig().ds.offres;
  const schema = await getSchema(ds);
  const titleName = Object.values(schema).find((p) => p.type === "title")?.name ?? "Nom";

  const b = new PropsBuilder(schema)
    .title(titleName, input.nom)
    .select("État", "À étudier")
    .relation("Magasin", input.magasinIds)
    .date("Date", input.date)
    .text("Notes", input.notes);
  if (input.brokerId) b.relation("Brokers", [input.brokerId]);
  if (input.source) {
    // PDF/URL : type exact variable selon la DB → on s'adapte (À VALIDER §10.3).
    b.fileOrUrl("PDF", input.source).fileOrUrl("URL", input.source);
  }

  return createPage(ds, b.build());
}
