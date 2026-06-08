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
    villes: opt("NOTION_DS_VILLES"),
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
