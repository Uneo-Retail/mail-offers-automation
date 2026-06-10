import { test } from "node:test";
import assert from "node:assert/strict";
import { societeFromUrl } from "../src/notion/resolve.js";
import { buildNotes } from "../src/notion/magasins.js";

test("societeFromUrl : déduit le nom propre depuis une URL", () => {
  assert.equal(societeFromUrl("www.icg-commerce.fr"), "Icg Commerce");
  assert.equal(societeFromUrl("https://www.terranae.com"), "Terranae");
  assert.equal(societeFromUrl("realtyz.fr"), "Realtyz");
});

test("buildNotes : concatène environnement_commercial puis observations, une info par ligne", () => {
  assert.equal(
    buildNotes({ environnement_commercial: "Mitoyen Sephora, Zara", observations: "Dépôt : 28 750 €\nBail : 3/6/9" }),
    "Mitoyen Sephora, Zara\nDépôt : 28 750 €\nBail : 3/6/9"
  );
});

test("buildNotes : observations seules suffisent", () => {
  assert.equal(buildNotes({ environnement_commercial: null, observations: "Emplacement : n°1" }), "Emplacement : n°1");
});

test("buildNotes : null si les deux sont vides", () => {
  assert.equal(buildNotes({ environnement_commercial: null, observations: null }), null);
});
