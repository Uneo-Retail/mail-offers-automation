/**
 * Suivi d'un lien hypertexte d'offre (cas Villeneuve-d'Ascq : offre derrière un
 * lien, pas de PJ) → fetch de la page + extraction texte.
 */
import { htmlToText } from "./html.js";
import { log, serializeError } from "../log.js";

const FETCH_TIMEOUT_MS = 15_000;
const MAX_BYTES = 4_000_000;

/** Domaines à ne pas suivre (trackers, désinscription, réseaux sociaux…). */
const SKIP_HOST = /(unsubscribe|mailchimp|sendgrid|list-manage|doubleclick|facebook\.com|twitter\.com|linkedin\.com|youtube\.com|instagram\.com|google\.com\/maps)/i;

export function isFollowableLink(url: string): boolean {
  if (!/^https?:\/\//i.test(url)) return false;
  if (SKIP_HOST.test(url)) return false;
  // éviter de télécharger directement des binaires lourds via ce chemin
  if (/\.(zip|exe|dmg|mp4|mov)(\?|$)/i.test(url)) return false;
  return true;
}

export async function fetchLinkText(url: string): Promise<string | null> {
  if (!isFollowableLink(url)) return null;
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
  try {
    const res = await fetch(url, {
      signal: controller.signal,
      redirect: "follow",
      headers: { "user-agent": "Mozilla/5.0 (compatible; UneoOffersBot/1.0)" },
    });
    if (!res.ok) {
      log.warn("fetchLinkText: réponse non-OK", { url, status: res.status });
      return null;
    }
    const ct = res.headers.get("content-type") ?? "";
    if (!/text\/html|application\/xhtml/i.test(ct)) {
      // pas une page HTML (PDF, image…) → ce chemin ne la traite pas
      return null;
    }
    const buf = Buffer.from(await res.arrayBuffer());
    const html = buf.subarray(0, MAX_BYTES).toString("utf8");
    const { text } = htmlToText(html);
    return text.slice(0, 20_000);
  } catch (err) {
    log.warn("fetchLinkText: échec", { url, err: serializeError(err) });
    return null;
  } finally {
    clearTimeout(timer);
  }
}
