import glossary from "../../../data/financial_glossary.zh-CN.json";
import { prisma } from "../db";
import { completeJSON, getLLMProvider, type LLMProvider } from "../llm/provider";
import { validateTranslation, type TranslationQuality } from "./quality";

const PROMPT_VERSION = "finance-translation-v1";

interface SourceSegment {
  id: string;
  position: number;
  heading: string | null;
  text: string;
}

interface DraftSegment {
  position: number;
  heading: string | null;
  text: string;
}

interface TranslationPart extends SourceSegment {
  sourcePosition: number;
}

interface TranslationDraft {
  title: string;
  segments: DraftSegment[];
}

interface ReviewResult {
  pass: boolean;
  score: number;
  issues: string[];
}

export interface TranslationResult {
  title: string;
  text: string;
  segments: DraftSegment[];
  provider: string;
  model: string;
  promptVersion: string;
  glossaryVersion: string;
  status: "reviewed" | "needs_review";
  qualityScore: number;
  quality: TranslationQuality;
  review: ReviewResult | null;
}

function sourcePayload(
  institution: string,
  title: string,
  segments: SourceSegment[],
  issues?: string[],
) {
  return JSON.stringify({
    institution,
    title,
    locale: "zh-CN",
    glossary,
    correction_issues: issues,
    segments: segments.map(({ position, heading, text }) => ({ position, heading, text })),
  });
}

const TRANSLATION_SYSTEM = `You are a senior Chinese-language editor at a global financial institution.
Translate the complete English research article into professional Simplified Chinese.
Be faithful, complete, restrained, and consistent. Never summarize, omit, add analysis, or strengthen uncertainty.
Preserve every number, currency symbol, percentage, basis-point value, date, ticker, proper noun, and segment position.
Keep Arabic digit strings and scale units verbatim: never spell digits as Chinese numerals or convert 503bn into 5030亿.
Preserve every __TL_NUM_n__ placeholder exactly; it will be restored after translation.
Apply the supplied glossary. Keep official tickers and product names unchanged.
Return ONLY JSON: {"title":string,"segments":[{"position":number,"heading":string|null,"text":string}]}.`;

function normalizeDraft(value: unknown, source: SourceSegment[]): TranslationDraft | null {
  if (!value || typeof value !== "object") return null;
  const draft = value as Partial<TranslationDraft>;
  if (typeof draft.title !== "string" || !draft.title.trim() || !Array.isArray(draft.segments)) return null;
  const segments = draft.segments
    .filter((segment): segment is DraftSegment =>
      Boolean(segment) &&
      Number.isInteger(segment.position) &&
      (typeof segment.heading === "string" || segment.heading === null) &&
      typeof segment.text === "string" &&
      Boolean(segment.text.trim()),
    )
    .sort((a, b) => a.position - b.position);
  if (segments.length !== source.length) return null;
  if (segments.some((segment, index) => segment.position !== source[index].position)) return null;
  return { title: draft.title.trim(), segments };
}

function articleText(title: string, segments: { heading: string | null; text: string }[]) {
  return [title, ...segments.flatMap((segment) => [segment.heading ?? "", segment.text])]
    .filter(Boolean)
    .join("\n\n");
}

async function requestDraft(
  provider: LLMProvider,
  institution: string,
  title: string,
  segments: SourceSegment[],
  issues?: string[],
) {
  const result = await completeJSON<unknown>(provider, {
    system: TRANSLATION_SYSTEM,
    user: sourcePayload(institution, title, segments, issues),
    maxTokens: 9000,
  });
  const draft = normalizeDraft(result.value, segments);
  if (!draft) throw new Error("Translation response did not preserve the source segment structure.");
  return { draft, provider: result.meta.provider, model: result.meta.model };
}

