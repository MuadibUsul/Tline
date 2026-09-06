/** One run of text as the PDF lays it out, with the geometry needed to read structure. */
export interface PdfSourceBlock {
  id: string;
  page: number; // zero-based
  x: number;
  y: number; // PDF bottom-left coordinates
  width: number;
  height: number;
  fontSize?: number;
  text: string;
  sourceText: string;
}

export interface ExtractedPdf {
  pageCount: number;
  text: string;
  pages: string[];
  blocks: PdfSourceBlock[];
}

const PDF_BULLET = /^[•·▪◦‣►▶▸]/;

function pageText(items: { text: string; x: number; y: number; width: number; fontSize: number }[]) {
  const lines: string[] = [];
  let line = "";
  let previous: (typeof items)[number] | null = null;
  let previousWasHeading = false;
  const sizes = items.map((item) => item.fontSize).sort((a, b) => a - b);
  const bodySize = sizes[Math.floor(sizes.length / 2)] || 10;

  const flush = (paragraphBreak = false) => {
    if (line.trim()) lines.push(line.trim());
    if (paragraphBreak && lines.at(-1) !== "") lines.push("");
    line = "";
  };

  for (const item of items) {
    const verticalMove = previous ? Math.abs(item.y - previous.y) : 0;
    const changedLine = Boolean(previous && verticalMove > Math.max(2, Math.min(item.fontSize, previous.fontSize) * 0.45));
    const isHeading = item.fontSize >= bodySize * 1.5 && item.text.length <= 140;
    if (changedLine) {
      const largeGap = item.y < previous!.y && verticalMove > Math.max(item.fontSize, previous!.fontSize) * 1.65;
      if (largeGap || isHeading || previousWasHeading || PDF_BULLET.test(item.text)) flush(true);
      else if (line) line += " ";
    }

    const gap = previous && !changedLine ? item.x - (previous.x + previous.width) : 0;
    const separator = line && gap > -1 ? " " : "";
    line += `${separator}${item.text}`;
    previous = item;
    previousWasHeading = isHeading;
  }
  flush();
  return lines.join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

/** Keeps PDF page boundaries as translation segments instead of flattening a report. */
export function pdfSegments(extracted: ExtractedPdf) {
  return extracted.pages
    .map((text, page) => ({ heading: extracted.pageCount > 1 ? `Page ${page + 1}` : null, text }))
    .filter((segment) => segment.text.length > 0);
}

export async function extractPdf(source: Buffer): Promise<ExtractedPdf> {
  const pdfjs = await import("pdfjs-dist/legacy/build/pdf.mjs");
  const document = await pdfjs.getDocument({ data: new Uint8Array(source) }).promise;
  const blocks: PdfSourceBlock[] = [];
  const pageTexts: string[] = [];
  for (let pageIndex = 0; pageIndex < document.numPages; pageIndex++) {
    const page = await document.getPage(pageIndex + 1);
    const content = await page.getTextContent();
    const textItems: { text: string; x: number; y: number; width: number; fontSize: number }[] = [];
    let blockIndex = 0;
    for (const raw of content.items) {
      if (!("str" in raw) || typeof raw.str !== "string" || !raw.str.trim() || !Array.isArray(raw.transform)) continue;
      const fontSize = Math.max(6, Number(raw.height) || Math.abs(Number(raw.transform[3])) || 10);
      const sourceText = raw.str.trim();
      const x = Math.max(0, Number(raw.transform[4]) || 0);
      const y = Math.max(0, Number(raw.transform[5]) || 0);
      const width = Math.max(12, Number(raw.width) || fontSize * sourceText.length * 0.5);
      textItems.push({ text: sourceText, x, y, width, fontSize });
      blocks.push({
        id: `p${pageIndex + 1}-b${blockIndex++}`,
        page: pageIndex,
        x,
        y: Math.max(0, y - fontSize * 0.25),
        width,
        height: Math.max(fontSize * 1.35, fontSize + 3),
        fontSize,
        text: "",
        sourceText,
      });
    }
    pageTexts.push(pageText(textItems));
  }
  return { pageCount: document.numPages, text: pageTexts.join("\n\n"), pages: pageTexts, blocks };
}
