import { test } from "node:test";
import assert from "node:assert/strict";
import { extractionSchema, classificationSchema } from "../src/ai/schemas.js";

test("classificationSchema : accepte une décision valide, rejette une route inconnue", () => {
  assert.doesNotThrow(() =>
    classificationSchema.parse({ route: "offre", type_offre: "cession", confiance: 0.9, raison: "x" })
  );
  assert.throws(() =>
    classificationSchema.parse({ route: "peut-être", type_offre: "cession", confiance: 0.9, raison: "x" })
  );
});

test("extractionSchema : accepte une extraction Zadig (1 local cession)", () => {
  const zadigAnnecy = {
    centre: null,
    broker: {
      societe: "Marcle Immobilier",
      societe_url: null,
      contact: {
        nom_complet: "Jean Nocentini",
        email: "marcleimmobilier@orange.fr",
        telephone: "06 09 50 18 61",
        role: null,
        adresse_postale: null,
        source: "expediteur",
      },
    },
    locaux: [
      {
        nom: "Annecy - 15 rue Sommeiller",
        adresse_complete: "15 rue Sommeiller, Annecy",
        type_emplacement: "Rue",
        surface_rdc: 86,
        surface_r_moins_1: null,
        surface_r_plus_1: null,
        surface_r_plus_2: null,
        surface_ponderee: 115,
        loyer_annuel_fixe: 33224,
        loyer_annuel_variable_pct: null,
        charges_locatives_annuelles: null,
        droit_au_bail: 350000,
        tf_annuelle: null,
        duree_ferme: [],
        date_fin_bail: null,
        annee_bail: null,
        environnement_commercial: null,
        fichiers: { plan: null, photo: null },
      },
    ],
  };
  const parsed = extractionSchema.parse(zadigAnnecy);
  assert.equal(parsed.locaux.length, 1);
  assert.equal(parsed.locaux[0]!.droit_au_bail, 350000);
  assert.equal(parsed.broker.societe, "Marcle Immobilier");
});

test("extractionSchema : applique les défauts duree_ferme/fichiers", () => {
  const parsed = extractionSchema.parse({
    centre: null,
    broker: { societe: null, societe_url: null, contact: { nom_complet: null, email: null, telephone: null, role: null, adresse_postale: null, source: null } },
    locaux: [{ nom: "Local X" }],
  });
  assert.deepEqual(parsed.locaux[0]!.duree_ferme, []);
  assert.deepEqual(parsed.locaux[0]!.fichiers, { plan: null, photo: null });
});

test("extractionSchema : accepte observations renseigné ou null", () => {
  const base = {
    centre: null,
    broker: { societe: null, societe_url: null, contact: { nom_complet: null, email: null, telephone: null, role: null, adresse_postale: null, source: null } },
  };
  const withObs = extractionSchema.parse({
    ...base,
    locaux: [{ nom: "Paris IX", observations: "Dépôt de garantie : 28 750 €\nHonoraires : 27 000 € HT" }],
  });
  assert.match(withObs.locaux[0]!.observations!, /28 750/);

  const withNull = extractionSchema.parse({ ...base, locaux: [{ nom: "X", observations: null }] });
  assert.equal(withNull.locaux[0]!.observations ?? null, null);
});

test("extractionSchema : rejette un type_emplacement hors liste", () => {
  assert.throws(() =>
    extractionSchema.parse({
      centre: null,
      broker: { societe: null, societe_url: null, contact: { nom_complet: null, email: null, telephone: null, role: null, adresse_postale: null, source: null } },
      locaux: [{ nom: "X", type_emplacement: "Sous-marin" }],
    })
  );
});
