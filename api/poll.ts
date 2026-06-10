/**
 * CRON Vercel : delta query Graph → traite chaque nouveau mail → persiste le deltaLink.
 *
 * Protégé par CRON_SECRET (Vercel envoie `Authorization: Bearer <CRON_SECRET>`).
 * Idempotent : un re-run ne retraite rien (garde par messageId + deltaLink).
 *
 * Amorçage : au tout premier passage (aucun deltaLink en base), on pose une
 * « ligne de départ maintenant » SANS traiter l'historique, puis on retourne.
 * Filet de sécurité : au plus `MAX_BATCH` mails par exécution (le reste est
 * drainé aux crons suivants, sans avancer le deltaLink tant que c'est tronqué).
 */
import type { VercelRequest, VercelResponse } from "../src/util/vercel.js";
import { deltaMessages, getMessage, primeDeltaLink } from "../src/graph/messages.js";
import { getDeltaLink, setDeltaLink, isPrimed } from "../src/state/supabase.js";
import { processMail, type Outcome } from "../src/pipeline.js";
import { selectBatch } from "../src/batch.js";
import { cronSecret, maxBatch, forceBackfill } from "../src/config.js";
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
    // Amorçage : 1er run sur une boîte non amorcée → poser le deltaLink sans traiter.
    if (!(await isPrimed()) && !forceBackfill()) {
      const link = await primeDeltaLink();
      if (link) await setDeltaLink(link);
      log.info("poll: amorçage delta (aucun mail traité)", { primed: true, processed: 0 });
      res.status(200).json({ ok: true, primed: true, processed: 0 });
      return;
    }

    const deltaLink = await getDeltaLink();
    const { messageIds, nextDeltaLink } = await deltaMessages(deltaLink);

    const { batch, truncated, total } = selectBatch(messageIds, maxBatch());
    if (truncated) {
      log.warn("poll: lot tronqué, drainage sur plusieurs crons", { truncated: true, total, batch: batch.length });
    }

    for (const id of batch) {
      try {
        const mail = await getMessage(id);
        const outcome = await processMail(mail);
        counts[outcome]++;
      } catch (err) {
        counts.failed++;
        log.error("poll: échec traitement message", { id, err: String(err) });
      }
    }

    // N'avancer le deltaLink que si le lot N'a PAS été tronqué (sinon on reprend
    // au même point au prochain cron pour drainer le reste).
    if (!truncated && nextDeltaLink) await setDeltaLink(nextDeltaLink);

    res.status(200).json({ ok: true, processed: batch.length, total, truncated, counts });
  } catch (err) {
    log.error("poll: erreur globale", { err: String(err) });
    res.status(500).json({ ok: false, error: String(err), counts });
  }
}
