import assert from "node:assert/strict";
import test from "node:test";
import { getLLMProvider } from "./provider";

test("selects DeepSeek when explicitly configured", () => {
  const key = process.env.DEEPSEEK_API_KEY;
  const model = process.env.DEEPSEEK_MODEL;
  try {
    process.env.DEEPSEEK_API_KEY = "test-key";
    process.env.DEEPSEEK_MODEL = "deepseek-v4-flash";
    const provider = getLLMProvider("deepseek");
    assert.equal(provider?.name, "deepseek");
    assert.equal(provider?.model, "deepseek-v4-flash");
  } finally {
    if (key === undefined) delete process.env.DEEPSEEK_API_KEY;
    else process.env.DEEPSEEK_API_KEY = key;
    if (model === undefined) delete process.env.DEEPSEEK_MODEL;
    else process.env.DEEPSEEK_MODEL = model;
  }
});
