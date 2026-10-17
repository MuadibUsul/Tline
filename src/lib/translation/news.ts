import { prisma } from "../db";
import { resolveLLMProvider } from "../llm/config";
import { completeJSON, type LLMProvider } from "../llm/provider";
import { splitNewsParagraphs } from "../news";

/**
 * The newsroom writes in one language and the other edition needs the same item.
 *
 * Research reports have their own translation pipeline: page-aware segments, placeholders
 * for every figure, a glossary and an independent reviewer. A news item is short editorial
 * prose with no page structure, so it takes the same idea through a smaller door — paragraph
 * for paragraph, one JSON request, and the provider's own token accounting. The shared
 * provider route means the console's translation model and budget still govern the spend.
 */

export const NEWS_TRANSLATION_PROMPT_VERSION = "news-translation-v1";

const CHUNK_CHARS = Math.max(1_000, Number(process.env.NEWS_TRANSLATION_CHUNK_CHARS || 6_000));
const HAN = /\p{Script=Han}/gu;

export type NewsTranslationTarget = "en" | "zh-CN";

interface Draft {
  title: string;
  paragraphs: string[];
}

function targetName(target: NewsTranslationTarget) {
  return target === "en" ? "English" : "Simplified Chinese";
}

function systemPrompt(target: NewsTranslationTarget) {
  return `You are a senior bilingual editor in the Tlines newsroom.
Translate the complete news item into ${targetName(target)}.
Be faithful and complete. Never summarize, omit, add analysis, or strengthen uncertainty.
Preserve every number, currency, percentage, date, ticker, proper noun and direct quotation exactly.
Preserve the paragraph order and boundaries: return exactly one translated paragraph for every input paragraph, including section headings, and never merge or split paragraphs.
Keep the title a headline, not a sentence of commentary.
Return ONLY JSON: {"title":string,"paragraphs":[string,...]}.`;
}

function groupParagraphs(paragraphs: string[]): string[][] {
  const groups: string[][] = [];
  let current: string[] = [];
  let size = 0;
  for (const paragraph of paragraphs) {
    if (current.length && size + paragraph.length + 2 > CHUNK_CHARS) {
      groups.push(current);
      current = [];
      size = 0;
    }
    current.push(paragraph);
    size += paragraph.length + 2;
  }
  if (current.length) groups.push(current);
  return groups.length ? groups : [[]];
}

function normalizeDraft(value: unknown, expectedParagraphs: number, requireTitle: boolean): Draft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as { title?: unknown; paragraphs?: unknown };
  if (requireTitle && (typeof draft.title !== "string" || !draft.title.trim())) return null;
  if (!Array.isArray(draft.paragraphs) || draft.paragraphs.length !== expectedParagraphs) return null;
  const paragraphs = draft.paragraphs.map((paragraph) => typeof paragraph === "string" ? paragraph.trim() : "");
  if (paragraphs.some((paragraph) => !paragraph)) return null;
  return { title: typeof draft.title === "string" ? draft.title.trim() : "", paragraphs };
}

/** Whether the model actually produced prose in the requested language. */
export function translatedInTargetLanguage(text: string, target: NewsTranslationTarget): boolean {
  const han = text.match(HAN)?.length ?? 0;
  const letters = text.match(/\p{L}/gu)?.length ?? 0;
  if (!letters) return false;
  // An English news item may retain a Chinese name; a Chinese one may retain a ticker.
  // The threshold is a language check, not a ban on the other script.
  return target === "en" ? han / letters < 0.1 : han / letters > 0.2;
}

export interface NewsTranslationResult {
  title: string;
  paragraphs: string[];
  body: string;
  provider: string;
  model: string;
  promptVersion: string;
}

/**
 * Translate one news item's title and body from a provider, without touching the database.
 *
 * Exported separately so the console or an MCP caller can preview a translation before it
 * is written, and so the test suite can drive it with an in-memory provider.
 */
