import type { PdfSourceBlock } from "../documents/extractPdf";

/**
 * Titles for reports whose substance lives in a PDF.
 *
 * A listing page gives us the link's anchor text and the PDF's filename, and both lie
 * routinely: the anchor is often a button ("Download PDF", "View Transcript") and the
 * filename is often a slug ("jacksonhole", "daily08032026"). The document itself does
 * not lie — its title is set in the largest type at the top of the first page — so that
 * is what these read.
 */

// Anchor text that is an instruction rather than a name, in either language.
const CALL_TO_ACTION =
  /^\s*(?:download|read|view|open|get|access|see)\s*(?:the\s+)?(?:full\s+|complete\s+|latest\s+)?(?:pdf|report|transcript|document|article|paper|note|publication|version|here)?\s*[:：·|–—-]*\s*/i;
const CHINESE_CALL_TO_ACTION = /^\s*(?:下载|查看|阅读|点击(?:下载|查看)?|获取)\s*(?:全文|完整版?|报告|文件|原文)?\s*(?:pdf)?\s*[:：·|–—-]*\s*/i;

// Section headings a publisher repeats across every page; true of the section, useless
// as the name of one report.
const GENERIC_LABEL = /^(?:research|insights?|publications?|reports?|analysis|commentary|latest|news|home|pdf|更多|研究|报告|观点)$/i;

/**
 * Recovers the real title from link text, or "" when the text carries none.
 *
 * Publishers commonly wrap the title in the instruction — `Download the PDF "Fueling
 * Resilience"` — so a quoted run is taken as the answer before anything else.
 */
export function cleanLinkTitle(raw: string | null | undefined): string {
  const value = (raw ?? "").replace(/\s+/g, " ").trim();
  if (!value) return "";

  const quoted = /["“”「『]\s*([^"“”「」『』]{3,180}?)\s*["“”」』]/.exec(value);
  if (quoted) return quoted[1].trim();

  const stripped = value.replace(CALL_TO_ACTION, "").replace(CHINESE_CALL_TO_ACTION, "").trim();
  // Nothing but the instruction: "Download PDF", "查看全文".
  if (!stripped || stripped.length < 3) return "";
  if (GENERIC_LABEL.test(stripped)) return "";
  // Anchor text is as prone to slugs as a filename is — "jacksonhole", "AIcapex" — and a
  // slug must not outrank the heading the document sets for itself.
  if (isOpaqueFilename(stripped)) return "";
  return stripped;
}

/** A filename that names nothing: a slug, a code, or a date stamp. */
export function isOpaqueFilename(name: string) {
  const value = name.trim();
  if (value.length < 3) return true;
  if (!/[a-z一-鿿]/i.test(value)) return true;
  // "daily08032026", "DTO 270826" — a date or reference number doing the naming.
  if (/\d{5,}/.test(value.replace(/\s/g, ""))) return true;
  // Chinese writes titles without spaces, so word count says nothing there; a few
  // characters already carry meaning.
  if (/[一-鿿]/.test(value)) return value.replace(/[^一-鿿]/g, "").length < 3;
  // A single run-together token is a slug, not a title: "jacksonhole", "AIcapex".
  return value.split(/\s+/).length < 2;
}

// Roughly the top third of a portrait page, in PDF points.
const TOP_BAND_POINTS = 250;
const TITLE_MIN = 6;
const TITLE_MAX = 200;

/**
 * The title as the document itself sets it, read from the type hierarchy of page one.
 *
 * Size is measured against the body text rather than taken absolutely, because a house
 * style that sets everything small would otherwise yield no heading at all. Two levels
 * are kept, not one: many publishers put the series masthead in the largest type and the
 * report's own title just beneath it, so taking only the largest would title every issue
 * of a daily identically.
 */
export function titleFromPdfBlocks(blocks: PdfSourceBlock[]): string {
  // fontSize is optional on the shared block type; a block without one cannot be judged
  // against the body size, so it is read at zero and simply never counts as a heading.
  const first = blocks
    .filter((block) => block.page === 0 && block.sourceText.trim())
    .map((block) => ({ ...block, size: block.fontSize ?? 0 }));
  if (first.length === 0) return "";

  const sizes = first.map((block) => block.size).sort((a, b) => a - b);
  const body = sizes[Math.floor(sizes.length / 2)] ?? 0;

  // A fixed band down from the top of the page, rather than a share of however much text
  // the page happens to carry: a sparse first page would otherwise shrink the band until
  // it excluded the very title being looked for. Size does the real discriminating; the
  // band only stops a large heading deeper in the document from winning.
  const highest = Math.max(...first.map((block) => block.y));
  const band = first.filter((block) => block.y >= highest - TOP_BAND_POINTS && block.size >= body * 1.2);
  if (band.length === 0) return "";

  const levels = [...new Set(band.map((block) => block.size))].sort((a, b) => b - a).slice(0, 2);
  const parts: string[] = [];
  for (const size of levels) {
    const line = band
      .filter((block) => block.size === size)
      .sort((a, b) => b.y - a.y || a.x - b.x)
      .map((block) => block.sourceText.trim())
      .join(" ")
      .replace(/\s+/g, " ")
      .trim();
    // A masthead repeated inside the title below it adds nothing.
    if (line && !parts.some((part) => part.toLowerCase().includes(line.toLowerCase()))) parts.push(line);
  }

  const text = parts.join(" · ").slice(0, TITLE_MAX).trim();
  if (text.length < TITLE_MIN) return "";
  if (!/[a-z一-鿿]/i.test(text)) return "";
  if (GENERIC_LABEL.test(text)) return "";
  return text;
}

/**
 * The title for a report backed by a PDF, in order of how much each source can be
 * trusted: what the link called it, what the document calls itself, what the page was
 * called, and only then the filename.
 */
export function resolveDocumentTitle(sources: {
  linkTitle?: string | null;
  blocks?: PdfSourceBlock[];
  pageTitle?: string | null;
  filename?: string | null;
}): string {
  const fromLink = cleanLinkTitle(sources.linkTitle);
  if (fromLink) return fromLink;

  const fromDocument = sources.blocks ? titleFromPdfBlocks(sources.blocks) : "";
  if (fromDocument) return fromDocument;

  const fromPage = cleanLinkTitle(sources.pageTitle);
  if (fromPage) return fromPage;

  // Last resort: an opaque filename still names the report better than nothing, and
  // dropping the report over its title would lose content that is otherwise sound.
  return (sources.filename ?? "").trim();
}
