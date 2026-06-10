import { test } from "node:test";
import assert from "node:assert/strict";
import { formatDivergenceNote } from "../src/util/observations.js";

test("formatDivergenceNote : format exact attendu (cas 34223)", () => {
  assert.equal(
    formatDivergenceNote("loyer annuel", "78 385 €", "description", "78 835 €", "conditions financières"),
    "Montant à vérifier — loyer annuel : 78 385 € (description) vs 78 835 € (conditions financières) ; retenu 78 835 €."
  );
});
