/**
 * Notifications « à soi-même » (owner de la boîte connectée), en réponse au fil.
 * Wording exact imposé par le brief client.
 */
import { replyToSelf } from "../graph/messages.js";
import { log, serializeError } from "../log.js";

/** Corps HTML de la notification de succès (LOT 8) — pur, testable. */
export function buildSuccessHtml(offrePageUrl: string, brokerName?: string | null): string {
  const broker = brokerName?.trim() || "l'expéditeur";
  return [
    `<p>✅ <b>Traité par l'IA</b></p>`,
    `<p>Cette offre a été ajoutée dans Notion, disponible dans <a href="${offrePageUrl}"><b>cette page</b></a>.</p>`,
    `<hr>`,
    `<p>💬 <i>Note de l'IA : Ce mail est une note personnelle, il n'est pas visible par ${broker}.</i></p>`,
  ].join("\n");
}

export async function notifySuccess(
  messageId: string,
  offrePageUrl: string,
  brokerName?: string | null
): Promise<void> {
  try {
    await replyToSelf(messageId, buildSuccessHtml(offrePageUrl, brokerName));
  } catch (err) {
    log.warn("notifySuccess: échec d'envoi", { messageId, err: serializeError(err) });
  }
}

export async function notifyDenseBrochure(
  messageId: string,
  nbCentres: number,
  pdfUrl?: string | null
): Promise<void> {
  const n = nbCentres > 0 ? `~${nbCentres}` : "plusieurs";
  const lien = pdfUrl ? `<a href="${pdfUrl}">${pdfUrl}</a>` : "(voir le document joint au mail)";
  const html = `Document dense reçu : plaquette de portefeuille (${n} centres). Traitement automatique non effectué pour préserver la fiabilité. À consulter manuellement : ${lien}.`;
  try {
    await replyToSelf(messageId, html);
  } catch (err) {
    log.warn("notifyDenseBrochure: échec d'envoi", { messageId, err: serializeError(err) });
  }
}

export async function notifyFailure(messageId: string, reason?: string): Promise<void> {
  const base = "Le système Notion ne peut pas traiter le format de ce mail.";
  const html = reason ? `${base}<br><br><i>${reason}</i>` : base;
  try {
    await replyToSelf(messageId, html);
  } catch (err) {
    log.warn("notifyFailure: échec d'envoi", { messageId, err: serializeError(err) });
  }
}
