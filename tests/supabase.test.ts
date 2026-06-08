import { test } from "node:test";
import assert from "node:assert/strict";
import type { SupabaseClient } from "@supabase/supabase-js";
import { _setClient, isPrimed } from "../src/state/supabase.js";

/** Stub chainable minimal : from().select().eq().maybeSingle() → result. */
function fakeClient(result: { data: unknown; error: unknown }): SupabaseClient {
  const chain = {
    from: () => chain,
    select: () => chain,
    eq: () => chain,
    maybeSingle: async () => result,
  };
  return chain as unknown as SupabaseClient;
}

test("isPrimed : false quand la clé inbox_delta est absente", async () => {
  _setClient(fakeClient({ data: null, error: null }));
  assert.equal(await isPrimed(), false);
  _setClient(null);
});

test("isPrimed : true quand un deltaLink existe déjà", async () => {
  _setClient(fakeClient({ data: { delta_link: "https://graph/delta?$skiptoken=abc" }, error: null }));
  assert.equal(await isPrimed(), true);
  _setClient(null);
});
