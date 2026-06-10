/**
 * Garde-fou technique : écarter les mails non exploitables AVANT toute IA
 * (auto-replies, accusés de réception, notifications automatiques, mails vides).
 * Ce n'est PAS de la classification métier — juste de l'hygiène d'entrée.
 */
import type { IncomingMail } from "./types.js";

export interface GuardResult {
  drop: boolean;
  reason?: string;
}

export function technicalGuard(mail: IncomingMail): GuardResult {
  const h = mail.headers ?? {};
  if (h["x-auto-response-suppress"] || h["auto-submitted"]?.toLowerCase().includes("auto")) {
    return { drop: true, reason: "auto-submitted" };
  }
  if (h["precedence"] && /bulk|auto_reply|junk|list/i.test(h["precedence"])) {
    return { drop: true, reason: "precedence bulk/auto" };
  }
  const subject = (mail.subject ?? "").toLowerCase();
  if (/^(automatic reply|réponse automatique|out of office|absence du bureau|delivery (status|has failed)|undeliverable|mail delivery)/i.test(subject)) {
    return { drop: true, reason: "auto-reply/NDR subject" };
  }
  const from = mail.from.email?.toLowerCase() ?? "";
  if (/^(no-?reply|do-?not-?reply|postmaster|mailer-daemon|notification)@/.test(from)) {
    return { drop: true, reason: "no-reply sender" };
  }

  const hasBody = ((mail.bodyText ?? "") + (mail.bodyHtml ?? "")).trim().length > 0;
  if (!hasBody && mail.attachments.length === 0) {
    return { drop: true, reason: "mail sans contenu ni pièce jointe" };
  }
  return { drop: false };
}
