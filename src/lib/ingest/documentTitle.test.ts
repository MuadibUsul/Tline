import assert from "node:assert/strict";
import test from "node:test";
import type { PdfSourceBlock } from "../documents/extractPdf";
import { cleanLinkTitle, isOpaqueFilename, resolveDocumentTitle, titleFromPdfBlocks } from "./documentTitle";

const block = (text: string, y: number, fontSize: number, x = 0): PdfSourceBlock =>
  ({ id: `${y}-${x}`, page: 0, x, y, width: 100, height: fontSize, fontSize, text: "", sourceText: text });

test("a link that only instructs the reader yields no title", () => {
  assert.equal(cleanLinkTitle("Download PDF"), "");
  assert.equal(cleanLinkTitle("Download the PDF"), "");
  assert.equal(cleanLinkTitle("View Transcript"), "");
  assert.equal(cleanLinkTitle("Go to Article"), "");
  assert.equal(cleanLinkTitle("下载PDF"), "");
  assert.equal(cleanLinkTitle("查看全文"), "");
  assert.equal(cleanLinkTitle("Download PDF 228.4 KB"), "");
  assert.equal(cleanLinkTitle("Insights"), "");
});

test("a title wrapped in an instruction is recovered", () => {
  assert.equal(cleanLinkTitle('Download the PDF "Fueling Resilience"'), "Fueling Resilience");
  assert.equal(cleanLinkTitle('Download the PDF " Navigating the Global Liquidity Maze"'), "Navigating the Global Liquidity Maze");
  assert.equal(cleanLinkTitle("Read the report: Gold outlook 2027"), "Gold outlook 2027");
});

test("a real title passes through untouched", () => {
  assert.equal(cleanLinkTitle("Monthly Housing Market Update"), "Monthly Housing Market Update");
  assert.equal(cleanLinkTitle("黄金四季度展望"), "黄金四季度展望");
});

test("anchor text that is itself a slug defers to the document", () => {
  const blocks = [
    { id: "a", page: 0, x: 0, y: 700, width: 100, height: 18, fontSize: 18, text: "", sourceText: "US Rates Strategy" },
    { id: "b", page: 0, x: 0, y: 620, width: 100, height: 15, fontSize: 15, text: "", sourceText: "AI capital expenditures" },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `c${i}`, page: 0, x: 0, y: 560 - i * 12, width: 100, height: 11, fontSize: 11, text: "", sourceText: `body ${i}` })),
  ];
  assert.equal(cleanLinkTitle("AIcapex"), "");
  assert.equal(
    resolveDocumentTitle({ linkTitle: "AIcapex", blocks, filename: "AIcapex" }),
    "US Rates Strategy · AI capital expenditures",
  );
});

test("slugs, codes and date stamps are recognised as naming nothing", () => {
  for (const opaque of ["jacksonhole", "AIcapex", "SimFOMC", "daily08032026", "DTO 270826", "20260901"]) {
    assert.equal(isOpaqueFilename(opaque), true, `${opaque} should be opaque`);
  }
  // Chinese titles carry no spaces, so word count must not condemn them.
  for (const real of ["Global Rates Outlook", "US housing update", "黄金四季度展望", "美联储政策展望"]) {
    assert.equal(isOpaqueFilename(real), false, `${real} should be usable`);
  }
});

test("the document's own heading is read from the type hierarchy", () => {
  // A masthead above a byline above the report's own title, as most desks typeset it.
  const blocks = [
    block("US Rates Strategy", 686, 18),
    block("August 28, 2026", 664, 10),
    block("Joseph Abate", 663, 11),
    block("Key principles rather than forward guidance", 595, 15),
    ...Array.from({ length: 12 }, (_, i) => block(`body line ${i}`, 560 - i * 12, 11)),
  ];
  assert.equal(titleFromPdfBlocks(blocks), "US Rates Strategy · Key principles rather than forward guidance");
});

test("a single heading is not padded with anything else", () => {
  const blocks = [
    block("MONTHLY HOUSING MARKET UPDATE", 700, 20),
    ...Array.from({ length: 12 }, (_, i) => block(`body line ${i}`, 600 - i * 12, 10)),
  ];
  assert.equal(titleFromPdfBlocks(blocks), "MONTHLY HOUSING MARKET UPDATE");
});

test("a document set entirely in body type yields no title", () => {
  const blocks = Array.from({ length: 20 }, (_, i) => block(`transcript line ${i}`, 700 - i * 12, 12));
  assert.equal(titleFromPdfBlocks(blocks), "");
});

test("sources are consulted in order of how much each can be trusted", () => {
  const blocks = [
    block("Daily Credit Snapshot", 700, 16),
    ...Array.from({ length: 12 }, (_, i) => block(`body ${i}`, 600 - i * 12, 10)),
  ];
  // The link names the report, so the document is not consulted.
  assert.equal(resolveDocumentTitle({ linkTitle: "Gold outlook", blocks, filename: "gold" }), "Gold outlook");
  // The link only instructs, so the document speaks for itself.
  assert.equal(resolveDocumentTitle({ linkTitle: "Download PDF", blocks, filename: "dcs270826" }), "Daily Credit Snapshot");
  // Neither the link nor the document helps: the filename is all that is left.
  assert.equal(resolveDocumentTitle({ linkTitle: "Download PDF", filename: "jacksonhole" }), "jacksonhole");
});

test("a paragraph sharing the heading's size is not mistaken for the title", () => {
  const long = "The business equipment subcomponent of the report has taken on added importance in recent years due to its strong correlation with capital spending.";
  const blocks = [
    { id: "h", page: 0, x: 0, y: 700, width: 100, height: 16, fontSize: 16, text: "", sourceText: "CapEx Signals Remain Constructive" },
    // Same size, immediately below, but plainly prose.
    { id: "p", page: 0, x: 0, y: 660, width: 100, height: 16, fontSize: 16, text: "", sourceText: long },
    ...Array.from({ length: 12 }, (_, i) => ({ id: `b${i}`, page: 0, x: 0, y: 600 - i * 12, width: 100, height: 10, fontSize: 10, text: "", sourceText: `body ${i}` })),
  ];
  const title = titleFromPdfBlocks(blocks);
  assert.ok(!title.includes("strong correlation"), `body text leaked into the title: ${title}`);
});
