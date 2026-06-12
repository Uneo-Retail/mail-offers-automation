/**
 * État & dédoublonnage (Supabase).
 *  - graph_state : deltaLink persistant de l'inbox.
 *  - processed_messages : mails déjà traités (idempotence).
 *  - routing_log : trace des décisions IA (audit / calibrage).
 */
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { supabaseConfig } from "../config.js";
import { serializeError } from "../log.js";

let client: SupabaseClient | null = null;
function db(): SupabaseClient {
  if (!client) {
    const cfg = supabaseConfig();
    // Client backend (serverless) uniquement : la clé service_role (lue depuis
    // SUPABASE_SERVICE_KEY) bypass la RLS. Pas de session ni de refresh côté daemon.
    client = createClient(cfg.url, cfg.serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });
  }
  return client;
}

/** Injection de client (tests uniquement). */
export function _setClient(c: SupabaseClient | null): void {
  client = c;
}

/** Client Supabase service_role (lecture serveur, ex. routes /api/admin). */
export function getClient(): SupabaseClient {
  return db();
}

const DELTA_KEY = "inbox_delta";

export async function getDeltaLink(): Promise<string | null> {
  const { data, error } = await db()
    .from("graph_state")
    .select("delta_link")
    .eq("key", DELTA_KEY)
    .maybeSingle();
  if (error) throw error;
  return data?.delta_link ?? null;
}

/** Vrai si un deltaLink existe déjà = l'inbox a été amorcée. */
export async function isPrimed(): Promise<boolean> {
  return (await getDeltaLink()) !== null;
}

export async function setDeltaLink(deltaLink: string): Promise<void> {
  const { error } = await db()
    .from("graph_state")
    .upsert({ key: DELTA_KEY, delta_link: deltaLink, updated_at: new Date().toISOString() });
  if (error) throw error;
}

export async function isProcessed(messageId: string): Promise<boolean> {
  const { data, error } = await db()
    .from("processed_messages")
    .select("message_id")
    .eq("message_id", messageId)
    .maybeSingle();
  if (error) throw error;
  return !!data;
}

export type ProcessStatus = "success" | "noise" | "failed" | "skipped";

export interface ProcessedRecord {
  messageId: string;
  route?: string;
  nbLocaux?: number;
  notionOffreId?: string | null;
  status: ProcessStatus;
  error?: string | null;
  subject?: string | null;
  sender?: string | null;
}

export async function markProcessed(rec: ProcessedRecord): Promise<void> {
  const { error } = await db().from("processed_messages").upsert({
    message_id: rec.messageId,
    processed_at: new Date().toISOString(),
    route: rec.route ?? null,
    nb_locaux: rec.nbLocaux ?? null,
    notion_offre_id: rec.notionOffreId ?? null,
    status: rec.status,
    error: rec.error ?? null,
    subject: rec.subject ?? null,
    sender: rec.sender ?? null,
  });
  if (error) throw error;
}

export async function logRouting(entry: {
  messageId: string;
  route: string;
  typeOffre: string;
  confiance: number;
  raison: string;
}): Promise<void> {
  const { error } = await db().from("routing_log").insert({
    message_id: entry.messageId,
    route: entry.route,
    type_offre: entry.typeOffre,
    confiance: entry.confiance,
    raison: entry.raison,
    created_at: new Date().toISOString(),
  });
  // le log ne doit jamais bloquer le pipeline
  if (error) console.error("logRouting error", serializeError(error));
}

export type EventLevel = "info" | "warn" | "error";

/**
 * Émet un événement de traitement (console admin "live"). BEST-EFFORT :
 * une écriture qui échoue NE DOIT PAS casser le pipeline.
 */
export async function emitEvent(
  messageId: string,
  step: string,
  detail?: string | null,
  level: EventLevel = "info"
): Promise<void> {
  try {
    const { error } = await db().from("processing_events").insert({
      message_id: messageId,
      step,
      detail: detail ?? null,
      level,
    });
    if (error) console.error("emitEvent error", serializeError(error));
  } catch (err) {
    console.error("emitEvent error", serializeError(err));
  }
}
