import { test } from "node:test";
import assert from "node:assert/strict";
import * as XLSX from "xlsx";
import { htmlToText } from "../src/extract/html.js";
import { xlsxToText } from "../src/extract/xlsx.js";
import { triageAttachments, matchMediaToLocal } from "../src/extract/attachments.js";
import { normalizeKey, preferMobile, parseAmount, digitsOnly } from "../src/util/normalize.js";
import type { MailAttachment } from "../src/types.js";

test("htmlToText : nettoie le balisage et coupe la citation de transfert", () => {
  const html = `<html><body>
    <p>Bonjour,</p>
    <p>Je vous transmets un bien susceptible de correspondre à votre recherche.</p>
    <p>Cordialement<br>Jean</p>
    <div>-----Message d'origine-----<br>De : quelqu'un@x.com<br>contenu cité à ignorer</div>
  </body></html>`;
  const { text } = htmlToText(html);
  assert.match(text, /susceptible de correspondre/);
  assert.doesNotMatch(text, /contenu cité à ignorer/);
});

test("htmlToText : extrait les liens http(s)", () => {
  const html = `<a href="https://exemple.fr/offre/123">Voir l'offre</a> <a href="mailto:x@y.fr">mail</a>`;
  const { links } = htmlToText(html);
  assert.equal(links.length, 1);
  assert.equal(links[0]!.url, "https://exemple.fr/offre/123");
});

test("xlsxToText : convertit une feuille en CSV texte avec en-têtes", () => {
  const rows = [
    ["ADRESSE", "SURFACE AU BAIL", "Loyer HT HC", "PRIX DE CESSION"],
    ["15 rue Sommeiller, Annecy", 115, 33224, 350000],
    ["67 Bd Jean Jaurès, Boulogne", 258, 304506, 50000],
  ];
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "Offres");
  const buf = XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;

  const text = xlsxToText(buf);
  assert.match(text, /Feuille : Offres/);
  assert.match(text, /ADRESSE;SURFACE AU BAIL/);
  assert.match(text, /Sommeiller/);
  assert.match(text, /350000/);
});

test("triageAttachments : sépare données, médias et inline", () => {
  const mk = (over: Partial<MailAttachment>): MailAttachment => ({
    id: "x", name: "f", contentType: "application/octet-stream", size: 1,
    isInline: false, content: Buffer.from(""), ...over,
  });
  const res = triageAttachments([
    mk({ name: "offre.xlsx", contentType: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" }),
    mk({ name: "ANNECY CV SOMMEILLER PLAN.pdf", contentType: "image/png" }),
    mk({ name: "ANNECY CV SOMMEILLER PHOTO.jpg", contentType: "image/jpeg" }),
    mk({ name: "signature.png", contentType: "image/png", isInline: true, contentId: "sig1" }),
  ]);
  assert.equal(res.dataAttachments.length, 1);
  assert.equal(res.media.length, 2);
  assert.equal(res.inline.length, 1);
  assert.equal(res.media.find((m) => /PLAN/.test(m.normalizedName))!.role, "plan");
});

test("matchMediaToLocal : rattache un plan au bon local par nom de fichier", () => {
  const localKeys = [normalizeKey("Annecy 15 rue Sommeiller"), normalizeKey("Boulogne 67 Bd Jean Jaurès")];
  const media = {
    attachment: {} as MailAttachment,
    role: "plan" as const,
    normalizedName: normalizeKey("ANNECY CV SOMMEILLER PLAN.pdf"),
  };
  assert.equal(matchMediaToLocal(media, localKeys), 0);
});

test("preferMobile : choisit le 06 plutôt que le fixe", () => {
  assert.equal(digitsOnly("04 93 39 00 64"), "0493390064");
  assert.equal(preferMobile(["04 93 39 00 64", "06 09 50 18 61"]), "06 09 50 18 61");
  assert.equal(preferMobile(["+33 (0)6 09 50 18 61"]), "+33 (0)6 09 50 18 61");
});

test("parseAmount : parse les montants FR", () => {
  assert.equal(parseAmount("33 224 €"), 33224);
  assert.equal(parseAmount("1 000 000"), 1000000);
  assert.equal(parseAmount("334.900"), 334900);
  assert.equal(parseAmount("12,5"), 12.5);
  assert.equal(parseAmount("En attente"), null);
});