function splitText(text: string, maxChars = 6_000): string[] {
  if (text.length <= maxChars) return [text];
  const paragraphs = text.split(/\n\s*\n/).filter(Boolean);
  const parts: string[] = [];
  let current = "";
  const push = () => { if (current) parts.push(current); current = ""; };
  for (const paragraph of paragraphs) {
    if (paragraph.length > maxChars) {
      push();
      for (let start = 0; start < paragraph.length; start += maxChars) parts.push(paragraph.slice(start, start + maxChars));
    } else if (current.length + paragraph.length + 2 > maxChars) {
      push();
      current = paragraph;
    } else {
      current += `${current ? "\n\n" : ""}${paragraph}`;
    }
  }
  push();
  return parts;
}

function translationParts(segments: SourceSegment[]): TranslationPart[] {
  let position = 0;
  return segments.flatMap((segment) => splitText(segment.text).map((text, part) => ({
    id: `${segment.id}:${part}`,
    position: position++,
    sourcePosition: segment.position,
    heading: part === 0 ? segment.heading : null,
    text,
  })));
}

const batches = (parts: TranslationPart[]): TranslationPart[][] => parts.map((part) => [part]);

function protectNumbers(value: string, values: string[]): string {
  return value.replace(/(?:[$€£¥]\s*)?[+-]?\d[\d,]*(?:\.\d+)?(?:\s?%|\s?(?:bp|bps|basis points?))?/gi, (token) => {
    const marker = `__TL_NUM_${values.length}__`;
    values.push(token);
    return marker;
  });
}

function restoreNumbers(value: string, values: string[]): string {
  return value.replace(/__TL_NUM_(\d+)__/g, (marker, index: string) => values[Number(index)] ?? marker);
}

async function reviewDraft(
  provider: LLMProvider,
  source: string,
  translated: string,
): Promise<ReviewResult> {
  const result = await completeJSON<unknown>(provider, {
    system: `You are an independent bilingual quality reviewer for institutional financial research.
Compare the English source and Simplified Chinese translation. Check omissions, additions, mistranslation,
modality, financial terminology, numbers, tickers, targets, dates, and direction changes.
Return ONLY JSON: {"pass":boolean,"score":number,"issues":string[]}.`,
    user: JSON.stringify({ source, translation: translated }),
    maxTokens: 1800,
  });
  const value = result.value as Partial<ReviewResult>;
  return {
    pass: value.pass === true,
    score: Math.max(0, Math.min(1, Number(value.score) || 0)),
    issues: Array.isArray(value.issues) ? value.issues.filter((issue): issue is string => typeof issue === "string").slice(0, 20) : [],
  };
}

