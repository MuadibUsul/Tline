import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import path from "node:path";
import PDFKit from "pdfkit";
import { PDFDocument as PDFLibDocument } from "pdf-lib";
import { prisma } from "../db";
import { writePrivateFile } from "./storage";

const MAX_NATIVE_PDF_BYTES = 50 * 1024 * 1024;

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
  locale: "en" | "zh-CN";
  segments: DocumentSegment[];
}

function fontCandidates(locale: ArticlePdfInput["locale"], bold: boolean) {
  if (locale === "zh-CN") {
    return [
      bold ? process.env.PDF_FONT_ZH_BOLD : process.env.PDF_FONT_ZH,
      bold ? "C:\\Windows\\Fonts\\msyhbd.ttc" : "C:\\Windows\\Fonts\\msyh.ttc",
    ];
  }
  return [
    bold ? process.env.PDF_FONT_EN_BOLD : process.env.PDF_FONT_EN,
    bold ? "C:\\Windows\\Fonts\\arialbd.ttf" : "C:\\Windows\\Fonts\\arial.ttf",
  ];
}

function configureFonts(doc: PDFKit.PDFDocument, locale: ArticlePdfInput["locale"]) {
  const regular = fontCandidates(locale, false).find((candidate) => candidate && existsSync(candidate));
  const bold = fontCandidates(locale, true).find((candidate) => candidate && existsSync(candidate));
  if (locale === "zh-CN" && !regular) {
    throw new Error("No Chinese PDF font found. Configure PDF_FONT_ZH and PDF_FONT_ZH_BOLD.");
  }
  const collectionFont = (font: string | undefined, isBold: boolean) => {
    if (!font?.toLowerCase().endsWith(".ttc")) return undefined;
    return isBold
      ? process.env.PDF_FONT_ZH_BOLD_FAMILY || "MicrosoftYaHei-Bold"
      : process.env.PDF_FONT_ZH_FAMILY || "MicrosoftYaHei";
  };
  if (regular) doc.registerFont("TlineRegular", regular, collectionFont(regular, false));
  if (bold || regular) doc.registerFont("TlineBold", bold || regular!, collectionFont(bold || regular, Boolean(bold)));
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
  const fonts = configureFonts(doc, input.locale);
  const contentWidth = doc.page.width - doc.page.margins.left - doc.page.margins.right;

  doc.font(fonts.bold).fontSize(9).fillColor("#2f55d4").text("TLINE · INSTITUTIONAL INTELLIGENCE", { characterSpacing: 0.7 });
  doc.moveDown(1.25);
  doc.font(fonts.bold).fontSize(22).fillColor("#14161b").text(input.title, { lineGap: 3 });
  doc.moveDown(0.7);
  const meta = [
    input.institution,
    input.author || null,
    input.publishedAt.toISOString().slice(0, 10),
    input.locale === "zh-CN" ? "中文译文" : "English original",
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
    (input.locale === "zh-CN" ? "译文仅用于研究阅读；权威版本以机构原文为准。来源：" : "Source: ") + input.sourceUrl,
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
  kind: "original_pdf" | "translation_pdf",
  locale: "en" | "zh-CN",
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
      translations: {
        where: { locale: "zh-CN" },
        include: { segments: { orderBy: { position: "asc" } } },
      },
    },
  });
  if (!article?.rawText) throw new Error("Article has no canonical English body.");
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

  const translation = article.translations[0];
  const translated = translation?.segments.length
    ? await storeGenerated(article.id, translation.id, "translation_pdf", "zh-CN", article.sourceUrl, {
        title: translation.title,
        institution: article.institution.name,
        author: article.author,
        publishedAt: article.publishedAt,
        sourceUrl: article.sourceUrl,
        locale: "zh-CN",
        segments: translation.segments,
      })
    : null;
  return { original, translated };
}

/** Persist a PDF fetched only after the ingestion layer has approved the URL. */
export async function saveNativePdf(articleId: string, sourceUrl: string, buffer: Buffer) {
  if (buffer.byteLength > MAX_NATIVE_PDF_BYTES) throw new Error("Native PDF exceeds the 50 MB limit.");
  if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("Downloaded file is not a PDF.");
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
