/**
 * Microsoft Graph — delta query de la boîte, lecture d'un message complet +
 * pièces jointes, et envoi des notifications (reply au fil).
 */
import { graphConfig } from "../config.js";
import { graphFetch } from "./auth.js";
import type { IncomingMail, MailAttachment } from "../types.js";
import { log } from "../log.js";

interface GraphMessage {
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject?: string;
  from?: { emailAddress?: { name?: string; address?: string } };
  toRecipients?: { emailAddress?: { name?: string; address?: string } }[];
  receivedDateTime?: string;
  body?: { contentType?: string; content?: string };
  bodyPreview?: string;
  webLink?: string;
  hasAttachments?: boolean;
  isDraft?: boolean;
  internetMessageHeaders?: { name: string; value: string }[];
  "@removed"?: unknown;
}

const SELECT =
  "id,internetMessageId,conversationId,subject,from,toRecipients,receivedDateTime,bodyPreview,webLink,hasAttachments,isDraft,internetMessageHeaders";

function mailboxPath(): string {
  return `/users/${encodeURIComponent(graphConfig().mailbox)}`;
}

export interface DeltaResult {
  /** ids des messages nouveaux/modifiés (hors suppressions) */
  messageIds: string[];
  nextDeltaLink: string;
}

/**
 * Récupère les changements depuis `deltaLink`. Sans deltaLink (1er run), démarre
 * une nouvelle session delta sur l'inbox. Suit la pagination @odata.nextLink.
 */
export async function deltaMessages(deltaLink?: string | null): Promise<DeltaResult> {
  let url =
    deltaLink ??
    `${mailboxPath()}/mailFolders/inbox/messages/delta?$select=${SELECT}`;
  const messageIds: string[] = [];
  let nextDeltaLink = "";

  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await graphFetch(url);
    if (!res.ok) throw new Error(`delta error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      value: GraphMessage[];
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };
    for (const m of json.value) {
      if (m["@removed"]) continue;
      if (m.isDraft) continue;
      messageIds.push(m.id);
    }
    if (json["@odata.nextLink"]) {
      url = json["@odata.nextLink"];
      continue;
    }
    nextDeltaLink = json["@odata.deltaLink"] ?? "";
    break;
  }
  return { messageIds, nextDeltaLink };
}

/**
 * Amorçage : parcourt tout le delta de l'inbox SANS collecter de message, et
 * renvoie le `@odata.deltaLink` final. Sert à poser une « ligne de départ
 * maintenant » : aucun mail historique n'est traité, seuls les mails reçus
 * après l'amorçage le seront aux runs suivants.
 */
export async function primeDeltaLink(): Promise<string> {
  let url = `${mailboxPath()}/mailFolders/inbox/messages/delta?$select=${SELECT}`;
  // eslint-disable-next-line no-constant-condition
  while (true) {
    const res = await graphFetch(url);
    if (!res.ok) throw new Error(`prime delta error ${res.status}: ${await res.text()}`);
    const json = (await res.json()) as {
      "@odata.nextLink"?: string;
      "@odata.deltaLink"?: string;
    };
    if (json["@odata.nextLink"]) {
      url = json["@odata.nextLink"];
      continue;
    }
    return json["@odata.deltaLink"] ?? "";
  }
}

export async function getMessage(messageId: string): Promise<IncomingMail> {
  const res = await graphFetch(
    `${mailboxPath()}/messages/${messageId}?$select=${SELECT.replace("bodyPreview", "bodyPreview,body")}`
  );
  if (!res.ok) throw new Error(`getMessage error ${res.status}: ${await res.text()}`);
  const m = (await res.json()) as GraphMessage;

  const attachments = m.hasAttachments ? await getAttachments(messageId) : [];
  const headers: Record<string, string> = {};
  for (const h of m.internetMessageHeaders ?? []) headers[h.name.toLowerCase()] = h.value;

  const html = m.body?.contentType?.toLowerCase() === "html" ? m.body.content : undefined;
  const text = m.body?.contentType?.toLowerCase() === "text" ? m.body.content : m.bodyPreview;

  return {
    id: m.id,
    internetMessageId: m.internetMessageId,
    conversationId: m.conversationId,
    subject: m.subject ?? "",
    from: { name: m.from?.emailAddress?.name, email: m.from?.emailAddress?.address },
    toRecipients: (m.toRecipients ?? []).map((r) => ({
      name: r.emailAddress?.name,
      email: r.emailAddress?.address,
    })),
    receivedAt: m.receivedDateTime,
    bodyHtml: html,
    bodyText: text,
    webLink: m.webLink,
    attachments,
    headers,
  };
}

interface GraphAttachment {
  "@odata.type": string;
  id: string;
  name?: string;
  contentType?: string;
  size?: number;
  isInline?: boolean;
  contentId?: string;
  contentBytes?: string; // base64 (fileAttachment)
}

export async function getAttachments(messageId: string): Promise<MailAttachment[]> {
  const res = await graphFetch(`${mailboxPath()}/messages/${messageId}/attachments`);
  if (!res.ok) {
    log.warn("getAttachments: échec", { messageId, status: res.status });
    return [];
  }
  const json = (await res.json()) as { value: GraphAttachment[] };
  const out: MailAttachment[] = [];
  for (const a of json.value) {
    if (!a["@odata.type"].includes("fileAttachment")) {
      // itemAttachment / referenceAttachment non gérés en MVP
      log.debug("getAttachments: type ignoré", { type: a["@odata.type"], name: a.name });
      continue;
    }
    out.push({
      id: a.id,
      name: a.name ?? "fichier",
      contentType: a.contentType ?? "application/octet-stream",
      size: a.size ?? 0,
      isInline: !!a.isInline,
      contentId: a.contentId,
      content: a.contentBytes ? Buffer.from(a.contentBytes, "base64") : undefined,
    });
  }
  return out;
}

/** Répond au fil (à soi-même : le owner de la boîte connectée). */
export async function replyToSelf(messageId: string, htmlBody: string): Promise<void> {
  const mailbox = graphConfig().mailbox;
  const res = await graphFetch(`${mailboxPath()}/messages/${messageId}/reply`, {
    method: "POST",
    body: JSON.stringify({
      message: { toRecipients: [{ emailAddress: { address: mailbox } }] },
      comment: htmlBody,
    }),
  });
  if (!res.ok) {
    throw new Error(`replyToSelf error ${res.status}: ${await res.text()}`);
  }
}
