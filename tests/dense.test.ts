import { test } from "node:test";
import assert from "node:assert/strict";
import { isDenseBrochure } from "../src/dense.js";

const CFG = { maxCenters: 5, maxPages: 30 };

test("isDenseBrochure : une offre normale n'est JAMAIS dense", () => {
  // cas Zadig : route offre, 7 locaux dans un tableau structuré
  const d = isDenseBrochure({ route: "offre", nbLocaux: 7, maxPdfPages: 0 }, CFG);
  assert.equal(d.dense, false);
  // même avec un gros PDF ou un flag, une offre reste non dense
  assert.equal(isDenseBrochure({ route: "offre", nbLocaux: 50, maxPdfPages: 141, denseFlag: true }, CFG).dense, false);
});

test("isDenseBrochure : faible_completude au-delà du seuil de centres → dense", () => {
  const d = isDenseBrochure({ route: "faible_completude", nbCentresEstime: 50, nbLocaux: 2, maxPdfPages: 10 }, CFG);
  assert.equal(d.dense, true);
  assert.equal(d.nbCentres, 50);
});

test("isDenseBrochure : faible_completude avec gros PDF → dense", () => {
  assert.equal(isDenseBrochure({ route: "faible_completude", nbLocaux: 1, maxPdfPages: 141 }, CFG).dense, true);
});

test("isDenseBrochure : faible_completude avec flag modèle → dense", () => {
  assert.equal(isDenseBrochure({ route: "faible_completude", denseFlag: true, nbLocaux: 0, maxPdfPages: 5 }, CFG).dense, true);
});

test("isDenseBrochure : faible_completude sous les seuils → traitement normal", () => {
  const d = isDenseBrochure({ route: "faible_completude", nbCentresEstime: 3, nbLocaux: 3, maxPdfPages: 12 }, CFG);
  assert.equal(d.dense, false);
});

test("isDenseBrochure : repli sur nbLocaux quand pas d'estimation", () => {
  assert.equal(isDenseBrochure({ route: "faible_completude", nbLocaux: 6, maxPdfPages: 0 }, CFG).dense, true);
  assert.equal(isDenseBrochure({ route: "faible_completude", nbLocaux: 5, maxPdfPages: 0 }, CFG).dense, false);
});
