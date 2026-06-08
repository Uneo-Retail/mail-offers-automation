/**
 * Client Notion (API « data sources », version 2025-09-03).
 *
 * On passe par `client.request` pour les endpoints data-source (query/schema),
 * et par `pages.create/update` avec un parent `data_source_id` pour les écritures.
 * Le schéma de chaque data source est récupéré une fois et mis en cache, afin de
 * n'écrire QUE des propriétés existantes et inscriptibles (on saute les formules,
 * rollups et relations non gérées).
 */
import { Client } from "@notionhq/client";
import { notionConfig } from "../config.js";

let client: Client | null = null;
function notion(): Client {
  if (!client) {
    const cfg = notionConfig();
    client = new Client({ auth: cfg.token, notionVersion: cfg.version });
  }
  return client;
}

export interface PropSchema {
  id: string;
  name: string;
  type: string;
}

export type DataSourceSchema = Record<string, PropSchema>; // clé = nom de propriété

const schemaCache = new Map<string, DataSourceSchema>();

/** Propriétés en lecture seule : ne jamais tenter de les écrire. */
const READONLY_TYPES = new Set([
  "formula",
  "rollup",
  "created_time",
  "created_by",
  "last_edited_time",
  "last_edited_by",
  "unique_id",
]);

export async function getSchema(dataSourceId: string): Promise<DataSourceSchema> {
  const cached = schemaCache.get(dataSourceId);
  if (cached) return cached;
  const res = (await notion().request({
    path: `data_sources/${dataSourceId}`,
    method: "get",
  })) as { properties: Record<string, { id: string; name: string; type: string }> };
  const schema: DataSourceSchema = {};
  for (const [name, p] of Object.entries(res.properties)) {
    schema[name] = { id: p.id, name: p.name, type: p.type };
  }
  schemaCache.set(dataSourceId, schema);
  return schema;
}

export function isWritable(prop: PropSchema | undefined): prop is PropSchema {
  return !!prop && !READONLY_TYPES.has(prop.type);
}

export interface QueryFilter {
  property: string;
  [k: string]: unknown;
}

export async function queryDataSource(
  dataSourceId: string,
  filter?: QueryFilter,
  pageSize = 25
): Promise<{ id: string; properties: Record<string, unknown> }[]> {
  const body: Record<string, unknown> = { page_size: pageSize };
  if (filter) body.filter = filter;
  const res = (await notion().request({
    path: `data_sources/${dataSourceId}/query`,
    method: "post",
    body,
  })) as { results: { id: string; properties: Record<string, unknown> }[] };
  return res.results;
}

export async function createPage(
  dataSourceId: string,
  properties: Record<string, unknown>
): Promise<string> {
  const res = (await notion().pages.create({
    parent: { type: "data_source_id", data_source_id: dataSourceId } as never,
    properties: properties as never,
  })) as { id: string };
  return res.id;
}

export async function updatePage(
  pageId: string,
  properties: Record<string, unknown>
): Promise<void> {
  await notion().pages.update({ page_id: pageId, properties: properties as never });
}

export function pageUrl(pageId: string): string {
  return `https://www.notion.so/${pageId.replace(/-/g, "")}`;
}

export { notion as notionClient };
