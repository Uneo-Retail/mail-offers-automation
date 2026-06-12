import { test } from "node:test";
import assert from "node:assert/strict";
import { pdfToText, isSmallPdf } from "../src/extract/pdf.js";

/**
 * Construit un PDF minimal valide (1 page, un texte), avec table xref correcte,
 * afin de tester l'extraction de couche texte SANS dépendre d'un worker externe
 * (le correctif serverless force l'exécution main-thread).
 */
function buildMinimalPdf(text: string): Buffer {
  const enc = (s: string) => Buffer.from(s, "latin1");
  const header = "%PDF-1.4\n";
  const stream = `BT /F1 24 Tf 20 100 Td (${text}) Tj ET\n`;
  const objects = [
    "<< /Type /Catalog /Pages 2 0 R >>",
    "<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
    "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 300 144] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
    `<< /Length ${Buffer.byteLength(stream, "latin1")} >>\nstream\n${stream}endstream`,
    "<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
  ];

  let body = header;
  const offsets: number[] = [];
  objects.forEach((obj, i) => {
    offsets.push(Buffer.byteLength(body, "latin1"));
    body += `${i + 1} 0 obj\n${obj}\nendobj\n`;
  });

  const xrefPos = Buffer.byteLength(body, "latin1");
  let xref = `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (const off of offsets) {
    xref += `${String(off).padStart(10, "0")} 00000 n \n`;
  }
  const trailer = `trailer\n<< /Size ${objects.length + 1} /Root 1 0 R >>\nstartxref\n${xrefPos}\n%%EOF`;

  return enc(body + xref + trailer);
}

test("pdfToText : extrait la couche texte d'un PDF (main-thread, sans worker externe)", async () => {
  const pdf = buildMinimalPdf("Hello Uneo Retail");
  const res = await pdfToText(pdf);
  assert.equal(res.pageCount, 1);
  assert.equal(res.pages.length, 1);
  assert.match(res.text, /Hello Uneo Retail/);
});

test("isSmallPdf : seuil de vision plein-PDF", () => {
  assert.equal(isSmallPdf(1), true);
  assert.equal(isSmallPdf(10), true);
  assert.equal(isSmallPdf(11), false);
  assert.equal(isSmallPdf(0), false);
});
