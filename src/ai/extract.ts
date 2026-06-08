/**
 * Extraction structurée (Sonnet, tool use forcé).
 *
 * Construit le payload multimodal : texte (corps + docs de données + liens) +
 * documents PDF courts en vision native + images inline (signatures), puis force
 * l'outil "extraire_offre" et valide la sortie avec zod.
 */
import type Anthropic from "@anthropic-ai/sdk";
import type { ExtractedContent, IncomingMail } from "../types.js";
import { anthropicConfig } from "../config.js";
import { runForcedTool } from "./client.js";
import { extractionSchema, extractTool, type Extraction } from "./schemas.js";
import { EXTRACT_SYSTEM, EXTRACT_USER_PREFIX } from "./prompts/extract.js";
import { preferMobile } from "../util/normalize.js";

const MAX_DOC_TEXT = 180_000;
const MAX_TOTAL_TEXT = 500_000;
const IMAGE_MEDIA = /^image\/(png|jpe?g|gif|webp)$/i;

export async function extractOffer(
  mail: IncomingMail,
  content: ExtractedContent
): Promise<Extraction> {
  const blocks: Anthropic.Messages.ContentBlockParam[] = [];

  // 1. Bloc texte principal.
  const sections: string[] = [
    EXTRACT_USER_PREFIX,
    `EXPÉDITEUR : ${mail.from.name ?? ""} <${mail.from.email ?? ""}>`,
    `OBJET : ${mail.subject}`,
    `DATE : ${mail.receivedAt ?? ""}`,
    "",
    "=== CORPS DU MAIL ===",
    content.bodyText || "(vide)",
  ];

  let budget = MAX_TOTAL_TEXT;
  for (const doc of content.dataDocs) {
    if (!doc.text) continue;
    const slice = doc.text.slice(0, MAX_DOC_TEXT);
    if (budget - slice.length <= 0) break;
    budget -= slice.length;
    sections.push("", `=== DOCUMENT : ${doc.attachment.name}${doc.pageCount ? ` (${doc.pageCount} p.)` : ""} ===`, slice);
  }
  for (const link of content.links) {
    sections.push("", `=== PAGE LIÉE : ${link.url} ===`, (link.text ?? "").slice(0, 20_000));
  }
  // Liste des fichiers médias pour le matching plan/photo → local.
  if (content.media.length) {
    sections.push(
      "",
      "=== FICHIERS JOINTS (plans/photos, à rattacher par nom) ===",
      content.media.map((m) => `- ${m.attachment.name} [${m.role}]`).join("\n")
    );
  }
  blocks.push({ type: "text", text: sections.join("\n") });

  // 2. PDF courts → vision native.
  for (const doc of content.dataDocs) {
    if (doc.pdfBase64) {
      blocks.push({
        type: "document",
        source: { type: "base64", media_type: "application/pdf", data: doc.pdfBase64 },
      });
    }
  }

  // 3. Images inline (signatures) → vision.
  for (const img of content.inlineImages) {
    if (IMAGE_MEDIA.test(img.contentType)) {
      blocks.push({
        type: "image",
        source: {
          type: "base64",
          media_type: img.contentType.toLowerCase() as "image/png" | "image/jpeg" | "image/gif" | "image/webp",
          data: img.base64,
        },
      });
    }
  }

  const raw = await runForcedTool({
    model: anthropicConfig().modelExtract,
    system: EXTRACT_SYSTEM,
    content: blocks,
    tool: extractTool as unknown as Parameters<typeof runForcedTool>[0]["tool"],
    maxTokens: 16_000,
  });

  const parsed = extractionSchema.parse(raw);
  return postProcess(parsed);
}

/** Garde-fous code-side : préférence mobile sur le téléphone du contact. */
function postProcess(ext: Extraction): Extraction {
  const tel = ext.broker.contact.telephone;
  if (tel) {
    // si plusieurs numéros collés ("04 ... / 06 ..."), garder le mobile
    const candidates = tel.split(/[\/;|]| ou /i).map((s) => s.trim()).filter(Boolean);
    const chosen = preferMobile(candidates.length > 1 ? candidates : [tel]);
    if (chosen) ext.broker.contact.telephone = chosen;
  }
  return ext;
}
