/**
 * Logger minimal structuré (JSON lines). En serverless, stdout/stderr suffisent ;
 * la traçabilité métier durable va dans Supabase (routing_log / processed_messages).
 */
type Level = "debug" | "info" | "warn" | "error";

function emit(level: Level, msg: string, meta?: Record<string, unknown>): void {
  const line = { ts: new Date().toISOString(), level, msg, ...(meta ?? {}) };
  const out = level === "error" || level === "warn" ? console.error : console.log;
  out(JSON.stringify(line));
}

export const log = {
  debug: (msg: string, meta?: Record<string, unknown>) => emit("debug", msg, meta),
  info: (msg: string, meta?: Record<string, unknown>) => emit("info", msg, meta),
  warn: (msg: string, meta?: Record<string, unknown>) => emit("warn", msg, meta),
  error: (msg: string, meta?: Record<string, unknown>) => emit("error", msg, meta),
};

/**
 * Rend une erreur quelconque en texte lisible (fin des « [object Object] »).
 * - `Error` → « Name: message » (+ code/status/statusCode si présents) ;
 * - objet d'erreur Supabase/Notion/HTTP → JSON ;
 * - string → telle quelle.
 */
export function serializeError(err: unknown): string {
  if (err instanceof Error) {
    const anyErr = err as { code?: unknown; status?: unknown; statusCode?: unknown };
    const extra = [anyErr.code, anyErr.status, anyErr.statusCode]
      .filter((v) => v !== undefined)
      .join(" ");
    const base = `${err.name}: ${err.message}`;
    return extra ? `${base} (${extra})` : base;
  }
  if (typeof err === "string") return err;
  try {
    return JSON.stringify(err);
  } catch {
    return String(err);
  }
}
