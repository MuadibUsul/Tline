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
