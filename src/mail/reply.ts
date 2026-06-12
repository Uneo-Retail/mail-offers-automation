/**
 * Notifications « à soi-même » (owner de la boîte connectée), en réponse au fil.
 * Wording exact imposé par le brief client.
 */
import { replyToSelf } from "../graph/messages.js";
import { log, serializeError } from "../log.js";

export async function notifySuccess(messageId: string, offrePageUrl: string): Promise<void> {
  const html = `Cette offre a été traité par le système Notion, elle est disponible sur cette page : <a href="${offrePageUrl}">${offrePageUrl}</a>`;
  try {
    await replyToSelf(messageId, html);
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
