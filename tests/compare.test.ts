import { test } from "node:test";
import assert from "node:assert/strict";
import { compareClassification, compareExtraction, type Expected } from "./fixtures/compare.js";
import { extractionSchema, type Extraction } from "../src/ai/schemas.js";

function ext(over: Partial<Extraction>): Extraction {
  return extractionSchema.parse({
    centre: null,
    broker: { societe: null, societe_url: null, contact: { nom_complet: null, email: null, telephone: null, role: null, adresse_postale: null, source: null } },
    locaux: [],
    ...over,
  });
}

test("compareClassification : route OK / KO", () => {
  const checks = compareClassification({ route: "bruit" }, { route: "offre", type_offre: "inconnu", confiance: 0.2, raison: "x" });
  assert.equal(checks[0]!.ok, false);
});

test("compareExtraction : montants comparés en numérique, télephone en chiffres", () => {
  const e = ext({
    broker: { societe: "Marcle Immobilier", societe_url: null, contact: { nom_complet: null, email: "MARCLE@orange.FR", telephone: "06 09 50 18 61", role: null, adresse_postale: null, source: null } },
    locaux: [extractionSchema.shape.locaux.element.parse({ nom: "Annecy 15 rue Sommeiller", surface_rdc: 86, surface_ponderee: 115, loyer_annuel_fixe: 33224, droit_au_bail: 350000 })],
  });
  const expected: Expected = {
    nb_locaux: 1,
    broker: { societe: "marcle immobilier", contact: { email: "marcle@orange.fr", telephone: "0609501861" } },
    locaux: [{ match: "Annecy", surface_rdc: 86, surface_ponderee: 115, loyer_annuel_fixe: 33224, droit_au_bail: 350000 }],
  };
  const checks = compareExtraction(expected, e);
  assert.ok(checks.every((c) => c.ok), JSON.stringify(checks.filter((c) => !c.ok)));
});

test("compareExtraction : null attendu = champ doit être absent (cas plaquette)", () => {
  const e = ext({
    centre: { nom: "Grand Maine", adresse_complete: null, type_emplacement: "Centre Commercial", locomotive: "Carrefour", superficie_m2: 32000, surface_hypermarche_m2: null, flux_visiteurs: null, description: null, total_magasins: 80 },
    locaux: [extractionSchema.shape.locaux.element.parse({ nom: "Local dispo", surface_ponderee: 200, loyer_annuel_fixe: null })],
  });
  const checksOk = compareExtraction({ centre_present: true, locaux_all: { loyer_annuel_fixe: null } }, e);
  assert.ok(checksOk.every((c) => c.ok));

  const e2 = ext({ locaux: [extractionSchema.shape.locaux.element.parse({ nom: "X", loyer_annuel_fixe: 99000 })] });
  const checksKo = compareExtraction({ locaux_all: { loyer_annuel_fixe: null } }, e2);
  assert.equal(checksKo.find((c) => c.label === "locaux_all.loyer_annuel_fixe")!.ok, false);
});

test("compareExtraction : local introuvable → échec explicite", () => {
  const e = ext({ locaux: [extractionSchema.shape.locaux.element.parse({ nom: "Paris" })] });
  const checks = compareExtraction({ locaux: [{ match: "Marseille", surface_rdc: 50 }] }, e);
  assert.equal(checks[0]!.ok, false);
  assert.equal(checks[0]!.got, "introuvable");
});
