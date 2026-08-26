import assert from "node:assert/strict";
import test from "node:test";
import type { CompletionInput, CompletionResult, LLMProvider } from "../llm/provider";
import { translateArticle } from "./translate";

class FakeProvider implements LLMProvider {
  readonly name = "fake";
  readonly model = "finance-test-v1";

  async complete(input: CompletionInput): Promise<CompletionResult> {
    const isReview = input.system.includes("independent bilingual quality reviewer");
    return {
      provider: this.name,
      model: this.model,
      text: isReview
        ? JSON.stringify({ pass: true, score: 0.98, issues: [] })
        : JSON.stringify({
          title: "黄金目标价上调至 $4,900",
          segments: [{
            position: 0,
            heading: "核心观点",
            text: "我们将 XAUUSD 目标价从 $4,700 上调至 $4,900，同时保留 2.5% 的上行空间。",
          }],
        }),
    };
  }
}

test("produces a reviewed structured translation through the provider boundary", async () => {
  const result = await translateArticle(
    "Test Bank",
    "Gold target raised to $4,900",
    [{
      id: "segment-1",
      position: 0,
      heading: "Core view",
      text: "We raise the XAUUSD target from $4,700 to $4,900 and retain 2.5% upside.",
    }],
    new FakeProvider(),
  );
  assert.equal(result.status, "reviewed");
  assert.equal(result.provider, "fake");
  assert.equal(result.quality.passed, true);
  assert.equal(result.segments[0].position, 0);
});
