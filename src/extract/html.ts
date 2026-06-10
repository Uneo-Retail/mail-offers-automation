/**
 * Corps HTML d'un mail → texte propre.
 *
 * Objectifs :
 *  - retirer le balisage en gardant la structure (sauts de ligne lisibles),
 *  - couper les citations de transfert/réponse (« De : … Envoyé : … », « > … »,
 *    blocs gmail_quote) pour ne garder que le contenu utile au modèle,
 *  - exposer les liens hypertexte présents dans le corps.
 */
import { parse, type HTMLElement } from "node-html-parser";

export interface HtmlExtraction {
  text: string;
  links: { url: string; text: string }[];
}

const BLOCK_TAGS = new Set([
  "p", "div", "br", "tr", "li", "h1", "h2", "h3", "h4", "h5", "h6",
  "table", "ul", "ol", "blockquote", "section", "article", "header", "footer",
]);

function walk(node: HTMLElement, out: string[]): void {
  for (const child of node.childNodes) {
    // node-html-parser : nodeType 3 = texte
    if (child.nodeType === 3) {
      const t = (child as unknown as { text: string }).text;
      const decoded = decodeEntities(t);
      if (decoded.trim()) out.push(decoded.replace(/\s+/g, " "));
      continue;
    }
    const el = child as HTMLElement;
    const tag = el.rawTagName?.toLowerCase();
    if (tag === "style" || tag === "script" || tag === "head") continue;
    if (tag === "br") {
      out.push("\n");
      continue;
    }
    const block = tag ? BLOCK_TAGS.has(tag) : false;
    if (block) out.push("\n");
    walk(el, out);
    if (block) out.push("\n");
  }
}

function decodeEntities(s: string): string {
  return s
    .replace(/&nbsp;/g, " ")
    .replace(/&amp;/g, "&")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&eacute;/g, "é")
    .replace(/&egrave;/g, "è")
    .replace(/&agrave;/g, "à")
    .replace(/&ccedil;/g, "ç");
}

/** Coupe la première citation de transfert/réponse rencontrée. */
function stripQuotedReplies(text: string): string {
  const lines = text.split("\n");
  const markers = [
    /^\s*-{2,}\s*(message d'origine|message transféré|forwarded message|original message)/i,
    /^\s*de\s*:\s.+/i, // "De : X" en début de bloc cité (FR Outlook)
    /^\s*from\s*:\s.+/i,
    /^\s*le\s.+\sa écrit\s*:/i,
    /^\s*on\s.+wrote:\s*$/i,
    /^\s*_{5,}\s*$/,
  ];
  for (let i = 0; i < lines.length; i++) {
    const l = lines[i]!;
    if (markers.some((m) => m.test(l))) {
      // ne couper que si du contenu utile précède
      const before = lines.slice(0, i).join("\n").trim();
      if (before.length > 0) return before;
    }
  }
  return text;
}

export function htmlToText(html: string): HtmlExtraction {
  const root = parse(html, { comment: false });
  const links: { url: string; text: string }[] = [];
  for (const a of root.querySelectorAll("a")) {
    const url = a.getAttribute("href");
    if (url && /^https?:\/\//i.test(url)) {
      links.push({ url, text: a.text.trim() });
    }
  }
  const out: string[] = [];
  walk(root, out);
  let text = out
    .join("")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .replace(/[ \t]{2,}/g, " ")
    .trim();
  text = stripQuotedReplies(text);
  // dédoublonner les liens
  const seen = new Set<string>();
  const uniqueLinks = links.filter((l) => {
    if (seen.has(l.url)) return false;
    seen.add(l.url);
    return true;
  });
  return { text, links: uniqueLinks };
}
