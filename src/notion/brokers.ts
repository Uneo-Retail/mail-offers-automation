/**
 * Résolution / création des Brokers (sociétés).
 * Matching par Nom (title) normalisé.
 */
import { notionConfig } from "../config.js";
import { getSchema, queryDataSource, createPageTemplated } from "./client.js";
import { PropsBuilder } from "./propsMap.js";
import { normalizeKey } from "../util/normalize.js";

function titlePropName(schema: Awaited<ReturnType<typeof getSchema>>): string {
  return Object.values(schema).find((p) => p.type === "title")?.name ?? "Nom";
}

function readTitle(page: { properties: Record<string, unknown> }, name: string): string {
  const p = page.properties[name] as { title?: { plain_text?: string }[] } | undefined;
  return (p?.title ?? []).map((t) => t.plain_text ?? "").join("");
}

export async function resolveBroker(societe: string | null | undefined): Promise<string | null> {
  if (!societe || !societe.trim()) return null;
  const cfg = notionConfig();
  const ds = cfg.ds.brokers;
  const schema = await getSchema(ds);
  const titleName = titlePropName(schema);

  // matching exact (title equals) puis comparaison normalisée sur un échantillon
  const exact = await queryDataSource(ds, { property: titleName, title: { equals: societe.trim() } });
  if (exact[0]) return exact[0].id;

  const want = normalizeKey(societe);
  const sample = await queryDataSource(ds, { property: titleName, title: { contains: societe.trim().split(/\s+/)[0] ?? societe } }, 25);
  for (const page of sample) {
    if (normalizeKey(readTitle(page, titleName)) === want) return page.id;
  }

  return createPageTemplated(ds, cfg.templates.brokers, new PropsBuilder(schema).title(titleName, societe.trim()).build());
}
