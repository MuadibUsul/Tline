import assert from "node:assert/strict";
import test from "node:test";
import type { CompletionInput, CompletionResult, LLMProvider } from "../llm/provider";
import { assessTranslationRisk } from "./quality";
import { normalizeReviewScore, translateArticle } from "./translate";

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
    undefined,
    true,
    1,
  );
  assert.equal(result.status, "reviewed");
  assert.equal(result.reviewAttempted, true);
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
  }], new RejectingReviewer(), undefined, true, 1);
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

test("preserves numeric PDF tables verbatim instead of letting the model reshape them", async () => {
  let translatedTable = false;
  const provider: LLMProvider = {
    name: "layout-test",
    model: "layout-test-v1",
    async complete(input) {
      if (input.system.includes("independent bilingual quality reviewer")) {
        return { provider: this.name, model: this.model, text: JSON.stringify({ pass: true, score: 1, issues: [] }) };
      }
      const payload = JSON.parse(input.user) as { title: string; segments: Array<{ position: number; heading: string | null; text: string }> };
      translatedTable ||= payload.segments.some((segment) => segment.text.includes("2024 2025 2026"));
      return { provider: this.name, model: this.model, text: JSON.stringify({ title: "市场展望", segments: payload.segments }) };
    },
  };
  const table = "GDP 2024 2.1 2025 1.9 2026 2.2\nCPI 2024 2.8 2025 2.4 2026 2.1";
  const result = await translateArticle("Test Bank", "Market outlook", [
    { id: "prose", position: 0, heading: "Summary", text: "Growth remains resilient." },
    { id: "table", position: 1, heading: "Page 2", text: table },
  ], provider);
  assert.equal(translatedTable, false);
  assert.equal(result.segments[1].heading, "第 2 页");
  assert.equal(result.segments[1].text, table);
  assert.equal(result.quality.passed, true);
});

test("an unsampled review is not a failed one: the article still reads as reviewed", async () => {
  class CountingProvider extends FakeProvider {
    reviews = 0;
    async complete(input: CompletionInput): Promise<CompletionResult> {
      if (input.system.includes("independent bilingual quality reviewer")) this.reviews++;
      return super.complete(input);
    }
  }
  const provider = new CountingProvider();
  const result = await translateArticle("Test Bank", "Gold target raised to $4,900", [{
    id: "segment-1",
    position: 0,
    heading: "Core view",
    text: "We raise the XAUUSD target from $4,700 to $4,900 and retain 2.5% upside.",
  }], provider, provider, true, 0);
  assert.equal(provider.reviews, 0);
  assert.equal(result.reviewAttempted, false);
  // Marking this needs_review would re-queue the article and buy back the skipped call.
  assert.equal(result.status, "reviewed");
});

test("a structurally misshapen translation is reviewed even at a zero sample rate", async () => {
  // Long English source, near-empty Chinese output: charsPerWord collapses far below the
  // band measured on the corpus, which is what "the model dropped content" looks like.
  //
  // The prose carries no figures, so the deterministic checks pass and the paid review is
  // the only thing that can catch this. It used to carry figures, and the test passed for
  // the wrong reason: the source was being passed through untranslated, which kept every
  // number and made `quality.passed` true without the model ever seeing the text.
  const source = Array.from({ length: 120 }, () => "sentence number xxx about the market outlook").join(" ");
  class DroppingProvider extends FakeProvider {
    reviews = 0;
    async complete(input: CompletionInput): Promise<CompletionResult> {
      if (input.system.includes("independent bilingual quality reviewer")) {
        this.reviews++;
        return { provider: this.name, model: this.model, text: JSON.stringify({ pass: true, score: 0.9, issues: [] }) };
      }
      const payload = JSON.parse(input.user) as { title: string; segments: Array<{ position: number; heading: string | null }> };
      return {
        provider: this.name,
        model: this.model,
        text: JSON.stringify({ title: payload.title, segments: payload.segments.map((segment) => ({ ...segment, text: "简述。" })) }),
      };
    }
  }
  const provider = new DroppingProvider();
  const result = await translateArticle("Test Bank", "Market outlook", [
    { id: "segment-1", position: 0, heading: null, text: source },
  ], provider, provider, true, 0);
  assert.equal(result.risk.risky, true);
  assert.equal(provider.reviews > 0, true);
});

