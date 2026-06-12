import { test } from "node:test";
import assert from "node:assert/strict";
import { serializeError } from "../src/log.js";

test("serializeError : Error standard → 'Name: message'", () => {
  assert.equal(serializeError(new Error("boom")), "Error: boom");
  assert.equal(serializeError(new TypeError("bad type")), "TypeError: bad type");
});

test("serializeError : Error avec code/status → suffixe", () => {
  const e = Object.assign(new Error("not found"), { status: 404 });
  assert.equal(serializeError(e), "Error: not found (404)");
});

test("serializeError : objet d'erreur (Supabase/Notion/HTTP) → JSON lisible (fin du [object Object])", () => {
  const out = serializeError({ code: 42, message: "x" });
  assert.notEqual(out, "[object Object]");
  assert.match(out, /"x"/);
  assert.match(out, /42/);
});

test("serializeError : string → telle quelle", () => {
  assert.equal(serializeError("erreur brute"), "erreur brute");
});

test("serializeError : objet circulaire → ne lève pas (fallback String)", () => {
  const circular: Record<string, unknown> = {};
  circular.self = circular;
  assert.doesNotThrow(() => serializeError(circular));
});
