import { test } from "node:test";
import assert from "node:assert/strict";
import { parseCityFromAddress } from "../src/notion/places.js";
import { emplacementMatches } from "../src/notion/emplacements.js";

test("parseCityFromAddress : extrait la ville après le code postal", () => {
  assert.equal(parseCityFromAddress("15 rue Sommeiller, 74000 Annecy"), "Annecy");
  assert.equal(parseCityFromAddress("67 Bd Jean Jaurès 92100 Boulogne"), "Boulogne");
  assert.equal(parseCityFromAddress("20-22 rue de Turenne, 75003 Paris"), "Paris");
  assert.equal(parseCityFromAddress("rue sans ville"), null);
});

function page(title: string, rel?: { Ville?: string[]; Pays?: string[] }) {
  const properties: Record<string, unknown> = {
    Nom: { title: [{ plain_text: title }] },
  };
  if (rel?.Ville) properties["Ville"] = { relation: rel.Ville.map((id) => ({ id })) };
  if (rel?.Pays) properties["Pays"] = { relation: rel.Pays.map((id) => ({ id })) };
  return { properties };
}

test("emplacementMatches : même nom+ville+pays → réutilise (pas de doublon)", () => {
  const p = page("Centre Commercial Parly 2", { Ville: ["v1"], Pays: ["p1"] });
  assert.equal(emplacementMatches(p, "Nom", { nom: "centre commercial parly 2" }, { villeId: "v1", paysId: "p1" }), true);
});

test("emplacementMatches : ville différente → pas un doublon", () => {
  const p = page("Grand Maine", { Ville: ["angers"] });
  assert.equal(emplacementMatches(p, "Nom", { nom: "Grand Maine" }, { villeId: "autre-ville" }), false);
});

test("emplacementMatches : nom différent → pas un doublon", () => {
  const p = page("Rosny 2");
  assert.equal(emplacementMatches(p, "Nom", { nom: "Parly 2" }, {}), false);
});

test("emplacementMatches : candidat sans relation ville → match sur le nom seul", () => {
  const p = page("Parly 2"); // pas de Ville posée côté existant
  assert.equal(emplacementMatches(p, "Nom", { nom: "Parly 2" }, { villeId: "v1" }), true);
});
