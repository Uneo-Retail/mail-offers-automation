import { test } from "node:test";
import assert from "node:assert/strict";
import { buildMagasinNotesRichText, buildOffreNotesRichText } from "../src/notion/notes.js";
import { buildSuccessHtml } from "../src/mail/reply.js";
import { parseCityNames } from "../src/ai/zone.js";

// ── LOT 9 : Notes en rich text avec mentions + liens ─────────────────────────
test("buildMagasinNotesRichText : contient les mentions de page (IDs) et un lien Azure", () => {
  const rt = buildMagasinNotesRichText({
    brokerName: "Marcle Immobilier",
    brokerId: "broker-1",
    contactId: "contact-1",
    magasinId: "mag-1",
    emplacementId: "empl-1",
    villeId: "ville-1",
    dateFr: "08/06/2026",
    surfacePonderee: 115,
    loyer: 33224,
    bodyExcerpt: "Je vous transmets un bien.",
    documents: [{ name: "offre.xlsx", url: "https://blob.azure/offre.xlsx?sas" }],
  });
  const mentionIds = rt
    .filter((r) => (r as { type?: string }).type === "mention")
    .map((r) => ((r as { mention: { page: { id: string } } }).mention.page.id));
  // toutes les pages clés mentionnées
  for (const id of ["broker-1", "contact-1", "mag-1", "empl-1", "ville-1"]) {
    assert.ok(mentionIds.includes(id), `mention manquante : ${id}`);
  }
  // lien hypertexte Azure présent
  const hasLink = rt.some(
    (r) => (r as { text?: { link?: { url?: string } } }).text?.link?.url === "https://blob.azure/offre.xlsx?sas"
  );
  assert.ok(hasLink, "lien Azure manquant");
});

test("buildMagasinNotesRichText : sans IDs → pas de mention, texte broker brut", () => {
  const rt = buildMagasinNotesRichText({ brokerName: "ICG Commerce" });
  assert.ok(rt.every((r) => (r as { type?: string }).type !== "mention"));
  const text = rt.map((r) => (r as { text?: { content?: string } }).text?.content ?? "").join("");
  assert.match(text, /ICG Commerce a envoyé une offre/);
});

test("buildOffreNotesRichText : mentionne les magasins liés", () => {
  const rt = buildOffreNotesRichText({ brokerId: "b1", dateFr: "08/06/2026", magasinIds: ["m1", "m2"] });
  const ids = rt
    .filter((r) => (r as { type?: string }).type === "mention")
    .map((r) => (r as { mention: { page: { id: string } } }).mention.page.id);
  assert.deepEqual(ids.sort(), ["b1", "m1", "m2"]);
});

// ── LOT 8 : notification enrichie ────────────────────────────────────────────
test("buildSuccessHtml : lien vers la page Offre + mention interne avec le nom du broker", () => {
  const html = buildSuccessHtml("https://notion.so/offre123", "Marcle Immobilier");
  assert.match(html, /Traité par l'IA/);
  assert.match(html, /<a href="https:\/\/notion\.so\/offre123"><b>cette page<\/b><\/a>/);
  assert.match(html, /n'est pas visible par Marcle Immobilier/);
});

test("buildSuccessHtml : sans broker → fallback 'l'expéditeur'", () => {
  assert.match(buildSuccessHtml("https://x", null), /n'est pas visible par l'expéditeur/);
});

// ── LOT 5 : parsing des villes (zone de chalandise) ──────────────────────────
test("parseCityNames : nettoie puces/numéros, exclut la ville source, borne", () => {
  const text = `Voici les villes :
1. Roubaix
- Tourcoing (5 km)
* Croix
Villeneuve-d'Ascq
Marcq-en-Barœul;Wasquehal`;
  const cities = parseCityNames(text, "Villeneuve-d'Ascq", 10);
  assert.ok(cities.includes("Roubaix"));
  assert.ok(cities.includes("Tourcoing"));
  assert.ok(cities.includes("Croix"));
  assert.ok(cities.includes("Wasquehal"));
  assert.ok(!cities.includes("Villeneuve-d'Ascq"), "la ville source ne doit pas être listée");
});
