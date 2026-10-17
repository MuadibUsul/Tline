import assert from "node:assert/strict";
import test from "node:test";
import type { CompletionInput, CompletionResult, LLMProvider } from "../llm/provider";
import { missingNewsTranslation, newsImagesNeedTranslation, translateNewsContent, translatedInTargetLanguage } from "./news";

class FakeNewsProvider implements LLMProvider {
  readonly name = "fake";
  readonly model = "news-test-v1";
  calls = 0;

  async complete(input: CompletionInput): Promise<CompletionResult> {
    this.calls++;
    const payload = JSON.parse(input.user) as { title: string; paragraphs: string[]; return_title: boolean };
    const targetEnglish = input.system.includes("into English");
    if (targetEnglish) {
      return {
        provider: this.name,
        model: this.model,
        text: JSON.stringify({
          title: "Ukraine war brief: strikes continue",
          paragraphs: payload.paragraphs.map((_paragraph, index) => `English paragraph ${index}`),
        }),
      };
    }
    return {
      provider: this.name,
      model: this.model,
      text: JSON.stringify({
        title: "俄乌战场简报：打击持续",
        paragraphs: payload.paragraphs.map((paragraph) => `中(${paragraph})`),
      }),
    };
  }
}

test("translates a Chinese news item paragraph for paragraph", async () => {
  const provider = new FakeNewsProvider();
  const result = await translateNewsContent({
    title: "俄乌战场简报：打击持续",
    body: "第一段。\n\n第二段。",
    target: "en",
    provider,
  });
  assert.equal(result.title, "Ukraine war brief: strikes continue");
  assert.deepEqual(result.paragraphs, ["English paragraph 0", "English paragraph 1"]);
  assert.equal(result.body, "English paragraph 0\n\nEnglish paragraph 1");
  assert.equal(provider.calls, 1);
});

test("keeps every paragraph when the body needs more than one request", async () => {
  const provider = new FakeNewsProvider();
  const paragraphs = Array.from({ length: 40 }, (_, index) => `第${index}段。${"内容".repeat(80)}`);
  const result = await translateNewsContent({
    title: "分段测试",
    body: paragraphs.join("\n\n"),
    target: "en",
    provider,
  });
  assert.ok(provider.calls > 1, "the body should have been split into several requests");
  assert.equal(result.paragraphs.length, paragraphs.length);
  assert.ok(result.paragraphs.every((paragraph) => paragraph.startsWith("English paragraph ")));
});

test("a title-only item translates the title and no body", async () => {
  const result = await translateNewsContent({
    title: "快讯",
    body: null,
    target: "en",
    provider: new FakeNewsProvider(),
  });
  assert.equal(result.title, "Ukraine war brief: strikes continue");
  assert.deepEqual(result.paragraphs, []);
  assert.equal(result.body, "");
});

test("fills the missing edition and never the one that exists", () => {
  assert.deepEqual(
    missingNewsTranslation({ id: "1", titleZh: "标题", titleEn: null, bodyZh: "正文", bodyEn: null }),
    { target: "en", fillTitle: true, fillBody: true },
  );
  assert.deepEqual(
    missingNewsTranslation({ id: "1", titleZh: "标题", titleEn: "Title", bodyZh: "正文", bodyEn: null }),
    { target: "en", fillTitle: false, fillBody: true },
  );
  assert.deepEqual(
    missingNewsTranslation({ id: "1", titleZh: null, titleEn: "Title", bodyZh: null, bodyEn: "Body" }),
    { target: "zh-CN", fillTitle: true, fillBody: true },
  );
  assert.equal(
    missingNewsTranslation({ id: "1", titleZh: "标题", titleEn: "Title", bodyZh: "正文", bodyEn: "Body" }),
    null,
  );
});

test("detects an image caption that is still missing its other language", () => {
  const image = {
    id: "image-1",
    caption: "10月16日纵深打击概览",
    alt: null,
    captionZh: null,
    captionEn: null,
    altZh: null,
    altEn: null,
  };
  assert.equal(newsImagesNeedTranslation([image]), true);
  assert.equal(newsImagesNeedTranslation([{ ...image, captionEn: "Strikes overview", captionZh: image.caption }]), false);
});

test("the language check rejects a translation that stayed in the source language", () => {
  assert.equal(translatedInTargetLanguage("这是一段中文。", "en"), false);
  assert.equal(translatedInTargetLanguage("This is English with 中文 names.", "en"), true);
  assert.equal(translatedInTargetLanguage("This is still English.", "zh-CN"), false);
  assert.equal(translatedInTargetLanguage("这是中文译文。", "zh-CN"), true);
});
