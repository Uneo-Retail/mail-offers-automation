/**
 * Parseur `.eml` (MIME) → `IncomingMail`, pour rejouer de vrais mails hors Graph.
 */
import { simpleParser, type AddressObject, type Attachment } from "mailparser";
import type { IncomingMail, MailAttachment } from "../../src/types.js";

function firstAddress(a: AddressObject | AddressObject[] | undefined): { name?: string; email?: string } {
  const obj = Array.isArray(a) ? a[0] : a;
  const v = obj?.value?.[0];
  return { name: v?.name || undefined, email: v?.address || undefined };
}

function allAddresses(a: AddressObject | AddressObject[] | undefined): { name?: string; email?: string }[] {
  const objs = Array.isArray(a) ? a : a ? [a] : [];
  return objs.flatMap((o) => o.value.map((v) => ({ name: v.name || undefined, email: v.address || undefined })));
}

function toAttachment(att: Attachment, idx: number): MailAttachment {
  return {
    id: att.cid ?? att.checksum ?? `att-${idx}`,
    name: att.filename ?? `fichier-${idx}`,
    contentType: att.contentType ?? "application/octet-stream",
    size: att.size ?? att.content?.length ?? 0,
    content: att.content ? Buffer.from(att.content) : undefined,
    isInline: att.contentDisposition === "inline" || !!att.related,
    contentId: att.cid ?? undefined,
  };
}

export async function parseEml(raw: Buffer | string, id = "eml-fixture"): Promise<IncomingMail> {
  const parsed = await simpleParser(raw);
  return {
    id,
    internetMessageId: parsed.messageId,
    subject: parsed.subject ?? "",
    from: firstAddress(parsed.from),
    toRecipients: allAddresses(parsed.to),
    receivedAt: (parsed.date ?? new Date()).toISOString(),
    bodyHtml: parsed.html || undefined,
    bodyText: parsed.text || undefined,
    attachments: parsed.attachments.map(toAttachment),
    headers: {},
  };
}
