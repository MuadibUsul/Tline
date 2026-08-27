import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import path from "node:path";
import fontkit from "@pdf-lib/fontkit";
import { PDFDocument, rgb, type PDFFont } from "pdf-lib";
import { prisma } from "../db";
import { readPrivateFile, writePrivateFile } from "./storage";

export interface TranslatedPdfBlock {
  page: number; // zero-based
  x: number;
  y: number; // PDF bottom-left coordinates
  width: number;
  height: number;
  text: string;
  fontSize?: number;
}

function wrap(font: PDFFont, text: string, size: number, width: number) {
  const lines: string[] = [];
  for (const paragraph of text.split(/\n+/)) {
    let line = "";
    for (const char of paragraph) {
      const candidate = line + char;
      if (line && font.widthOfTextAtSize(candidate, size) > width) {
        lines.push(line);
        line = char;
      } else {
        line = candidate;
      }
    }
    if (line) lines.push(line);
  }
  return lines;
}

function fit(font: PDFFont, block: TranslatedPdfBlock) {
  let size = Math.min(block.fontSize ?? 10.5, 14);
  while (size > 6) {
    const lines = wrap(font, block.text, size, block.width);
    if (lines.length * size * 1.28 <= block.height) return { size, lines };
    size -= 0.5;
  }
  const lines = wrap(font, block.text, 6, block.width);
  if (lines.length * 7.68 > block.height) {
    throw new Error("Translated text does not fit its source PDF block without truncation.");
  }
  return { size: 6, lines };
}

function cjkFontPath() {
  const candidates = [process.env.PDF_LAYOUT_FONT_ZH, "C:\\Windows\\Fonts\\simhei.ttf"];
  const found = candidates.find((candidate) => candidate && existsSync(candidate));
  if (!found) throw new Error("No TTF font found for native PDF translation. Configure PDF_LAYOUT_FONT_ZH.");
  return found;
}

/**
 * Preserve every source page, image, chart, and line; replace only supplied text boxes.
 * Extraction/adapters own the coordinates, so low-confidence blocks can remain untouched.
 */
export async function createTranslatedNativePdf(source: Buffer, blocks: TranslatedPdfBlock[]) {
  const document = await PDFDocument.load(source, { ignoreEncryption: true });
  document.registerFontkit(fontkit);
  const font = await document.embedFont(await readFile(cjkFontPath()), { subset: true });
  const pages = document.getPages();

  for (const block of blocks) {
    const page = pages[block.page];
    if (!page || !block.text.trim() || block.width <= 0 || block.height <= 0) continue;
    if (block.x < 0 || block.y < 0 || block.x >= page.getWidth() || block.y >= page.getHeight()) {
      throw new Error("Translated text block falls outside its source PDF page.");
    }
    const box = {
      x: Math.max(0, block.x),
      y: Math.max(0, block.y),
      width: Math.min(block.width, page.getWidth() - Math.max(0, block.x)),
      height: Math.min(block.height, page.getHeight() - Math.max(0, block.y)),
    };
    const fitted = fit(font, { ...block, ...box });
    page.drawRectangle({ ...box, color: rgb(1, 1, 1), opacity: 0.97 });
    fitted.lines.forEach((line, index) => {
      page.drawText(line, {
        x: box.x,
        y: box.y + box.height - fitted.size - index * fitted.size * 1.28,
        size: fitted.size,
        font,
        color: rgb(0.08, 0.09, 0.11),
      });
    });
  }

  const buffer = Buffer.from(await document.save());
  const verified = await PDFDocument.load(buffer);
  if (verified.getPageCount() !== pages.length) throw new Error("Translated PDF changed the source page count.");
  return { buffer, pageCount: verified.getPageCount() };
}

export async function storeTranslatedNativePdf(
  articleId: string,
  translationId: string,
  nativeDocumentId: string,
  blocks: TranslatedPdfBlock[],
) {
  const native = await prisma.articleDocument.findUnique({ where: { id: nativeDocumentId } });
  if (!native || native.articleId !== articleId || native.kind !== "source_native" || native.status !== "ready") {
    throw new Error("Ready native source PDF not found for this article.");
  }
  const storageKey = path.posix.join("articles", articleId, "translation_pdf-zh-CN.pdf");
  const existing = await prisma.articleDocument.findUnique({
    where: { articleId_kind_locale: { articleId, kind: "translation_pdf", locale: "zh-CN" } },
  });
  try {
    const source = await readPrivateFile(native.storageKey);
    const result = await createTranslatedNativePdf(source, blocks);
    await writePrivateFile(storageKey, result.buffer);
    const contentHash = createHash("sha256").update(result.buffer).digest("hex");
    return prisma.articleDocument.upsert({
      where: { articleId_kind_locale: { articleId, kind: "translation_pdf", locale: "zh-CN" } },
      create: {
        articleId,
        translationId,
        kind: "translation_pdf",
        locale: "zh-CN",
        storageKey,
        contentHash,
        pageCount: result.pageCount,
        byteSize: result.buffer.byteLength,
        sourceUrl: native.sourceUrl,
        status: "ready",
      },
      update: {
        translationId,
        storageKey,
        contentHash,
        pageCount: result.pageCount,
        byteSize: result.buffer.byteLength,
        sourceUrl: native.sourceUrl,
        status: "ready",
        error: null,
      },
    });
  } catch (error) {
    if (existing?.status === "ready") {
      await prisma.articleDocument.update({
        where: { id: existing.id },
        data: { error: `Native-layout fallback: ${String(error).slice(0, 900)}` },
      });
      throw error;
    }
    await prisma.articleDocument.upsert({
      where: { articleId_kind_locale: { articleId, kind: "translation_pdf", locale: "zh-CN" } },
      create: {
        articleId,
        translationId,
        kind: "translation_pdf",
        locale: "zh-CN",
        storageKey,
        sourceUrl: native.sourceUrl,
        status: "failed",
        error: String(error).slice(0, 1000),
      },
      update: { status: "failed", error: String(error).slice(0, 1000) },
    });
    throw error;
  }
}
