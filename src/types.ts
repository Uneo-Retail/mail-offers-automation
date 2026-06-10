/**
 * Types de domaine partagés à travers le pipeline.
 */

/** Pièce jointe normalisée, telle que renvoyée par Graph. */
export interface MailAttachment {
  /** id Graph de la pièce jointe */
  id: string;
  name: string;
  contentType: string;
  size: number;
  /** contenu binaire décodé (présent pour les fileAttachment) */
  content?: Buffer;
  /** true si pièce jointe inline (image de signature, logo…) */
  isInline: boolean;
  /** cid pour les inline (référencé dans le HTML) */
  contentId?: string;
}

/** Mail entrant normalisé (sortie de la couche Graph). */
export interface IncomingMail {
  /** messageId Graph (clé de dédoublonnage) */
  id: string;
  internetMessageId?: string;
  conversationId?: string;
  subject: string;
  from: { name?: string; email?: string };
  toRecipients: { name?: string; email?: string }[];
  receivedAt?: string;
  bodyHtml?: string;
  bodyText?: string;
  webLink?: string;
  attachments: MailAttachment[];
  /** en-têtes utiles aux garde-fous (auto-reply, listes…) */
  headers?: Record<string, string>;
}

/** Classe de fichier après tri. */
export type FileKind = "data" | "media";

/** Document portant des données (xlsx, pdf descriptif). */
export interface DataDoc {
  attachment: MailAttachment;
  /** texte extrait (corps du xlsx en CSV, ou texte du PDF) */
  text?: string;
  /** pour un PDF court : base64 à passer en vision */
  pdfBase64?: string;
  /** nombre de pages (PDF) */
  pageCount?: number;
}

/** Média (plan, photo) à rattacher à un local par nom de fichier. */
export interface MediaFile {
  attachment: MailAttachment;
  /** "plan" ou "photo" déduit du nom */
  role: "plan" | "photo";
  /** clé normalisée du nom de fichier pour le matching */
  normalizedName: string;
}

/** Lien hypertexte trouvé dans le corps et suivi. */
export interface FetchedLink {
  url: string;
  text?: string;
}

/** Résultat de la couche d'extraction multi-format (déterministe, hors IA). */
export interface ExtractedContent {
  /** corps du mail nettoyé en texte */
  bodyText: string;
  /** documents porteurs de données */
  dataDocs: DataDoc[];
  /** médias (plans/photos) */
  media: MediaFile[];
  /** liens suivis + leur contenu texte */
  links: FetchedLink[];
  /** images inline (signatures) en base64, pour vision */
  inlineImages: { name: string; contentType: string; base64: string }[];
}