export async function translateNewsContent(input: {
  title: string;
  body: string | null;
  target: NewsTranslationTarget;
  provider: LLMProvider;
}, attempts = 2): Promise<NewsTranslationResult> {
  const sourceParagraphs = splitNewsParagraphs(input.body);
  const groups = groupParagraphs(sourceParagraphs);
  const translated: string[] = [];
  let title = "";
  let provider = input.provider.name;
  let model = input.provider.model;

  for (const [groupIndex, group] of groups.entries()) {
    const isFirst = groupIndex === 0;
    let lastError = "The response was not a complete translation of every paragraph.";
    for (let attempt = 0; attempt < attempts; attempt++) {
      const instruction = attempt === 0
        ? undefined
        : "Your previous response was incomplete or in the wrong language. Return exactly one translated paragraph for every input paragraph, in order, and translate all of it.";
      const result = await completeJSON<unknown>(input.provider, {
        system: systemPrompt(input.target),
        user: JSON.stringify({
          title: input.title,
          paragraphs: group,
          ...(isFirst ? { return_title: true } : { return_title: false }),
          ...(instruction ? { correction: instruction } : {}),
        }),
        maxTokens: 8000,
        audit: { promptVersion: NEWS_TRANSLATION_PROMPT_VERSION, contextStrategy: "FULL" },
      });
      const draft = normalizeDraft(result.value, group.length, isFirst);
      if (!draft) {
        lastError = "The response did not preserve the paragraph count.";
        continue;
      }
      if (!translatedInTargetLanguage(`${isFirst ? draft.title : ""}\n${draft.paragraphs.join("\n")}`, input.target)) {
        lastError = `The response was not written in ${targetName(input.target)}.`;
        continue;
      }
      if (isFirst) title = draft.title;
      translated.push(...draft.paragraphs);
      provider = result.meta.provider;
      model = result.meta.model;
      lastError = "";
      break;
    }
    if (lastError) throw new Error(lastError);
  }

  return {
    title,
    paragraphs: translated,
    body: translated.join("\n\n"),
    provider,
    model,
    promptVersion: NEWS_TRANSLATION_PROMPT_VERSION,
  };
}

export interface NewsTranslationRow {
  id: string;
  titleZh: string | null;
  titleEn: string | null;
  bodyZh: string | null;
  bodyEn: string | null;
}

export interface NewsImageTranslationRow {
  id: string;
  caption: string | null;
  alt: string | null;
  captionZh: string | null;
  captionEn: string | null;
  altZh: string | null;
  altEn: string | null;
}

function mostlyChinese(value: string): boolean {
  const han = value.match(HAN)?.length ?? 0;
  const letters = value.match(/\p{L}/gu)?.length ?? 0;
  return letters > 0 && han / letters > 0.2;
}

type LocalizedImageField = "captionEn" | "captionZh" | "altEn" | "altZh";
interface ImageCopy { imageId: string; field: LocalizedImageField; value: string }
interface ImageTranslation { imageId: string; field: LocalizedImageField; source: string; target: NewsTranslationTarget }

/**
 * Fill the two localized caption fields, and the alt fields where an alt exists.
 *
 * The desk's `caption`/`alt` stay untouched. A caption already in the target language is
 * copied rather than sent to the model; only the genuinely missing language costs a call.
 */
function imageTranslationPlan(images: NewsImageTranslationRow[]) {
  const copies: ImageCopy[] = [];
  const translations: ImageTranslation[] = [];

  for (const image of images) {
    const caption = image.caption?.trim() || image.captionZh?.trim() || image.captionEn?.trim() || "";
    if (caption) {
      const chinese = mostlyChinese(caption);
      if (chinese) {
        if (!image.captionZh) copies.push({ imageId: image.id, field: "captionZh", value: caption });
        if (!image.captionEn) translations.push({ imageId: image.id, field: "captionEn", source: caption, target: "en" });
      } else {
        if (!image.captionEn) copies.push({ imageId: image.id, field: "captionEn", value: caption });
        if (!image.captionZh) translations.push({ imageId: image.id, field: "captionZh", source: caption, target: "zh-CN" });
      }
    }
    const alt = image.alt?.trim() || image.altZh?.trim() || image.altEn?.trim() || "";
    if (alt) {
      const chinese = mostlyChinese(alt);
      if (chinese) {
        if (!image.altZh) copies.push({ imageId: image.id, field: "altZh", value: alt });
        if (!image.altEn) translations.push({ imageId: image.id, field: "altEn", source: alt, target: "en" });
      } else {
        if (!image.altEn) copies.push({ imageId: image.id, field: "altEn", value: alt });
        if (!image.altZh) translations.push({ imageId: image.id, field: "altZh", source: alt, target: "zh-CN" });
      }
    }
  }
  return { copies, translations };
}

/** Whether any image still needs a localized caption or alt text. */
export function newsImagesNeedTranslation(images: NewsImageTranslationRow[]): boolean {
  const plan = imageTranslationPlan(images);
  return plan.copies.length > 0 || plan.translations.length > 0;
}

async function translateStrings(provider: LLMProvider, strings: string[], target: NewsTranslationTarget): Promise<string[]> {
  if (!strings.length) return [];
  for (let attempt = 0; attempt < 2; attempt++) {
    const result = await completeJSON<unknown>(provider, {
      system: `You are a bilingual newsroom editor. Translate every string into ${targetName(target)}.
Preserve numbers, names and dates. Never add, omit or explain. Return ONLY JSON: {"strings":[string,...]} with exactly one translated string per input, in the same order.`,
      user: JSON.stringify({ strings }),
      maxTokens: 4000,
      audit: { promptVersion: NEWS_TRANSLATION_PROMPT_VERSION, contextStrategy: "FULL" },
    });
    const value = result.value as { strings?: unknown };
    if (Array.isArray(value.strings) && value.strings.length === strings.length
      && value.strings.every((item) => typeof item === "string" && item.trim() && translatedInTargetLanguage(item, target))) {
      return value.strings.map((item) => item.trim());
    }
    if (attempt === 1) throw new Error(`The caption translation was incomplete or not written in ${targetName(target)}.`);
  }
  return [];
}

