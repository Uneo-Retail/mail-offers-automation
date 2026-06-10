import type { VercelRequest, VercelResponse } from "../src/util/vercel.js";

/**
 * Endpoint de santé. Ne touche à aucun service externe : confirme seulement
 * que la fonction se déploie et répond.
 */
export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.status(200).json({
    status: "ok",
    service: "mail-offers-automation",
    time: new Date().toISOString(),
  });
}