test("ordinary output is never flagged risky by the cheap signals", () => {
  const source = Array.from({ length: 120 }, (_, index) => `sentence ${index} about the market outlook`).join(" ");
  // ~1.6 Chinese characters per English word, the corpus median.
  const translated = "关于市场前景的第若干句话。".repeat(96);
  const risk = assessTranslationRisk(source, translated);
  assert.equal(risk.risky, false, risk.reasons.join(" "));
});

test("a reviewer score out of 100 is read as a percentage, not as a perfect 1", () => {
  // Production reviews came back with `score: 75`. The old clamp read that as 1.0, so a
  // review meaning "75 out of 100" scored the translation flawless.
  assert.equal(normalizeReviewScore(75), 0.75);
  assert.equal(normalizeReviewScore(100), 1);
  assert.equal(normalizeReviewScore(0.75), 0.75);
  assert.equal(normalizeReviewScore(1), 1);
  assert.equal(normalizeReviewScore(0), 0);
  assert.equal(normalizeReviewScore(undefined), 0);
  assert.equal(normalizeReviewScore("40"), 0.4);
  assert.equal(normalizeReviewScore(250), 1);
});

test("prose that merely signs off with a contact is translated, not passed through", async () => {
  // Production served pages whose entire closing section, and in 51 cases whose entire body,
  // stayed in English on a /zh address. The trigger was the author's e-mail at the end.
  const seen: string[] = [];
  const provider: LLMProvider = {
    name: "contact-test",
    model: "contact-test-v1",
    async complete(input) {
      if (input.system.includes("independent bilingual quality reviewer")) {
        return { provider: this.name, model: this.model, text: JSON.stringify({ pass: true, score: 1, issues: [] }) };
      }
      const payload = JSON.parse(input.user) as { segments: Array<{ position: number; heading: string | null; text: string }> };
      for (const segment of payload.segments) seen.push(segment.text);
      return { provider: this.name, model: this.model, text: JSON.stringify({ title: "欧元区贷款", segments: payload.segments }) };
    },
  };
  const closing = "The third pillar\n\nAs Christine Lagarde has repeatedly stressed, the ECB's reaction function rests on three pillars. Today's figures provide some information on the third pillar. Overall, today's data does not suggest that the expansion is about to slow sharply.\n\nAuthor\n\nPeter Vanden Houte Chief Economist peter.vandenhoute@ing.com";
  await translateArticle("ING THINK", "Sustained loan growth", [
    { id: "summary", position: 0, heading: "Summary", text: "Broad money growth picked up slightly in August." },
    { id: "closing", position: 1, heading: "Page 2", text: closing },
  ], provider);
  assert.ok(seen.some((text) => text.includes("The third pillar")), "the closing prose must reach the translator");

  // A signature block on its own still stays verbatim, which is what the rule is for.
  const shortSeen: string[] = [];
  const shortProvider: LLMProvider = {
    ...provider,
    async complete(input) {
      if (!input.system.includes("independent bilingual quality reviewer")) {
        const payload = JSON.parse(input.user) as { segments: Array<{ text: string }> };
        for (const segment of payload.segments) shortSeen.push(segment.text);
      }
      return provider.complete(input);
    },
  };
  await translateArticle("ING THINK", "Sustained loan growth", [
    { id: "sig", position: 0, heading: "Author", text: "Author\n\nPeter Vanden Houte, Chief Economist\nTel: +32 2 547 6109\npeter.vandenhoute@ing.com" },
  ], shortProvider);
  assert.equal(shortSeen.length, 0, "a short signature block is not sent to the model");
});
