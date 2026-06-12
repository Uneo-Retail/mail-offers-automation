/**
 * Configuration typée, lue depuis les variables d'environnement.
 *
 * `getConfig()` valide la présence des variables nécessaires à un domaine donné
 * et lève une erreur claire si l'une manque. On ne valide pas tout au démarrage :
 * certaines briques (extraction déterministe, tests de fixtures) tournent sans
 * credentials Graph/Notion/Azure.
 */

function req(name: string): string {
  const v = process.env[name];
  if (!v || v.trim() === "") {
    throw new Error(`Variable d'environnement manquante : ${name}`);
  }
  return v.trim();
}

function opt(name: string, fallback = ""): string {
  const v = process.env[name];
  return v && v.trim() !== "" ? v.trim() : fallback;
}

function optNum(name: string, fallback: number): number {
  const v = process.env[name];
  if (!v || v.trim() === "") return fallback;
  const n = Number(v);
  return Number.isFinite(n) ? n : fallback;
}

export interface GraphConfig {
  tenantId: string;
  clientId: string;
  clientSecret: string;
  mailbox: string;
}

export interface AnthropicConfig {
  apiKey: string;
  modelClassify: string;
  modelExtract: string;
}

export interface NotionConfig {
  token: string;
  version: string;
  ds: {
    offres: string;
    magasins: string;
    emplacements: string;
    brokers: string;
    contacts: string;
    villes: string;
    pays: string;
  };
  /** template_id par base (appliqués à la création, cf. LOT 1). */
  templates: {
    magasins: string;
    offres: string;
    brokers: string;
  };
}

export interface AzureConfig {
  connectionString: string;
  container: string;
  sasTtlDays: number;
}

export interface SupabaseConfig {
  url: string;
  serviceKey: string;
}

export type OfferGranularity = "lot" | "local";

export const graphConfig = (): GraphConfig => ({
  tenantId: req("MS_TENANT_ID"),
  clientId: req("MS_CLIENT_ID"),
  clientSecret: req("MS_CLIENT_SECRET"),
  mailbox: req("MS_MAILBOX"),
});

export const anthropicConfig = (): AnthropicConfig => ({
  apiKey: req("ANTHROPIC_API_KEY"),
  modelClassify: opt("MODEL_CLASSIFY", "claude-haiku-4-5-20251001"),
  modelExtract: opt("MODEL_EXTRACT", "claude-sonnet-4-6"),
});

export const notionConfig = (): NotionConfig => ({
  token: req("NOTION_TOKEN"),
  version: opt("NOTION_VERSION", "2025-09-03"),
  ds: {
    offres: req("NOTION_DS_OFFRES"),
    magasins: req("NOTION_DS_MAGASINS"),
    emplacements: req("NOTION_DS_EMPLACEMENTS"),
    brokers: req("NOTION_DS_BROKERS"),
    contacts: req("NOTION_DS_CONTACTS"),
    // Base Villes utilisée pour le matching ville + zone de chalandise (LOT 3/5).
    villes: opt("NOTION_DS_VILLES", "29a545f7-7d1b-808a-a4f6-d527c4ea474d"),
    pays: opt("NOTION_DS_PAYS", "29b545f7-7d1b-8092-bc15-c23e1455b830"),
  },
  templates: {
    magasins: opt("NOTION_TPL_MAGASINS", "29b545f7-7d1b-805f-ab1e-e71d36a1e63a"),
    offres: opt("NOTION_TPL_OFFRES", "29c545f7-7d1b-800f-b631-fc6ebcf652ff"),
    brokers: opt("NOTION_TPL_BROKERS", "29c545f7-7d1b-8015-bfe2-e104dd011992"),
  },
});

export const azureConfig = (): AzureConfig => ({
  connectionString: req("AZURE_STORAGE_CONNECTION_STRING"),
  container: opt("AZURE_BLOB_CONTAINER", "offres-uneo"),
  sasTtlDays: optNum("AZURE_SAS_TTL_DAYS", 3650),
});

export const supabaseConfig = (): SupabaseConfig => ({
  url: req("SUPABASE_URL"),
  serviceKey: req("SUPABASE_SERVICE_KEY"),
});

export const offerGranularity = (): OfferGranularity =>
  opt("OFFER_GRANULARITY", "lot") === "local" ? "local" : "lot";

export const cronSecret = (): string => opt("CRON_SECRET");

/** Borne dure du nombre de mails traités par exécution de cron. */
export const maxBatch = (): number => optNum("MAX_BATCH", 40);

/** Autoriser volontairement le traitement de l'historique au 1er run (jamais par défaut). */
export const forceBackfill = (): boolean => opt("FORCE_BACKFILL").toLowerCase() === "true";

/** Seuils de détection « plaquette dense » (multi-centres type Terranae). */
export const denseBrochureMaxCenters = (): number => optNum("DENSE_BROCHURE_MAX_CENTERS", 5);
export const denseBrochureMaxPages = (): number => optNum("DENSE_BROCHURE_MAX_PAGES", 30);
