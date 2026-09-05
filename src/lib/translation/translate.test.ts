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

test("keeps a rejected independent review in the retryable state", async () => {
  class RejectingReviewer extends FakeProvider {
    async complete(input: CompletionInput): Promise<CompletionResult> {
      if (input.system.includes("independent bilingual quality reviewer")) {
        return { provider: this.name, model: this.model, text: JSON.stringify({ pass: false, score: 0.4, issues: ["meaning"] }) };
      }
      return super.complete(input);
    }
  }
  const result = await translateArticle("Test Bank", "Gold target raised to $4,900", [{
    id: "segment-1",
    position: 0,
    heading: "Core view",
    text: "We raise the XAUUSD target from $4,700 to $4,900 and retain 2.5% upside.",
  }], new RejectingReviewer());
  assert.equal(result.status, "needs_review");
});

test("chunks a very long source segment and restores its database structure", async () => {
  let draftCalls = 0;
  const provider: LLMProvider = {
    name: "chunk-test",
    model: "chunk-test-v1",
    async complete(input) {
      if (input.system.includes("independent bilingual quality reviewer")) {
        return { provider: this.name, model: this.model, text: JSON.stringify({ pass: true, score: 1, issues: [] }) };
      }
      draftCalls++;
      const payload = JSON.parse(input.user) as { title: string; segments: Array<{ position: number; heading: string | null; text: string }> };
      return {
        provider: this.name,
        model: this.model,
        text: JSON.stringify({ title: payload.title, segments: payload.segments }),
      };
    },
  };
  const paragraph = "Market growth was 2.5% while the policy rate remained 4.35%.";
  const result = await translateArticle("Test Bank", "Long report 2026", [{
    id: "long",
    position: 0,
    heading: "Outlook",
    text: Array.from({ length: 700 }, () => paragraph).join("\n\n"),
  }], provider);
  assert.ok(draftCalls > 1);
  assert.equal(result.segments.length, 1);
  assert.match(result.segments[0].text, /4\.35%/);
  assert.equal(result.quality.passed, true);
});

test("retries when a draft is valid JSON but does not preserve segment positions", async () => {
  let draftCalls = 0;
  const provider: LLMProvider = {
    name: "structure-retry-test",
    model: "structure-retry-v1",
    async complete(input) {
      if (input.system.includes("independent bilingual quality reviewer")) {
        return { provider: this.name, model: this.model, text: JSON.stringify({ pass: true, score: 1, issues: [] }) };
      }
      draftCalls++;
      const payload = JSON.parse(input.user) as { title: string; segments: Array<{ position: number; heading: string | null; text: string }> };
      return {
        provider: this.name,
        model: this.model,
        text: JSON.stringify({
          title: payload.title,
          segments: draftCalls === 1 ? [] : payload.segments,
        }),
      };
    },
  };

  const result = await translateArticle("Test Bank", "Retry structure", [{
    id: "retry",
    position: 0,
    heading: "Outlook",
    text: "Growth remains resilient at 2.5%.",
  }], provider);

  assert.equal(draftCalls, 2);
  assert.equal(result.status, "reviewed");
  assert.equal(result.segments.length, 1);
});