export async function translateArticle(
  institution: string,
  title: string,
  segments: SourceSegment[],
  provider = getLLMProvider(process.env.TRANSLATION_PROVIDER),
): Promise<TranslationResult> {
  if (!provider) throw new Error("No LLM provider is configured for translation.");
  const source = articleText(title, segments);
  const parts = translationParts(segments);
  const translatedParts: DraftSegment[] = [];
  let translatedTitle = "";
  let providerName = provider.name;
  let model = provider.model;
  for (const batch of batches(parts)) {
    const numbers: string[] = [];
    const protectedTitle = protectNumbers(title, numbers);
    const protectedBatch = batch.map((part) => ({
      ...part,
      heading: part.heading ? protectNumbers(part.heading, numbers) : null,
      text: protectNumbers(part.text, numbers),
    }));
    let generated = await requestDraft(provider, institution, protectedTitle, protectedBatch);
    generated.draft.title = restoreNumbers(generated.draft.title, numbers);
    generated.draft.segments = generated.draft.segments.map((segment) => ({
      ...segment,
      heading: segment.heading ? restoreNumbers(segment.heading, numbers) : null,
      text: restoreNumbers(segment.text, numbers),
    }));
    let batchQuality = validateTranslation(
      articleText("", batch),
      articleText("", generated.draft.segments),
      batch.length,
      generated.draft.segments.length,
    );
    if (!batchQuality.passed) {
      generated = await requestDraft(provider, institution, protectedTitle, protectedBatch, batchQuality.issues.map((issue) => issue.message));
      generated.draft.title = restoreNumbers(generated.draft.title, numbers);
      generated.draft.segments = generated.draft.segments.map((segment) => ({
        ...segment,
        heading: segment.heading ? restoreNumbers(segment.heading, numbers) : null,
        text: restoreNumbers(segment.text, numbers),
      }));
    }
    translatedTitle ||= generated.draft.title;
    providerName = generated.provider;
    model = generated.model;
    translatedParts.push(...generated.draft.segments);
  }

  const draftSegments = segments.map((segment) => {
    const indexes = parts.flatMap((part, index) => part.sourcePosition === segment.position ? [index] : []);
    const drafts = indexes.map((index) => translatedParts.find((part) => part.position === parts[index].position)!);
    return {
      position: segment.position,
      heading: drafts.find((part) => part.heading)?.heading ?? null,
      text: drafts.map((part) => part.text).join("\n\n"),
    };
  });
  const translated = articleText(translatedTitle, draftSegments);
  const quality = validateTranslation(source, translated, segments.length, draftSegments.length);

  let review: ReviewResult | null = null;
  if (quality.passed) {
    const reviewer = getLLMProvider(process.env.TRANSLATION_REVIEW_PROVIDER) ?? provider;
    try {
      review = await reviewDraft(reviewer, source, translated);
    } catch {
      review = null;
    }
  }
  const reviewed = quality.passed && review?.pass === true;
  const qualityScore = reviewed
    ? Number(((quality.score + (review?.score ?? 0)) / 2).toFixed(2))
    : Number((quality.score * 0.7).toFixed(2));

  return {
    title: translatedTitle,
    text: draftSegments.map((segment) => segment.text).join("\n\n"),
    segments: draftSegments,
    provider: providerName,
    model,
    promptVersion: PROMPT_VERSION,
    glossaryVersion: glossary.version,
    status: reviewed ? "reviewed" : "needs_review",
    qualityScore,
    quality,
    review,
  };
}

export async function translateAndPersist(articleId: string, provider?: LLMProvider) {
  let article = await prisma.article.findUnique({
    where: { id: articleId },
    include: {
      institution: { select: { name: true } },
      segments: { orderBy: { position: "asc" } },
    },
  });
  if (!article?.rawText) throw new Error("Article has no canonical English body.");

  if (article.segments.length === 0) {
    await prisma.articleSegment.create({
      data: { articleId: article.id, position: 0, heading: null, text: article.rawText },
    });
    article = await prisma.article.findUniqueOrThrow({
      where: { id: articleId },
      include: {
        institution: { select: { name: true } },
        segments: { orderBy: { position: "asc" } },
      },
    });
  }

  const result = await translateArticle(article.institution.name, article.title, article.segments, provider);
  return prisma.$transaction(async (tx) => {
    const translation = await tx.articleTranslation.upsert({
      where: { articleId_locale: { articleId, locale: "zh-CN" } },
      create: {
        articleId,
        locale: "zh-CN",
        title: result.title,
        text: result.text,
        provider: result.provider,
        model: result.model,
        promptVersion: result.promptVersion,
        glossaryVersion: result.glossaryVersion,
        status: result.status,
        qualityScore: result.qualityScore,
      },
      update: {
        title: result.title,
        text: result.text,
        provider: result.provider,
        model: result.model,
        promptVersion: result.promptVersion,
        glossaryVersion: result.glossaryVersion,
        status: result.status,
        qualityScore: result.qualityScore,
        translatedAt: new Date(),
      },
    });
    await tx.articleTranslationSegment.deleteMany({ where: { translationId: translation.id } });
    for (const segment of result.segments) {
      const source = article.segments.find((item) => item.position === segment.position)!;
      await tx.articleTranslationSegment.create({
        data: {
          translationId: translation.id,
          sourceSegmentId: source.id,
          position: segment.position,
          heading: segment.heading,
          text: segment.text,
        },
      });
    }
    return { translation, quality: result.quality, review: result.review };
  });
}
