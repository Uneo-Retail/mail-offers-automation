import { test } from "node:test";
import assert from "node:assert/strict";
import { displayStatus, mapListItem, mapDetail, inProgressItem, type ProcessedRow, type EventRow } from "../src/admin/data.js";

const base: ProcessedRow = {
  message_id: "m1",
  processed_at: "2026-06-12T10:00:00Z",
  route: "offre",
  type_offre: "cession",
  nb_locaux: 7,
  notion_offre_id: "29b545f77d1b80db87c4000b800d1928",
  status: "success",
  error: null,
  subject: "Offre Zadig",
  sender: "broker@x.fr",
};

test("displayStatus : mappe les statuts stockés", () => {
  assert.equal(displayStatus({ status: "success", route: "offre", nb_locaux: 7 }), "succes");
  assert.equal(displayStatus({ status: "success", route: "faible_completude", nb_locaux: 0 }), "dense");
  assert.equal(displayStatus({ status: "noise", route: "bruit", nb_locaux: null }), "hors_scope");
  assert.equal(displayStatus({ status: "failed", route: "offre", nb_locaux: null }), "echec");
  assert.equal(displayStatus({ status: "skipped", route: null, nb_locaux: null }), "ignore");
});

test("mapListItem : sérialise + construit l'URL Notion de l'offre", () => {
  const item = mapListItem(base);
  assert.equal(item.messageId, "m1");
  assert.equal(item.status, "succes");
  assert.equal(item.subject, "Offre Zadig");
  assert.match(item.notionOffreUrl!, /^https:\/\/www\.notion\.so\/29b545f7/);
});

test("mapListItem : pas d'offre Notion → URL null", () => {
  const item = mapListItem({ ...base, notion_offre_id: null });
  assert.equal(item.notionOffreUrl, null);
});

test("mapDetail : inclut confiance/raison + timeline triée", () => {
  const events: EventRow[] = [
    { id: 2, message_id: "m1", ts: "2026-06-12T10:00:05Z", step: "classification", detail: null, level: "info" },
    { id: 1, message_id: "m1", ts: "2026-06-12T10:00:01Z", step: "mail_recu", detail: "Offre Zadig", level: "info" },
  ];
  const detail = mapDetail(base, { message_id: "m1", route: "offre", type_offre: "cession", confiance: 0.95, raison: "broker propose un lot", created_at: "x" }, events);
  assert.equal(detail.confiance, 0.95);
  assert.equal(detail.raison, "broker propose un lot");
  assert.deepEqual(detail.events.map((e) => e.step), ["mail_recu", "classification"]);
});

test("inProgressItem : statut en_cours + dernier step + sujet depuis mail_recu", () => {
  const events: EventRow[] = [
    { id: 1, message_id: "m9", ts: "2026-06-12T11:00:00Z", step: "mail_recu", detail: "Nouveau bien", level: "info" },
    { id: 2, message_id: "m9", ts: "2026-06-12T11:00:02Z", step: "extraction_ia", detail: null, level: "info" },
  ];
  const item = inProgressItem("m9", events);
  assert.equal(item.status, "en_cours");
  assert.equal(item.lastStep, "extraction_ia");
  assert.equal(item.subject, "Nouveau bien");
});
