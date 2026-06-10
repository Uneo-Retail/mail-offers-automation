/**
 * Routeur d'extraction multi-format (déterministe, hors IA).
 *
 * Entrée : un mail normalisé (corps + pièces jointes décodées).
 * Sortie : `ExtractedContent` = corps texte propre, documents de données
 * (xlsx→CSV, pdf→texte + base64 si court), médias triés, liens suivis,
 * images inline (signatures) prêtes pour la vision.
 */
import type { DataDoc, ExtractedContent, IncomingMail } from "../types.js";
import { htmlToText } from "./html.js";
import { xlsxToText } from "./xlsx.js";
import { pdfToText, isSmallPdf } from "./pdf.js";
import { triageAttachments } from "./attachments.js";
import { fetchLinkText, isFollowableLink } from "./link.js";
import { log } from "../log.js";

const MAX_LINKS_FOLLOWED = 3;

export async function routeExtraction(mail: IncomingMail): Promise<ExtractedContent> {
  // 1. Corps : préférer le HTML (plus riche), retomber sur le texte brut.
  let bodyText = (mail.bodyText ?? "").trim();
  let bodyLinks: { url: string; text: string }[] = [];
  if (mail.bodyHtml && mail.bodyHtml.trim()) {
    const { text, links } = htmlToText(mail.bodyHtml);
    if (text.length >= bodyText.length) bodyText = text;
    bodyLinks = links;
  }

  // 2. Tri des pièces jointes.
  const { dataAttachments, media, inline } = triageAttachments(mail.attachments);

  // 3. Documents de données → texte (et base64 pour les PDF courts).
  const dataDocs: DataDoc[] = [];
  for (const att of dataAttachments) {
    if (!att.content) {
      log.warn("router: pièce jointe sans contenu décodé", { name: att.name });
      continue;
    }
    const name = att.name.toLowerCase();
    try {
      if (name.endsWith(".xlsx") || name.endsWith(".xls") || /spreadsheet|excel/i.test(att.contentType)) {
        dataDocs.push({ attachment: att, text: xlsxToText(att.content) });
      } else if (name.endsWith(".csv")) {
        dataDocs.push({ attachment: att, text: att.content.toString("utf8") });
      } else if (name.endsWith(".pdf") || /pdf/i.test(att.contentType)) {
        const pdf = await pdfToText(att.content);
        const doc: DataDoc = {
          attachment: att,
          text: pdf.text,
          pageCount: pdf.pageCount,
        };
        // PDF court → fournir le base64 pour la vision native.
        if (isSmallPdf(pdf.pageCount)) {
          doc.pdfBase64 = att.content.toString("base64");
        }
        dataDocs.push(doc);
      } else {
        // type inconnu : tenter du texte UTF-8 best-effort
        const text = att.content.toString("utf8");
        if (text && /[\x20-\x7E]/.test(text)) dataDocs.push({ attachment: att, text });
      }
    } catch (err) {
      log.warn("router: échec extraction document", { name: att.name, err: String(err) });
    }
  }

  // 4. Images inline (signatures) → base64 pour vision.
  const inlineImages = inline
    .filter((a) => a.content)
    .map((a) => ({
      name: a.name,
      contentType: a.contentType,
      base64: a.content!.toString("base64"),
    }));

  // 5. Liens : ne suivre que s'il n'y a aucune donnée jointe (offre en lien),
  //    pour éviter de fetch des sites inutiles quand le PDF/xlsx porte déjà tout.
  const links: ExtractedContent["links"] = [];
  if (dataDocs.length === 0) {
    const followable = bodyLinks.filter((l) => isFollowableLink(l.url)).slice(0, MAX_LINKS_FOLLOWED);
    for (const l of followable) {
      const text = await fetchLinkText(l.url);
      if (text) links.push({ url: l.url, text });
    }
  }

  return { bodyText, dataDocs, media, links, inlineImages };
}
