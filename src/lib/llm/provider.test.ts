import assert from "node:assert/strict";
import test from "node:test";
import { completeJSON } from "./provider";
import type { CompletionInput, LLMProvider } from "./types";

test("completeJSON accepts the first balanced object without greedily joining later braces", async () => {
  let calls = 0;
  const provider: LLMProvider = {
    name: "json-test",
    model: "json-test-v1",
    async complete(_input: CompletionInput) {
      calls++;
      return { provider: this.name, model: this.model, text: '```json\n{"ok":true,"text":"brace } inside string"}\n```\nExtra {not-json}' };
    },
  };
  const result = await completeJSON<{ ok: boolean }>(provider, { system: "json", user: "json" });
  assert.equal(result.value.ok, true);
  assert.equal(calls, 1);
});
