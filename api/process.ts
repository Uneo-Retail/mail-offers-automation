/**
 * Traitement d'un mail isolé (debug / replay) : POST { messageId }.
 * Utile pour rejouer un mail précis sans attendre le cron. Protégé par CRON_SECRET.
 */
import type { VercelRequest, VercelResponse } from "../src/util/vercel.js";
import { getMessage } from "../src/graph/messages.js";
import { processMail } from "../src/pipeline.js";
import { cronSecret } from "../src/config.js";
import { serializeError } from "../src/log.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = cronSecret();
  if (secret && req.headers["authorization"] !== `Bearer ${secret}`) {
    res.status(401).json({ error: "unauthorized" });
    return;
  }
  const body = (typeof req.body === "object" && req.body) || {};
  const messageId = (body as { messageId?: string }).messageId ?? (req.query.messageId as string | undefined);
  if (!messageId) {
    res.status(400).json({ error: "messageId requis" });
    return;
  }
  try {
    const mail = await getMessage(messageId);
    const outcome = await processMail(mail);
    res.status(200).json({ ok: true, outcome });
  } catch (err) {
    res.status(500).json({ ok: false, error: serializeError(err) });
  }
}
