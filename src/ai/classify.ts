/**
 * Classification / routage (Haiku, tool use forcé).
 */
import type { ExtractedContent, IncomingMail } from "../types.js";
import { anthropicConfig } from "../config.js";
import { runForcedTool } from "./client.js";
import { classificationSchema, classifyTool, type Classification } from "./schemas.js";
import { CLASSIFY_SYSTEM, buildClassifyUser } from "./prompts/classify.js";

export async function classifyMail(
  mail: IncomingMail,
  content: ExtractedContent
): Promise<Classification> {
  const attachments = [
    ...content.dataDocs.map((d) => ({
      name: d.attachment.name,
      preview: d.text?.slice(0, 300),
    })),
    ...content.media.map((m) => ({ name: m.attachment.name })),
  ];
  // un aperçu des liens suivis aide aussi le routage
  const linkPreview = content.links.map((l) => `Lien ${l.url} : ${(l.text ?? "").slice(0, 200)}`).join("\n");
  const body = [content.bodyText, linkPreview].filter(Boolean).join("\n\n");

  const user = buildClassifyUser({
    from: `${mail.from.name ?? ""} <${mail.from.email ?? ""}>`.trim(),
    subject: mail.subject,
    body,
    attachments,
  });

  const raw = await runForcedTool({
    model: anthropicConfig().modelClassify,
    system: CLASSIFY_SYSTEM,
    content: [{ type: "text", text: user }],
    tool: classifyTool as unknown as Parameters<typeof runForcedTool>[0]["tool"],
    maxTokens: 1024,
  });

  return classificationSchema.parse(raw);
}
