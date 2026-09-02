import test from "node:test";
import assert from "node:assert/strict";
import { syncMarketQuotes } from "./sync";

test("reports 'not configured' rather than failing when no provider key is set", async () => {
  const result = await syncMarketQuotes(null);
  assert.equal(result.configured, false);
  assert.equal(result.stored, 0);
  assert.equal(result.failed, 0);
  assert.match(result.reason ?? "", /TWELVE_DATA_API_KEY/);
});
