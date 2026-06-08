/**
 * CRON Vercel : delta query Graph → traite chaque nouveau mail → persiste le deltaLink.
 *
 * Protégé par CRON_SECRET (Vercel envoie `Authorization: Bearer <CRON_SECRET>`).
 * Idempotent : un re-run ne retraite rien (garde par messageId + deltaLink).
 */
import type { VercelRequest, VercelResponse } from "../src/util/vercel.js";
import { deltaMessages, getMessage } from "../src/graph/messages.js";
import { getDeltaLink, setDeltaLink } from "../src/state/supabase.js";
import { processMail, type Outcome } from "../src/pipeline.js";
import { cronSecret } from "../src/config.js";
import { log } from "../src/log.js";

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const secret = cronSecret();
  if (secret) {
    const auth = req.headers["authorization"];
    if (auth !== `Bearer ${secret}`) {
      res.status(401).json({ error: "unauthorized" });
      return;
    }
  }

  const counts: Record<Outcome, number> = { success: 0, noise: 0, failed: 0, skipped: 0 };
  try {
    const deltaLink = await getDeltaLink();
    const { messageIds, nextDeltaLink } = await deltaMessages(deltaLink);
    log.info("poll: delta", { nouveaux: messageIds.length, hadDelta: !!deltaLink });

    for (const id of messageIds) {
      try {
        const mail = await getMessage(id);
        const outcome = await processMail(mail);
        counts[outcome]++;
      } catch (err) {
        counts.failed++;
        log.error("poll: échec traitement message", { id, err: String(err) });
      }
    }

    // Persister le nouveau deltaLink seulement après traitement complet du lot.
    if (nextDeltaLink) await setDeltaLink(nextDeltaLink);

    res.status(200).json({ ok: true, processed: messageIds.length, counts });
  } catch (err) {
    log.error("poll: erreur globale", { err: String(err) });
    res.status(500).json({ ok: false, error: String(err), counts });
  }
}
