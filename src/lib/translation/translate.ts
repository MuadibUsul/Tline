import glossary from "../../../data/financial_glossary.zh-CN.json";
import { prisma } from "../db";
import { completeJSON, getLLMProvider, type LLMProvider } from "../llm/provider";
import { validateTranslation, type TranslationQuality } from "./quality";
import { protectTitleDates, restoreTitleDates } from "./titleDates";

const PROMPT_VERSION = "finance-translation-v2";

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
    correction_issues: issues,
    segments: segments.map(({ position, heading, text }) => ({ position, heading, text })),
  });
}

// The glossary lives in the (constant) system prompt so the whole system prefix is
// identical on every request — this is what lets DeepSeek's automatic context cache
// hit, instead of re-billing the glossary as fresh input tokens each call.
const TRANSLATION_SYSTEM = `You are a senior Chinese-language editor at a global financial institution.
Translate the complete English research article into professional Simplified Chinese.
Be faithful, complete, restrained, and consistent. Never summarize, omit, add analysis, or strengthen uncertainty.
Preserve every number, currency symbol, percentage, basis-point value, date, ticker, proper noun, and segment position.
Keep Arabic digit strings and scale units verbatim: never spell digits as Chinese numerals or convert 503bn into 5030亿.
Preserve every __TL_NUM_n__ and __TLD_x__ placeholder exactly; they will be restored after translation.
Apply the glossary below consistently. Keep official tickers and product names unchanged.
Return ONLY JSON: {"title":string,"segments":[{"position":number,"heading":string|null,"text":string}]}.

Glossary (JSON, apply consistently):
${JSON.stringify(glossary)}`;

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
  let lastMeta = { provider: provider.name, model: provider.model };
  let retryIssues = issues;
  for (let attempt = 0; attempt < 2; attempt++) {
    let result;
    try {
      result = await completeJSON<unknown>(provider, {
        system: TRANSLATION_SYSTEM,
        user: sourcePayload(institution, title, segments, retryIssues),
        maxTokens: 9000,
      });
    } catch (error) {
      if (attempt === 1) throw error;
      retryIssues = [...(issues ?? []), "Your previous response was not valid JSON. Return exactly one JSON object and no surrounding prose."];
      continue;
    }
    lastMeta = result.meta;
    const draft = normalizeDraft(result.value, segments);
    if (draft) return { draft, provider: result.meta.provider, model: result.meta.model };
    retryIssues = [
      ...(issues ?? []),
      "Your previous response changed, omitted, or duplicated segment positions. Return exactly one output segment for every input segment, preserving each position.",
    ];
  }
  throw new Error(`Translation response did not preserve the source segment structure (${lastMeta.provider}/${lastMeta.model}).`);
}

function splitText(text: string, maxChars = 3_500): string[] {
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

// Merge consecutive parts into one request up to the same size splitText already deemed
// reliable (3500), so many-small-segment articles collapse to far fewer calls while no
// single request grows larger than before (larger batches make the model drop content,
// fail the per-batch integrity check and retry — which costs more, not less).
function batches(parts: TranslationPart[], maxChars = 3_500): TranslationPart[][] {
  const grouped: TranslationPart[][] = [];
  let current: TranslationPart[] = [];
  let size = 0;
  for (const part of parts) {
    const length = part.text.length + (part.heading?.length ?? 0);
    if (current.length && size + length > maxChars) { grouped.push(current); current = []; size = 0; }
    current.push(part);
    size += length;
  }
  if (current.length) grouped.push(current);
  return grouped;
}

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
  reviewer = provider,
  enableReview = true,
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
    const dates: string[] = [];
    // Protect whole date expressions in the title first (alpha placeholder), then numbers.
    const protectedTitle = protectNumbers(protectTitleDates(title, dates), numbers);
    const protectedBatch = batch.map((part) => ({
      ...part,
      heading: part.heading ? protectNumbers(part.heading, numbers) : null,
      text: protectNumbers(part.text, numbers),
    }));
    let generated = await requestDraft(provider, institution, protectedTitle, protectedBatch);
    generated.draft.title = restoreTitleDates(restoreNumbers(generated.draft.title, numbers), dates);
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
      generated.draft.title = restoreTitleDates(restoreNumbers(generated.draft.title, numbers), dates);
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

  // The deterministic quality gate runs on every article; the extra LLM review is a
  // second opinion we only spend on important articles. When it is skipped, a passing
  // deterministic gate is enough to publish (avoids marking the long tail needs_review).
  let review: ReviewResult | null = null;
  if (enableReview && quality.passed && reviewer) {
    try {
      review = await reviewDraft(reviewer, source, translated);
    } catch {
      review = null;
    }
  }
  const reviewed = quality.passed && (enableReview ? review?.pass === true : true);
  const qualityScore = reviewed
    ? Number(((quality.score + (review?.score ?? quality.score)) / 2).toFixed(2))
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
      institution: { select: { name: true, rating: true } },
      segments: { orderBy: { position: "asc" } },
      analysis: { select: { importanceScore: true } },
      atomicViews: { select: { importance: true }, orderBy: { importance: "desc" }, take: 1 },
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
        institution: { select: { name: true, rating: true } },
        segments: { orderBy: { position: "asc" } },
        analysis: { select: { importanceScore: true } },
        atomicViews: { select: { importance: true }, orderBy: { importance: "desc" }, take: 1 },
      },
    });
  }

  // Production may review with a distinct provider; resolve it here (not inside the
  // pure translateArticle) so unit tests that inject a provider stay deterministic.
  const translationProvider = provider ?? getLLMProvider(process.env.TRANSLATION_PROVIDER);
  const reviewer = getLLMProvider(process.env.TRANSLATION_REVIEW_PROVIDER) ?? translationProvider ?? undefined;
  // Spend the extra LLM review only on important articles; the deterministic gate covers the rest.
  const important = article.institution.rating >= 5
    || (article.analysis?.importanceScore ?? 0) >= 0.6
    || (article.atomicViews[0]?.importance ?? 0) >= 4;
  const result = await translateArticle(article.institution.name, article.title, article.segments, translationProvider ?? undefined, reviewer, important);
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
