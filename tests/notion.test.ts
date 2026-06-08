import { test } from "node:test";
import assert from "node:assert/strict";
import { societeFromUrl } from "../src/notion/resolve.js";

test("societeFromUrl : déduit le nom propre depuis une URL", () => {
  assert.equal(societeFromUrl("www.icg-commerce.fr"), "Icg Commerce");
  assert.equal(societeFromUrl("https://www.terranae.com"), "Terranae");
  assert.equal(societeFromUrl("realtyz.fr"), "Realtyz");
});
