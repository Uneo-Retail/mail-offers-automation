/**
 * PDF → texte (couche texte) + métadonnées.
 *
 * Stratégie (cf. brief §5/§6) :
 *  - PDF court (< SMALL_PDF_PAGES) → on fournit aussi le base64, à passer en
 *    vision native à Sonnet (lecture fidèle, plans/tableaux mis en page).
 *  - Gros PDF (Terranae : 141 p.) → texte d'abord ; ne pas envoyer 141 pages en
 *    vision (coût/poids). La rastérisation ciblée des plans est une étape V2.
 */
/** Seuil au-delà duquel on ne propose plus la vision plein-PDF. */
export const SMALL_PDF_PAGES = 10;

export interface PdfExtraction {
  pageCount: number;
  text: string;
  /** texte par page (utile pour cibler une page plan plus tard) */
  pages: string[];
}

// Chargement paresseux du build legacy (compatible Node, sans worker).
async function getPdfjs(): Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> {
  return import("pdfjs-dist/legacy/build/pdf.mjs");
}

export async function pdfToText(buffer: Buffer): Promise<PdfExtraction> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
    // Pas de worker en environnement serverless Node.
    disableFontFace: true,
  }).promise;

  const pages: string[] = [];
  for (let i = 1; i <= doc.numPages; i++) {
    const page = await doc.getPage(i);
    const content = await page.getTextContent();
    const strings = content.items.map((it) =>
      "str" in it ? (it as { str: string }).str : ""
    );
    pages.push(strings.join(" ").replace(/\s+/g, " ").trim());
    page.cleanup();
  }
  await doc.destroy();

  return {
    pageCount: doc.numPages,
    pages,
    text: pages
      .map((p, idx) => (p ? `--- page ${idx + 1} ---\n${p}` : ""))
      .filter(Boolean)
      .join("\n\n"),
  };
}

export function isSmallPdf(pageCount: number): boolean {
  return pageCount > 0 && pageCount <= SMALL_PDF_PAGES;
}
