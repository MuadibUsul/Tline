import assert from "node:assert/strict";
import test from "node:test";
import { isVerifiedMarketMapping } from "./provider";

test("same symbols with different quote currencies or instruments never match", () => {
  const btcUsd = { id: "btc-usd", quoteCurrency: "USD" };
  assert.equal(isVerifiedMarketMapping(btcUsd, { instrumentId: "btc-usdt" }, { quoteCurrency: "USD" }), false);
  assert.equal(isVerifiedMarketMapping(btcUsd, { instrumentId: "btc-usd" }, { quoteCurrency: "USDT" }), false);
  assert.equal(isVerifiedMarketMapping(btcUsd, { instrumentId: "btc-usd" }, { quoteCurrency: "USD" }), true);
});
