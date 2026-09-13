import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import PDFKit from "pdfkit";
import { PDFDocument as PDFLibDocument } from "pdf-lib";
import { prisma } from "../db";
import { preferredEnglishDocuments } from "../publication";
import { writePrivateFile } from "./storage";
import { assertSafeSourcePdf } from "./pdfSafety";

export interface DocumentSegment {
  heading: string | null;
  text: string;
}

export interface ArticlePdfInput {
  title: string;
  institution: string;
  author?: string | null;
  publishedAt: Date;
  sourceUrl: string;
  /** English only: the Chinese rendering of a report lives on the page, not in a PDF. */
  locale: "en";
  segments: DocumentSegment[];
}

function fontCandidates(bold: boolean) {
  return [
    bold ? process.env.PDF_FONT_EN_BOLD : process.env.PDF_FONT_EN,
    bold ? "C:/Windows/Fonts/arialbd.ttf" : "C:/Windows/Fonts/arial.ttf",
    bold ? "/usr/share/fonts/truetype/liberation2/LiberationSans-Bold.ttf" : "/usr/share/fonts/truetype/liberation2/LiberationSans-Regular.ttf",
  ];
}

function configureFonts(doc: PDFKit.PDFDocument) {
  const regular = fontCandidates(false).find((candidate) => candidate && existsSync(candidate));
  const bold = fontCandidates(true).find((candidate) => candidate && existsSync(candidate));
  if (regular) doc.registerFont("TlineRegular", regular);
  if (bold || regular) doc.registerFont("TlineBold", bold || regular!);
  return {
    regular: regular ? "TlineRegular" : "Helvetica",
    bold: bold || regular ? "TlineBold" : "Helvetica-Bold",
  };
}

export async function createArticlePdf(input: ArticlePdfInput) {
  const doc = new PDFKit({
    size: "A4",
    margins: { top: 52, right: 54, bottom: 58, left: 54 },
    bufferPages: true,
    info: {
      Title: input.title,
      Author: input.institution,
      Subject: "Institutional research",
      Creator: "Tline Institutional Intelligence",
    },
  });
  const chunks: Buffer[] = [];
  doc.on("data", (chunk) => chunks.push(Buffer.from(chunk)));
  const completed = new Promise<Buffer>((resolve, reject) => {
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);
  });
  const fonts = configureFonts(doc);
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.font(fonts.bold).fontSize(9).fillColor("#2f55d4").text("TLINE · INSTITUTIONAL INTELLIGENCE", { characterSpacing: 0.7 });
  doc.moveDown(1.25);
  doc.font(fonts.bold).fontSize(22).fillColor("#14161b").text(input.title, { lineGap: 3 });
  doc.moveDown(0.7);
  const meta = [
    input.institution,
    input.author || null,
    input.publishedAt.toISOString().slice(0, 10),
    "English original",
  ].filter(Boolean).join(" · ");
  doc.font(fonts.regular).fontSize(9).fillColor("#6a7180").text(meta);
  doc.moveDown(1);
  doc.strokeColor("#2f55d4").lineWidth(1.2).moveTo(doc.x, doc.y).lineTo(doc.x + contentWidth, doc.y).stroke();
  doc.moveDown(1.4);

  for (const segment of input.segments) {
    if (segment.heading) {
      if (doc.y > doc.page.height - 145) doc.addPage();
      doc.font(fonts.bold).fontSize(13).fillColor("#14161b").text(segment.heading, { lineGap: 2 });
      doc.moveDown(0.45);
    }
    for (const paragraph of segment.text.split(/\n{2,}/).map((value) => value.trim()).filter(Boolean)) {
      doc.font(fonts.regular).fontSize(10.5).fillColor("#3d424d").text(paragraph, {
        align: "left",
        lineGap: 3.2,
      });
      doc.moveDown(0.75);
    }
  }

  doc.moveDown(0.8);
  doc.strokeColor("#e4e7ec").lineWidth(0.7).moveTo(doc.x, doc.y).lineTo(doc.x + contentWidth, doc.y).stroke();
  doc.moveDown(0.8);
  doc.font(fonts.regular).fontSize(8.5).fillColor("#6a7180").text(
    "Source: " + input.sourceUrl,
    { link: input.sourceUrl, underline: false },
  );

  const range = doc.bufferedPageRange();
  for (let index = range.start; index < range.start + range.count; index++) {
    doc.switchToPage(index);
    const bottomMargin = doc.page.margins.bottom;
    doc.page.margins.bottom = 0;
    doc.font(fonts.regular).fontSize(8).fillColor("#98a0ad").text(
      `${index + 1} / ${range.count}`,
      doc.page.margins.left,
      doc.page.height - 34,
      { width: contentWidth, align: "right", lineBreak: false },
    );
    doc.page.margins.bottom = bottomMargin;
  }
  doc.end();

  const buffer = await completed;
  const loaded = await PDFLibDocument.load(buffer);
  return { buffer, pageCount: loaded.getPageCount() };
}

