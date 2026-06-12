import { test } from "node:test";
import assert from "node:assert/strict";
import {
  buildMagasinTitle,
  buildOffreTitle,
  parseLotNumber,
  streetOnly,
  formatDateFr,
  placeKey,
} from "../src/notion/titles.js";

test("parseLotNumber : repère le numéro de lot dans observations", () => {
  assert.equal(parseLotNumber("Emplacement : Numéro 1"), "1");
  assert.equal(parseLotNumber("Emplacement : n°1 bis"), "1 bis");
  assert.equal(parseLotNumber("loyer 90000, surface 200"), null);
  assert.equal(parseLotNumber(null), null);
});

test("streetOnly : retire CP/ville", () => {
  assert.equal(streetOnly("15 rue Sommeiller, 74000 Annecy"), "15 rue Sommeiller");
  assert.equal(streetOnly("67 Bd Jean Jaurès 92100 Boulogne"), "67 Bd Jean Jaurès");
  assert.equal(streetOnly("Paris IX - Realtyz"), "Paris IX - Realtyz");
});

test("buildMagasinTitle : avec lot", () => {
  assert.equal(
    buildMagasinTitle({ observations: "Emplacement : Numéro 1", adresse: "15 rue Sommeiller, 74000 Annecy" }),
    "Lot N°1 - 15 rue Sommeiller"
  );
});

test("buildMagasinTitle : sans lot → juste la rue", () => {
  assert.equal(
    buildMagasinTitle({ observations: "rien", adresse: "15 rue Sommeiller, 74000 Annecy" }),
    "15 rue Sommeiller"
  );
});

test("buildMagasinTitle : sans adresse → nom du local", () => {
  assert.equal(buildMagasinTitle({ nom: "Paris IX - Realtyz" }), "Paris IX - Realtyz");
});

test("formatDateFr : ISO → JJ/MM/AAAA", () => {
  assert.equal(formatDateFr("2026-06-12"), "12/06/2026");
  assert.equal(formatDateFr("2026-06-12T09:00:00Z"), "12/06/2026");
  assert.equal(formatDateFr(null), "");
});

test("buildOffreTitle : broker + date + adresse", () => {
  assert.equal(
    buildOffreTitle({ brokerName: "Marcle Immobilier", dateIso: "2026-06-08", magasinAddress: "15 rue Sommeiller, Annecy" }),
    "Offre de Marcle Immobilier du 08/06/2026 à 15 rue Sommeiller, Annecy"
  );
});

test("buildOffreTitle : champs manquants gérés", () => {
  assert.equal(buildOffreTitle({ dateIso: "2026-06-08" }), "Offre du 08/06/2026");
});

test("placeKey : tolère casse/accents/St→Saint", () => {
  assert.equal(placeKey("Villeneuve-d'Ascq"), placeKey("villeneuve d ascq"));
  assert.equal(placeKey("St Étienne"), placeKey("Saint Etienne"));
});
