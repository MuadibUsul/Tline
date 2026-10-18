import assert from "node:assert/strict";
import test from "node:test";
import { renderToStaticMarkup } from "react-dom/server";
import { renderNewsMarkdownBlocks } from "./newsMarkdown";

async function html(blocks: string[]) {
  const nodes = await renderNewsMarkdownBlocks(blocks, "zh-CN");
  return nodes.map((node) => renderToStaticMarkup(node)).join("");
}

test("renders the newsroom's whitelisted Markdown", async () => {
  const output = await html([
    "==重要== 与 **加粗** 和 :badge[高]",
    "| 指标 | 数值 |\n|---|---|\n| CPI | 3.4% |",
    "- [x] 已核实\n- [ ] 待核实",
    "> [!warning] 数据说明\n> 这是备注。",
  ]);
  assert.match(output, /<mark class="hl">重要<\/mark>/);
  assert.match(output, /<strong>加粗<\/strong>/);
  assert.match(output, /<span class="news-badge">高<\/span>/);
  assert.match(output, /<div class="news-table-wrap"><table>/);
  assert.match(output, /type="checkbox"/);
  assert.match(output, /<aside class="news-callout warning">/);
  assert.match(output, /<div class="news-callout-title">数据说明<\/div>/);
});

test("raw HTML, event handlers, style and javascript: links do not survive", async () => {
  const output = await html([
    "<script>alert(1)</script>",
    "<iframe src=\"https://example.com\"></iframe>",
    "<img src=x onerror=\"alert(1)\">",
    "<span style=\"color:red\" onclick=\"alert(1)\">x</span>",
    "[click](javascript:alert(1))",
  ]);
  assert.doesNotMatch(output, /<script|<iframe|<img|<span style|onerror|onclick|javascript:/i);
});

test("keeps the desk's pre-Markdown section headings", async () => {
  const output = await html(["二、战况", "II. Combat Situation", "## Markdown heading"]);
  assert.match(output, /<h2>二、战况<\/h2>/);
  assert.match(output, /<h2>II\. Combat Situation<\/h2>/);
  assert.match(output, /<h2>Markdown heading<\/h2>/);
});

test("a highlight inside inline code is left as code", async () => {
  const output = await html(["`==not a highlight==`"]);
  assert.match(output, /<code>==not a highlight==<\/code>/);
  assert.doesNotMatch(output, /<mark/);
});
