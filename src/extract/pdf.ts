/**
 * PDF → texte (couche texte) + métadonnées.
 *
 * Stratégie (cf. brief §5/§6) :
 *  - PDF court (< SMALL_PDF_PAGES) → on fournit aussi le base64, à passer en
 *    vision native à Sonnet (lecture fidèle, plans/tableaux mis en page).
 *  - Gros PDF (Terranae : 141 p.) → texte d'abord ; ne pas envoyer 141 pages en
 *    vision (coût/poids). La rastérisation ciblée des plans est une étape V2.
 *
 * ⚠️ Worker pdfjs en serverless (Vercel) : pdfjs v4 charge `pdf.worker.mjs` pour
 * exécuter le parsing (même en « fake worker » main-thread sous Node, il IMPORTE
 * le module worker). En production le fichier n'est pas packagé par défaut →
 * « Setting up fake worker failed: Cannot find module …/pdf.worker.mjs ». On fige
 * donc `GlobalWorkerOptions.workerSrc` sur le chemin RÉELLEMENT résolu dans
 * node_modules (via require.resolve), et on package ce fichier dans la fonction
 * Vercel via `includeFiles` (cf. vercel.json). Exécution sur le thread principal,
 * sans worker dédié.
 */
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);

/** Seuil au-delà duquel on ne propose plus la vision plein-PDF. */
export const SMALL_PDF_PAGES = 10;

export interface PdfExtraction {
  pageCount: number;
  text: string;
  /** texte par page (utile pour cibler une page plan plus tard) */
  pages: string[];
}

let pdfjsModule: typeof import("pdfjs-dist/legacy/build/pdf.mjs") | null = null;

// Chargement paresseux du build legacy + fixation du worker (une seule fois).
async function getPdfjs(): Promise<typeof import("pdfjs-dist/legacy/build/pdf.mjs")> {
  if (pdfjsModule) return pdfjsModule;
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  try {
    // Pointer sur le worker réellement présent dans le node_modules déployé.
    pdfjs.GlobalWorkerOptions.workerSrc = require.resolve("pdfjs-dist/legacy/build/pdf.worker.mjs");
  } catch {
    // Si la résolution échoue, laisser pdfjs gérer (mode dégradé) plutôt que crasher ici.
  }
  pdfjsModule = pdfjs;
  return pdfjs;
}

export async function pdfToText(buffer: Buffer): Promise<PdfExtraction> {
  const pdfjs = await getPdfjs();
  const data = new Uint8Array(buffer);
  const doc = await pdfjs.getDocument({
    data,
    isEvalSupported: false,
    useSystemFonts: true,
    disableFontFace: true,
    // Pas de fetch via worker : tout reste sur le thread principal en serverless.
    useWorkerFetch: false,
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
