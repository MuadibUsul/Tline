import { completeJSON, getLLMProvider, type LLMProvider } from "../llm/provider";
import { validateTranslation } from "../translation/quality";
import { readPrivateFile } from "./storage";
import { storeTranslatedNativePdf, type TranslatedPdfBlock } from "./nativeLayout";
import { prisma } from "../db";
import glossary from "../../../data/financial_glossary.zh-CN.json";

export interface PdfSourceBlock extends TranslatedPdfBlock {
  id: string;
  sourceText: string;
}

export interface ExtractedPdf {
  pageCount: number;
  text: string;
  blocks: PdfSourceBlock[];
}

export async function extractPdf(source: Buffer): Promise<ExtractedPdf> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: new Uint8Array(source) }).promise;
  const blocks: PdfSourceBlock[] = [];
  const pageTexts: string[] = [];
  for (let pageIndex = 0; pageIndex < document.numPages; pageIndex++) {
    const page = await document.getPage(pageIndex + 1);
    const content = await page.getTextContent();
    const texts: string[] = [];
    let blockIndex = 0;
    for (const raw of content.items) {
      if (!("str" in raw) || typeof raw.str !== "string" || !raw.str.trim() || !Array.isArray(raw.transform)) continue;
      const fontSize = Math.max(6, Number(raw.height) || Math.abs(Number(raw.transform[3])) || 10);
      const sourceText = raw.str.trim();
      texts.push(sourceText);
      blocks.push({
        id: `p${pageIndex + 1}-b${blockIndex++}`,
        page: pageIndex,
        x: Math.max(0, Number(raw.transform[4]) || 0),
        y: Math.max(0, (Number(raw.transform[5]) || 0) - fontSize * 0.25),
        width: Math.max(12, Number(raw.width) || fontSize * sourceText.length * 0.5),
        height: Math.max(fontSize * 1.35, fontSize + 3),
        fontSize,
        text: "",
        sourceText,
      });
    }
    pageTexts.push(texts.join(" "));
  }
  return { pageCount: document.numPages, text: pageTexts.join("\n\n"), blocks };
}

interface BlockResponse {
  blocks?: { id?: string; text?: string }[];
}

async function translateBatch(provider: LLMProvider, blocks: PdfSourceBlock[]) {
  const request = async (issues: string[] = []) => {
    const response = await completeJSON<BlockResponse>(provider, {
      system: `Translate institutional financial research from English to professional Simplified Chinese.
Translate every supplied text block completely. Preserve numbers, currencies, percentages, basis points,
dates, tickers, modality, and block IDs. Do not summarize or add analysis.
Return ONLY JSON: {"blocks":[{"id":string,"text":string}]}.`,
      user: JSON.stringify({ glossary, correction_issues: issues, blocks: blocks.map((block) => ({ id: block.id, text: block.sourceText })) }),
      maxTokens: 5000,
    });
    const rows = Array.isArray(response.value.blocks) ? response.value.blocks : [];
    return new Map(rows
      .filter((row): row is { id: string; text: string } => typeof row.id === "string" && typeof row.text === "string" && Boolean(row.text.trim()))
      .map((row) => [row.id, row.text.trim()]));
  };
  let byId = await request();
  if (byId.size !== blocks.length || blocks.some((block) => !byId.has(block.id))) {
    throw new Error("Native PDF translation omitted or duplicated text blocks.");
  }
  const source = blocks.map((block) => block.sourceText).join("\n");
  let translated = blocks.map((block) => byId.get(block.id)!).join("\n");
  let quality = validateTranslation(source, translated, blocks.length, byId.size);
  if (!quality.passed) {
    byId = await request(quality.issues.map((issue) => issue.message));
    translated = blocks.map((block) => byId.get(block.id) ?? "").join("\n");
    quality = validateTranslation(source, translated, blocks.length, byId.size);
  }
  if (!quality.passed) {
    throw new Error("Native PDF translation failed integrity checks: " + quality.issues.map((issue) => issue.message).join(" "));
  }
  return blocks.map((block) => ({ ...block, text: byId.get(block.id)! }));
}

export async function translateNativeDocument(
  articleId: string,
  translationId: string,
  nativeDocumentId: string,
  provider = getLLMProvider(process.env.TRANSLATION_PROVIDER),
) {
  if (!provider) throw new Error("No LLM provider configured for native PDF translation.");
  const native = await prisma.articleDocument.findUnique({ where: { id: nativeDocumentId } });
  if (!native || native.articleId !== articleId || native.kind !== "source_native" || native.status !== "ready") {
    throw new Error("Ready native source PDF not found for this article.");
  }
  const extracted = await extractPdf(await readPrivateFile(native.storageKey));
  if (extracted.blocks.length === 0) throw new Error("Native PDF has no extractable text blocks; OCR is required.");
  const translated: TranslatedPdfBlock[] = [];
  for (let index = 0; index < extracted.blocks.length; index += 40) {
    translated.push(...await translateBatch(provider, extracted.blocks.slice(index, index + 40)));
  }
  return storeTranslatedNativePdf(articleId, translationId, nativeDocumentId, translated);
}
