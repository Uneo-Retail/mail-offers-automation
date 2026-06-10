import { test } from "node:test";
import assert from "node:assert/strict";
import { selectBatch } from "../src/batch.js";

test("selectBatch : pas de troncature sous la limite", () => {
  const ids = Array.from({ length: 10 }, (_, i) => `m${i}`);
  const r = selectBatch(ids, 40);
  assert.equal(r.truncated, false);
  assert.equal(r.batch.length, 10);
  assert.equal(r.total, 10);
});

test("selectBatch : tronque à MAX_BATCH les plus anciens, signale truncated", () => {
  const ids = Array.from({ length: 100 }, (_, i) => `m${i}`);
  const r = selectBatch(ids, 40);
  assert.equal(r.truncated, true);
  assert.equal(r.batch.length, 40);
  assert.equal(r.total, 100);
  assert.equal(r.batch[0], "m0"); // les plus anciens d'abord
  assert.equal(r.batch[39], "m39");
});

test("selectBatch : limite exactement égale au total → pas de troncature", () => {
  const ids = Array.from({ length: 40 }, (_, i) => `m${i}`);
  const r = selectBatch(ids, 40);
  assert.equal(r.truncated, false);
  assert.equal(r.batch.length, 40);
});
