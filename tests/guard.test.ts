import { test } from "node:test";
import assert from "node:assert/strict";
import { technicalGuard } from "../src/guard.js";
import type { IncomingMail } from "../src/types.js";

function mail(over: Partial<IncomingMail>): IncomingMail {
  return {
    id: "1", subject: "Sujet", from: { email: "a@b.fr" }, toRecipients: [],
    bodyText: "contenu", attachments: [], headers: {}, ...over,
  };
}

test("garde-fou : écarte une réponse automatique", () => {
  assert.equal(technicalGuard(mail({ subject: "Réponse automatique : absence" })).drop, true);
});

test("garde-fou : écarte un expéditeur no-reply", () => {
  assert.equal(technicalGuard(mail({ from: { email: "no-reply@tool.com" } })).drop, true);
});

test("garde-fou : écarte un mail vide sans pièce jointe", () => {
  assert.equal(technicalGuard(mail({ bodyText: "", bodyHtml: "", attachments: [] })).drop, true);
});

test("garde-fou : laisse passer un vrai mail d'offre", () => {
  assert.equal(
    technicalGuard(mail({ subject: "Proposition de local", bodyText: "Ci-joint un bien" })).drop,
    false
  );
});
