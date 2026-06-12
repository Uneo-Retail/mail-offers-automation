import { test } from "node:test";
import assert from "node:assert/strict";
import { createPageTemplated } from "../src/notion/client.js";

test("createPageTemplated : crée (template) PUIS patche nos propriétés, dans cet ordre", async () => {
  const calls: string[] = [];
  const id = await createPageTemplated(
    "ds-magasins",
    "tpl-123",
    { Nom: { title: [{ text: { content: "X" } }] } },
    {
      create: async (ds, props) => {
        calls.push(`create:${ds}:${Object.keys(props).length}props`);
        return "page-1";
      },
      update: async (pageId, props) => {
        calls.push(`update:${pageId}:${Object.keys(props).length}props`);
      },
    }
  );
  assert.equal(id, "page-1");
  // ordre : création (page vide) d'abord, PATCH de nos propriétés ensuite
  assert.deepEqual(calls, ["create:ds-magasins:0props", "update:page-1:1props"]);
});
