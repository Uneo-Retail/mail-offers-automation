import { test } from "node:test";
import assert from "node:assert/strict";
import { PropsBuilder } from "../src/notion/propsMap.js";
import type { DataSourceSchema } from "../src/notion/client.js";
import { log } from "../src/log.js";

/** Capture les appels log.warn le temps d'un callback. */
function captureWarns(fn: () => void): { msg: string; meta?: Record<string, unknown> }[] {
  const warns: { msg: string; meta?: Record<string, unknown> }[] = [];
  const orig = log.warn;
  log.warn = (msg, meta) => warns.push({ msg, meta });
  try {
    fn();
  } finally {
    log.warn = orig;
  }
  return warns;
}

const schema: DataSourceSchema = {
  Magasins: { id: "a", name: "Magasins", type: "relation" }, // le vrai nom est « Magasins »
  Nom: { id: "b", name: "Nom", type: "title" },
};

test("propsMap : valeur fournie sur une propriété absente → warn + non posée", () => {
  let builder: PropsBuilder;
  const warns = captureWarns(() => {
    builder = new PropsBuilder(schema);
    builder.relation("Magasin", ["page-id-123"]); // « Magasin » ≠ « Magasins »
  });
  assert.equal(warns.length, 1);
  assert.equal(warns[0]!.meta?.name, "Magasin");
  assert.equal(warns[0]!.meta?.found, "absente");
  assert.equal(builder!.build()["Magasin"], undefined);
});

test("propsMap : type inattendu → warn (found = type réel)", () => {
  const warns = captureWarns(() => {
    // on tente d'écrire « Magasins » (relation) comme un number
    new PropsBuilder(schema).number("Magasins", 42);
  });
  assert.equal(warns.length, 1);
  assert.equal(warns[0]!.meta?.found, "relation");
  assert.equal(warns[0]!.meta?.expectedType, "number");
});

test("propsMap : valeur nulle/vide → aucun warn (cas normal)", () => {
  const warns = captureWarns(() => {
    const b = new PropsBuilder(schema);
    b.relation("Magasin", null);
    b.relation("Magasins", []);
    b.text("Inexistante", null);
    b.number("Nom", undefined);
  });
  assert.equal(warns.length, 0);
});

test("propsMap : mapping correct → pas de warn, propriété posée", () => {
  let builder: PropsBuilder;
  const warns = captureWarns(() => {
    builder = new PropsBuilder(schema);
    builder.relation("Magasins", ["id1"]).title("Nom", "Annecy");
  });
  assert.equal(warns.length, 0);
  assert.deepEqual(builder!.build()["Magasins"], { relation: [{ id: "id1" }] });
});
