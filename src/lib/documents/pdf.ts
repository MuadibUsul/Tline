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
  /** Anchored to body segments exactly as on the page, so the PDF and the page agree. */
  tables?: PdfTable[];
}

export interface PdfTable {
  afterSegmentPosition: number;
  caption: string | null;
  headerRow: boolean;
  rows: string[][];
}

/** The stored table payload, or an empty grid when a row was written by an older shape. */
function parseTableRows(dataJson: string): string[][] {
  try {
    const parsed = JSON.parse(dataJson) as { rows?: unknown };
    if (!Array.isArray(parsed.rows)) return [];
    return parsed.rows
      .filter((row): row is unknown[] => Array.isArray(row))
      .map((row) => row.map((cell) => String(cell ?? "")));
  } catch {
    return [];
  }
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

/**
 * Draw one table, typeset rather than flattened.
 *
 * A generated PDF is the only English document for a report whose publisher offered none, so
 * it has to carry the exhibits — and the cells are no longer in the body text they used to be
 * lifted into. Columns take widths proportional to their content (clamped, so one wordy column
 * cannot squeeze the others to nothing), rows are ruled underneath, and a row that will not fit
 * moves the whole table on rather than splitting a figure from its heading.
 */
function drawTable(doc: PDFKit.PDFDocument, table: PdfTable, fonts: { regular: string; bold: string }, contentWidth: number) {
  const columns = Math.max(...table.rows.map((row) => row.length));
  if (columns === 0) return;
  const CELL = 8.5;
  const padX = 5;
  const padY = 3.5;
  const left = doc.page.margins.left;
  const weights = Array.from({ length: columns }, (_, column) =>
    Math.min(60, Math.max(8, ...table.rows.map((row) => (row[column] ?? "").length))));
  const totalWeight = weights.reduce((sum, weight) => sum + weight, 0);
  const widths = weights.map((weight) => (weight / totalWeight) * contentWidth);

  const heightOf = (row: string[], bold: boolean) => {
    doc.font(bold ? fonts.bold : fonts.regular).fontSize(CELL);
    return Math.max(...Array.from({ length: columns }, (_, column) =>
      doc.heightOfString(row[column] || " ", { width: widths[column] - padX * 2, lineGap: 1.5 }))) + padY * 2;
  };
  const drawRow = (row: string[], bold: boolean) => {
    const top = doc.y;
    const height = heightOf(row, bold);
    doc.font(bold ? fonts.bold : fonts.regular).fontSize(CELL);
    let x = left;
    for (let column = 0; column < columns; column++) {
      const cell = row[column] ?? "";
      if (cell) doc.fillColor(bold ? "#14161b" : "#3d424d").text(cell, x + padX, top + padY, { width: widths[column] - padX * 2, lineGap: 1.5 });
      x += widths[column];
    }
    doc.strokeColor("#e4e7ec").lineWidth(0.5).moveTo(left, top + height).lineTo(left + contentWidth, top + height).stroke();
    doc.y = top + height;
  };

  if (table.caption) {
    doc.font(fonts.regular).fontSize(8.5).fillColor("#6a7180").text(table.caption, { lineGap: 2 });
    doc.moveDown(0.3);
  }
  doc.moveDown(0.3);
  const bottom = doc.page.height - doc.page.margins.bottom;
  // A table begun at the foot of a page reads as a fragment; start it on the next one instead.
  if (doc.y > bottom - 120) doc.addPage();
  const header = table.headerRow ? table.rows[0] : null;
  if (header) drawRow(header, true);
  for (const row of table.headerRow ? table.rows.slice(1) : table.rows) {
    if (doc.y > bottom - 36) {
      doc.addPage();
      if (header) drawRow(header, true);
    }
    drawRow(row, false);
  }
  doc.moveDown(0.9);
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

  const tables = input.tables ?? [];
  const tablesAt = (index: number) => tables.filter((table) => table.afterSegmentPosition === index);
  for (const table of tables.filter((entry) => entry.afterSegmentPosition < 0)) drawTable(doc, table, fonts, contentWidth);
  for (const [position, segment] of input.segments.entries()) {
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
    for (const table of tablesAt(position)) drawTable(doc, table, fonts, contentWidth);
  }
  for (const table of tables.filter((entry) => entry.afterSegmentPosition >= input.segments.length)) drawTable(doc, table, fonts, contentWidth);

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
      tables: { orderBy: [{ afterSegmentPosition: "asc" }, { ordinal: "asc" }] },
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
    tables: article.tables.map((table) => ({
      afterSegmentPosition: table.afterSegmentPosition,
      caption: table.caption,
      headerRow: table.headerRow,
      rows: parseTableRows(table.dataJson),
    })),
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
