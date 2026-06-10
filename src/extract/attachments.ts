/**
 * Tri des pièces jointes : données (xlsx, pdf descriptif) vs médias (plan, photo),
 * et préparation du matching média → local par nom de fichier.
 */
import type { MailAttachment, MediaFile } from "../types.js";
import { normalizeKey } from "../util/normalize.js";

const IMAGE_TYPES = /^image\//i;
const PLAN_HINTS = /\b(PLAN|MASSE|CADASTRE)\b/;
const PHOTO_HINTS = /\b(PHOTO|PIC|IMG|FACADE|VITRINE|CODATA)\b/;
const MEDIA_HINTS = new RegExp(`${PLAN_HINTS.source}|${PHOTO_HINTS.source}`);

export interface TriagedAttachments {
  dataAttachments: MailAttachment[];
  media: MediaFile[];
  /** images inline (signatures, logos) — traitées à part en vision */
  inline: MailAttachment[];
}

function isDataDoc(att: MailAttachment): boolean {
  const n = att.name.toLowerCase();
  if (n.endsWith(".xlsx") || n.endsWith(".xls") || n.endsWith(".csv")) return true;
  if (n.endsWith(".pdf")) return true;
  if (/spreadsheet|excel|csv|pdf/i.test(att.contentType)) return true;
  return false;
}

function mediaRole(att: MailAttachment): "plan" | "photo" {
  const key = normalizeKey(att.name);
  if (PLAN_HINTS.test(key)) return "plan";
  if (PHOTO_HINTS.test(key)) return "photo";
  // défaut : une image non étiquetée est traitée comme photo
  return "photo";
}

export function triageAttachments(attachments: MailAttachment[]): TriagedAttachments {
  const dataAttachments: MailAttachment[] = [];
  const media: MediaFile[] = [];
  const inline: MailAttachment[] = [];

  for (const att of attachments) {
    if (att.isInline && IMAGE_TYPES.test(att.contentType)) {
      // image inline = signature/logo : candidate à la vision, pas un média de local
      inline.push(att);
      continue;
    }
    const key = normalizeKey(att.name);
    const looksLikeImage =
      IMAGE_TYPES.test(att.contentType) || /\.(jpe?g|png|gif|webp|tiff?)$/i.test(att.name);
    // Un fichier nommé PLAN/PHOTO/CODATA (même en .pdf) est un média de local,
    // pas un document de données à donner au modèle.
    if (MEDIA_HINTS.test(key) || looksLikeImage) {
      media.push({ attachment: att, role: mediaRole(att), normalizedName: key });
      continue;
    }
    if (isDataDoc(att)) {
      dataAttachments.push(att);
      continue;
    }
    // type inconnu : on le garde comme donnée (best-effort), il sera ignoré si illisible
    dataAttachments.push(att);
  }

  return { dataAttachments, media, inline };
}

/**
 * Associe un média au local dont le nom/adresse normalisé partage le plus de
 * tokens avec le nom de fichier. Retourne l'index du local gagnant, ou -1.
 *
 * @param localKeys  clés normalisées des locaux (nom + adresse concaténés)
 */
export function matchMediaToLocal(media: MediaFile, localKeys: string[]): number {
  const fileTokens = new Set(media.normalizedName.split(" ").filter((t) => t.length >= 3));
  if (fileTokens.size === 0) return -1;

  let best = -1;
  let bestScore = 0;
  localKeys.forEach((key, idx) => {
    const localTokens = key.split(" ").filter((t) => t.length >= 3);
    let score = 0;
    for (const t of localTokens) if (fileTokens.has(t)) score++;
    if (score > bestScore) {
      bestScore = score;
      best = idx;
    }
  });
  // exiger au moins un token significatif commun
  return bestScore >= 1 ? best : -1;
}
