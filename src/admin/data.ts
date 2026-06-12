/**
 * Accès lecture pour la console admin (côté serveur uniquement — service_role).
 * Les mappers de sérialisation sont purs et testables ; les fetchers lisent Supabase.
 */
import { getClient } from "../state/supabase.js";
import { pageUrl } from "../notion/client.js";

export type DisplayStatus =
  | "succes"
  | "dense"
  | "hors_scope"
  | "echec"
  | "ignore"
  | "en_cours";

export interface ProcessedRow {
  message_id: string;
  processed_at: string | null;
  route: string | null;
  type_offre?: string | null;
  nb_locaux: number | null;
  notion_offre_id: string | null;
  status: string | null;
  error: string | null;
  subject: string | null;
  sender: string | null;
}

export interface RoutingRow {
  message_id: string;
  route: string | null;
  type_offre: string | null;
  confiance: number | null;
  raison: string | null;
  created_at: string | null;
}

export interface EventRow {
  id: number;
  message_id: string;
  ts: string;
  step: string;
  detail: string | null;
  level: string;
}

export interface MessageListItem {
  messageId: string;
  processedAt: string | null;
  subject: string | null;
  sender: string | null;
  status: DisplayStatus;
  route: string | null;
  typeOffre: string | null;
  nbLocaux: number | null;
  notionOffreUrl: string | null;
  error: string | null;
  lastStep?: string | null;
}

export interface MessageDetail extends MessageListItem {
  confiance: number | null;
  raison: string | null;
  events: { id: number; ts: string; step: string; detail: string | null; level: string }[];
}

// ── Mappers purs ─────────────────────────────────────────────────────────────

/** Statut d'affichage dérivé de l'état stocké. */
export function displayStatus(p: Pick<ProcessedRow, "status" | "route" | "nb_locaux">): DisplayStatus {
  switch (p.status) {
    case "success":
      return p.route === "faible_completude" && (p.nb_locaux ?? 0) === 0 ? "dense" : "succes";
    case "noise":
      return "hors_scope";
    case "failed":
      return "echec";
    case "skipped":
      return "ignore";
    default:
      return "en_cours";
  }
}

export function mapListItem(p: ProcessedRow, routing?: RoutingRow): MessageListItem {
  return {
    messageId: p.message_id,
    processedAt: p.processed_at,
    subject: p.subject,
    sender: p.sender,
    status: displayStatus(p),
    route: p.route ?? routing?.route ?? null,
    typeOffre: p.type_offre ?? routing?.type_offre ?? null,
    nbLocaux: p.nb_locaux,
    notionOffreUrl: p.notion_offre_id ? pageUrl(p.notion_offre_id) : null,
    error: p.error,
  };
}

/** Item « en cours » synthétisé depuis les events (pas encore d'enregistrement final). */
export function inProgressItem(messageId: string, events: EventRow[]): MessageListItem {
  const sorted = [...events].sort((a, b) => a.ts.localeCompare(b.ts));
  const recu = sorted.find((e) => e.step === "mail_recu");
  const last = sorted[sorted.length - 1];
  return {
    messageId,
    processedAt: last?.ts ?? null,
    subject: recu?.detail ?? null,
    sender: null,
    status: "en_cours",
    route: null,
    typeOffre: null,
    nbLocaux: null,
    notionOffreUrl: null,
    error: null,
    lastStep: last?.step ?? null,
  };
}

export function mapDetail(p: ProcessedRow, routing: RoutingRow | undefined, events: EventRow[]): MessageDetail {
  return {
    ...mapListItem(p, routing),
    confiance: routing?.confiance ?? null,
    raison: routing?.raison ?? null,
    events: [...events]
      .sort((a, b) => a.ts.localeCompare(b.ts))
      .map((e) => ({ id: e.id, ts: e.ts, step: e.step, detail: e.detail, level: e.level })),
  };
}

// ── Fetchers (serveur) ───────────────────────────────────────────────────────

const ONE_HOUR_MS = 60 * 60 * 1000;

export async function listMessages(opts: { status?: string; search?: string; limit?: number } = {}): Promise<MessageListItem[]> {
  const db = getClient();
  const limit = Math.min(opts.limit ?? 200, 500);

  const { data: processed } = await db
    .from("processed_messages")
    .select("*")
    .order("processed_at", { ascending: false })
    .limit(limit);
  const rows = (processed ?? []) as ProcessedRow[];

  // routing_log le plus récent par message
  const ids = rows.map((r) => r.message_id);
  const routingByMsg = new Map<string, RoutingRow>();
  if (ids.length) {
    const { data: routing } = await db
      .from("routing_log")
      .select("*")
      .in("message_id", ids)
      .order("created_at", { ascending: false });
    for (const r of (routing ?? []) as RoutingRow[]) {
      if (!routingByMsg.has(r.message_id)) routingByMsg.set(r.message_id, r);
    }
  }

  let items = rows.map((r) => mapListItem(r, routingByMsg.get(r.message_id)));

  // en cours : events récents sans enregistrement final
  const since = new Date(Date.now() - ONE_HOUR_MS).toISOString();
  const { data: recent } = await db
    .from("processing_events")
    .select("*")
    .gte("ts", since)
    .order("ts", { ascending: true })
    .limit(1000);
  const doneSet = new Set(ids);
  const byMsg = new Map<string, EventRow[]>();
  for (const e of (recent ?? []) as EventRow[]) {
    if (doneSet.has(e.message_id)) continue;
    (byMsg.get(e.message_id) ?? byMsg.set(e.message_id, []).get(e.message_id)!).push(e);
  }
  const inProgress = [...byMsg.entries()].map(([id, evs]) => inProgressItem(id, evs));
  items = [...inProgress, ...items];

  if (opts.status) items = items.filter((i) => i.status === opts.status);
  if (opts.search) {
    const q = opts.search.toLowerCase();
    items = items.filter(
      (i) => (i.subject ?? "").toLowerCase().includes(q) || (i.sender ?? "").toLowerCase().includes(q)
    );
  }
  return items;
}

export async function getMessageDetail(messageId: string): Promise<MessageDetail | null> {
  const db = getClient();
  const { data: p } = await db.from("processed_messages").select("*").eq("message_id", messageId).maybeSingle();
  const { data: routing } = await db
    .from("routing_log")
    .select("*")
    .eq("message_id", messageId)
    .order("created_at", { ascending: false });
  const { data: events } = await db
    .from("processing_events")
    .select("*")
    .eq("message_id", messageId)
    .order("ts", { ascending: true });

  const evs = (events ?? []) as EventRow[];
  const routingRow = ((routing ?? []) as RoutingRow[])[0];

  if (p) return mapDetail(p as ProcessedRow, routingRow, evs);
  if (evs.length) {
    // pas encore d'enregistrement final → vue « en cours »
    const item = inProgressItem(messageId, evs);
    return { ...item, confiance: null, raison: null, events: evs.map((e) => ({ id: e.id, ts: e.ts, step: e.step, detail: e.detail, level: e.level })) };
  }
  return null;
}
