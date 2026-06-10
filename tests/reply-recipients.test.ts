import { test } from "node:test";
import assert from "node:assert/strict";
import { buildSelfRecipients, sanitizeRecipients } from "../src/graph/messages.js";

const MAILBOX = "matthieu@uneo-retail.com";

test("buildSelfRecipients : uniquement la boîte connectée", () => {
  const r = buildSelfRecipients(MAILBOX);
  assert.equal(r.length, 1);
  assert.equal(r[0]!.emailAddress.address, MAILBOX);
});

test("sanitizeRecipients : retire toute adresse étrangère (ex. broker)", () => {
  const injected = [
    { emailAddress: { address: "broker@agence-immo.fr" } },
    { emailAddress: { address: "MATTHIEU@Uneo-Retail.com" } }, // casse différente
  ];
  const safe = sanitizeRecipients(injected, MAILBOX);
  assert.equal(safe.length, 1);
  assert.equal(safe[0]!.emailAddress.address, "MATTHIEU@Uneo-Retail.com");
});

test("sanitizeRecipients : liste sans la boîte → vide (déclenche le garde-fou)", () => {
  const safe = sanitizeRecipients([{ emailAddress: { address: "broker@agence-immo.fr" } }], MAILBOX);
  assert.equal(safe.length, 0);
});