function hash(buffer: Buffer) {
  return createHash("sha256").update(buffer).digest("hex");
}

async function markFailed(articleId: string, kind: string, locale: string, storageKey: string, error: unknown) {
  await prisma.articleDocument.upsert({
    where: { articleId_kind_locale: { articleId, kind, locale } },
    create: {
      articleId,
      kind,
      locale,
      storageKey,
      status: "failed",
      error: String(error).slice(0, 1000),
    },
    update: { status: "failed", error: String(error).slice(0, 1000) },
  });
}

async function storeGenerated(
  articleId: string,
  translationId: string | null,
  kind: "original_pdf",
  locale: "en",
  sourceUrl: string,
  input: ArticlePdfInput,
) {
  const storageKey = path.posix.join("articles", articleId, kind + "-" + locale + ".pdf");
  try {
    await prisma.articleDocument.upsert({
      where: { articleId_kind_locale: { articleId, kind, locale } },
      create: { articleId, translationId, kind, locale, storageKey, sourceUrl, status: "processing" },
      update: { translationId, storageKey, sourceUrl, status: "processing", error: null },
    });
    const pdf = await createArticlePdf(input);
    await writePrivateFile(storageKey, pdf.buffer);
    return prisma.articleDocument.update({
      where: { articleId_kind_locale: { articleId, kind, locale } },
      data: {
        contentHash: hash(pdf.buffer),
        pageCount: pdf.pageCount,
        byteSize: pdf.buffer.byteLength,
        status: "ready",
        error: null,
      },
    });
  } catch (error) {
    await markFailed(articleId, kind, locale, storageKey, error);
    throw error;
  }
}

export async function generateArticleDocuments(articleId: string) {
  const article = await prisma.article.findUnique({
    where: { id: articleId },
    include: {
      institution: true,
      segments: { orderBy: { position: "asc" } },
      documents: {
        where: { kind: "source_native", locale: "en", status: "ready" },
        select: { kind: true },
        take: 1,
      },
    },
  });
  if (!article?.rawText) throw new Error("Article has no canonical English body.");
  // The institution's PDF is already the canonical English document. Generating a second
  // rendering wastes storage and creates two downloads whose differences confuse readers.
  if (preferredEnglishDocuments(article.documents).length) return { original: null };
  const sourceSegments = article.segments.length
    ? article.segments
    : [{ heading: null, text: article.rawText }];
  const original = await storeGenerated(article.id, null, "original_pdf", "en", article.sourceUrl, {
    title: article.title,
    institution: article.institution.name,
    author: article.author,
    publishedAt: article.publishedAt,
    sourceUrl: article.sourceUrl,
    locale: "en",
    segments: sourceSegments,
  });

  // English only. The Chinese rendering of a report lives on the page, where it can be
  // corrected as the translation improves; a second PDF only froze one revision of it.
  return { original };
}

/** Persist a PDF fetched only after the ingestion layer has approved the URL. */
export async function saveNativePdf(articleId: string, sourceUrl: string, buffer: Buffer) {
  assertSafeSourcePdf(buffer);
  const loaded = await PDFLibDocument.load(buffer, { ignoreEncryption: true });
  const storageKey = path.posix.join("articles", articleId, "source-native-en.pdf");
  await writePrivateFile(storageKey, buffer);
  return prisma.articleDocument.upsert({
    where: { articleId_kind_locale: { articleId, kind: "source_native", locale: "en" } },
    create: {
      articleId,
      kind: "source_native",
      locale: "en",
      storageKey,
      contentHash: hash(buffer),
      mimeType: "application/pdf",
      pageCount: loaded.getPageCount(),
      byteSize: buffer.byteLength,
      sourceUrl,
      status: "ready",
    },
    update: {
      storageKey,
      contentHash: hash(buffer),
      pageCount: loaded.getPageCount(),
      byteSize: buffer.byteLength,
      sourceUrl,
      status: "ready",
      error: null,
    },
  });
}
