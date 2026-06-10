import { test } from "node:test";
import assert from "node:assert/strict";
import { parseEml } from "./fixtures/eml.js";

const SAMPLE_EML = [
  "From: Jean Nocentini <marcleimmobilier@orange.fr>",
  "To: matthieu@uneo-retail.com",
  "Subject: Proposition de local commercial",
  "Date: Mon, 08 Jun 2026 09:00:00 +0200",
  "Content-Type: text/plain; charset=utf-8",
  "",
  "Bonjour, je vous transmets un bien susceptible de vous intéresser. Ci-joint le dossier.",
  "",
].join("\r\n");

test("parseEml : extrait sujet, from, to, corps", async () => {
  const mail = await parseEml(SAMPLE_EML);
  assert.equal(mail.subject, "Proposition de local commercial");
  assert.equal(mail.from.email, "marcleimmobilier@orange.fr");
  assert.equal(mail.from.name, "Jean Nocentini");
  assert.equal(mail.toRecipients[0]!.email, "matthieu@uneo-retail.com");
  assert.match(mail.bodyText ?? "", /susceptible de vous intéresser/);
});