async function translateNewsImages(provider: LLMProvider, images: NewsImageTranslationRow[]): Promise<number> {
  const plan = imageTranslationPlan(images);
  const byTarget = { en: [] as ImageTranslation[], "zh-CN": [] as ImageTranslation[] };
  for (const item of plan.translations) byTarget[item.target].push(item);
  const translated = await Promise.all((["en", "zh-CN"] as const).map(async (target) => {
    const items = byTarget[target];
    if (!items.length) return [] as Array<ImageTranslation & { value: string }>;
    const values = await translateStrings(provider, items.map((item) => item.source), target);
    return items.map((item, index) => ({ ...item, value: values[index] }));
  }));
  const updates = new Map<string, Partial<Record<LocalizedImageField, string>>>();
  const set = (imageId: string, field: LocalizedImageField, value: string) => {
    updates.set(imageId, { ...(updates.get(imageId) ?? {}), [field]: value });
  };
  for (const copy of plan.copies) set(copy.imageId, copy.field, copy.value);
  for (const item of translated.flat()) set(item.imageId, item.field, item.value);
  await Promise.all([...updates.entries()].map(([id, data]) => prisma.newsImage.update({ where: { id }, data })));
  return updates.size;
}

/** The fields one invocation still has to fill, and which language they come from. */
export function missingNewsTranslation(post: NewsTranslationRow): { target: NewsTranslationTarget; fillTitle: boolean; fillBody: boolean } | null {
  const zhTitle = post.titleZh?.trim() ?? "";
  const enTitle = post.titleEn?.trim() ?? "";
  const zhBody = post.bodyZh?.trim() ?? "";
  const enBody = post.bodyEn?.trim() ?? "";

  if (!zhTitle && !enTitle) return null;
  if (zhTitle && !enTitle) return { target: "en", fillTitle: true, fillBody: Boolean(zhBody) && !enBody };
  if (enTitle && !zhTitle) return { target: "zh-CN", fillTitle: true, fillBody: Boolean(enBody) && !zhBody };
  if (zhBody && !enBody) return { target: "en", fillTitle: false, fillBody: true };
  if (enBody && !zhBody) return { target: "zh-CN", fillTitle: false, fillBody: true };
  return null;
}

/**
 * Translate and persist one published news item. The source language is whichever title
 * exists; a missing body is filled from the body that does exist. Existing fields are never
 * overwritten, so a hand-written English headline survives an automatic body translation.
 */
export async function translateNewsPost(id: string, provider?: LLMProvider): Promise<{ id: string; target: NewsTranslationTarget } | null> {
  const post = await prisma.newsPost.findUnique({
    where: { id },
    select: {
      id: true, titleZh: true, titleEn: true, bodyZh: true, bodyEn: true, status: true,
      images: { select: { id: true, caption: true, alt: true, captionZh: true, captionEn: true, altZh: true, altEn: true } },
    },
  });
  if (!post || post.status !== "published") return null;
  const missing = missingNewsTranslation(post);
  const imagesNeed = newsImagesNeedTranslation(post.images);
  if (!missing && !imagesNeed) return null;
  const resolved = provider ?? await resolveLLMProvider("translation");
  if (!resolved) throw new Error("No LLM provider is configured for news translation.");

  let result: NewsTranslationResult | null = null;
  if (missing) {
    const sourceTitle = missing.target === "en" ? post.titleZh! : post.titleEn!;
    const sourceBody = missing.target === "en" ? post.bodyZh : post.bodyEn;
    result = await translateNewsContent({
      title: sourceTitle,
      body: sourceBody,
      target: missing.target,
      provider: resolved,
    });
    await prisma.newsPost.update({
      where: { id },
      data: missing.target === "en"
        ? {
            ...(missing.fillTitle ? { titleEn: result.title } : {}),
            ...(missing.fillBody ? { bodyEn: result.body } : {}),
          }
        : {
            ...(missing.fillTitle ? { titleZh: result.title } : {}),
            ...(missing.fillBody ? { bodyZh: result.body } : {}),
          },
    });
  }
  const imagesUpdated = imagesNeed ? await translateNewsImages(resolved, post.images) : 0;
  await prisma.auditLog.create({
    data: {
      action: "news.translate",
      targetType: "newsPost",
      targetId: id,
      metadata: JSON.stringify({
        target: missing?.target ?? (imagesNeed ? "images" : null),
        provider: result?.provider ?? resolved.name,
        model: result?.model ?? resolved.model,
        promptVersion: result?.promptVersion ?? NEWS_TRANSLATION_PROMPT_VERSION,
        filledTitle: missing?.fillTitle ?? false,
        filledBody: missing?.fillBody ?? false,
        imagesUpdated,
      }),
    },
  });
  return { id, target: missing?.target ?? "en" };
}
