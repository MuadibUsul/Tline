import { createElement, type ComponentProps, type ReactNode } from "react";
import { Fragment, jsx, jsxs } from "react/jsx-runtime";
import { unified } from "unified";
import remarkParse from "remark-parse";
import remarkGfm from "remark-gfm";
import remarkRehype from "remark-rehype";
import rehypeSanitize from "rehype-sanitize";
import rehypeReact from "rehype-react";
import { SKIP, visit } from "unist-util-visit";
import type { Handlers, State } from "mdast-util-to-hast";
import type { Options as RehypeReactOptions } from "hast-util-to-jsx-runtime";
import type { Schema } from "hast-util-sanitize";
import type { Locale } from "./i18n";
import { newsParagraphRole } from "./news";

/**
 * The newsroom's Markdown subset.
 *
 * Dou writes a small, semantic syntax — `==highlight==`, GFM callouts, bold, tables,
 * task lists, a `:badge[...]` pill — and nothing else. Raw HTML is not a feature of the
 * format: no `rehype-raw` stage exists, and the sanitizer below is the second lock. All
 * colour comes from site CSS; `style` and `on*` attributes are not in the schema.
 *
 * The body is rendered block by block rather than as one document because the news permalink
 * inserts images between blocks by their stored position. `splitNewsMarkdownBlocks` keeps
 * fenced code intact while giving that page the same block boundaries the old paragraph
 * renderer used.
 */

type MarkdownBlock = string;

interface CustomNode {
  type: string;
  value?: string;
  children?: CustomNode[];
  [key: string]: unknown;
}

interface CalloutNode extends CustomNode {
  type: "callout";
  kind: "note" | "warning";
  title: string;
  children: CustomNode[];
}

function remarkHighlight() {
  return (tree: CustomNode) => {
    visit(tree as never, "text", (node: CustomNode, index, parent) => {
      if (!parent || index === undefined || !node.value?.includes("==")) return;
      const parts: CustomNode[] = [];
      const pattern = /==([^=\n]+)==/g;
      let last = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(node.value))) {
        if (match.index > last) parts.push({ type: "text", value: node.value.slice(last, match.index) });
        parts.push({ type: "highlight", children: [{ type: "text", value: match[1] }] });
        last = match.index + match[0].length;
      }
      if (!parts.length) return;
      if (last < node.value.length) parts.push({ type: "text", value: node.value.slice(last) });
      (parent as CustomNode).children!.splice(index, 1, ...parts);
      return [SKIP, index + parts.length];
    });
  };
}

function remarkBadge() {
  return (tree: CustomNode) => {
    visit(tree as never, "text", (node: CustomNode, index, parent) => {
      if (!parent || index === undefined || !node.value?.includes(":badge[")) return;
      const parts: CustomNode[] = [];
      const pattern = /:badge\[([^\]\n]{1,80})\]/g;
      let last = 0;
      let match: RegExpExecArray | null;
      while ((match = pattern.exec(node.value))) {
        if (match.index > last) parts.push({ type: "text", value: node.value.slice(last, match.index) });
        parts.push({ type: "badge", children: [{ type: "text", value: match[1] }] });
        last = match.index + match[0].length;
      }
      if (!parts.length) return;
      if (last < node.value.length) parts.push({ type: "text", value: node.value.slice(last) });
      (parent as CustomNode).children!.splice(index, 1, ...parts);
      return [SKIP, index + parts.length];
    });
  };
}

function remarkCallout(locale: Locale) {
  const fallback = locale === "zh-CN" ? { note: "说明", warning: "注意" } : { note: "Note", warning: "Warning" };
  return (tree: CustomNode) => {
    visit(tree as never, "blockquote", (node: CustomNode, index, parent) => {
      if (!parent || index === undefined) return;
      const first = node.children?.[0];
      if (!first || first.type !== "paragraph") return;
      const firstChild = first.children?.[0];
      if (!firstChild || firstChild.type !== "text" || !firstChild.value) return;
      const marker = /^\[!(note|warning)\][ \t]*(.*)(?:\n|$)/i.exec(firstChild.value);
      if (!marker) return;
      const kind = marker[1].toLowerCase() as "note" | "warning";
      const title = marker[2].trim();
      const rest = firstChild.value.slice(marker[0].length);
      if (rest.trim()) firstChild.value = rest;
      else first.children!.shift();

      const children = first.children?.length ? node.children! : node.children!.slice(1);
      const callout: CalloutNode = {
        type: "callout",
        kind,
        title: title || fallback[kind],
        children,
      };
      (parent as CustomNode).children!.splice(index, 1, callout);
      return [SKIP, index + 1];
    });
  };
}

/**
 * Everything a caller may put in a body. There is deliberately no `img`, `iframe`, `script`,
 * `object`, `embed` or `style` here, and no `style`/`on*` attribute in `attributes`.
 */
const schema: Schema = {
  tagNames: [
    "p", "br", "strong", "b", "em", "i", "del", "s", "code", "pre", "blockquote",
    "ul", "ol", "li", "a", "table", "thead", "tbody", "tr", "th", "td", "hr",
    "h1", "h2", "h3", "h4", "h5", "h6", "mark", "aside", "div", "span", "input",
  ],
  attributes: {
    a: ["href", "title"],
    code: [["className", /^language-/]],
    th: ["align"],
    td: ["align"],
    li: [["className", "task-list-item"]],
    ul: [["className", "contains-task-list"]],
    ol: [["className", "contains-task-list"]],
    input: [["type", "checkbox"], ["disabled", true], ["checked", true]],
    mark: [["className", "hl"]],
    aside: [["className", "news-callout", "note", "warning"]],
    div: [["className", "news-callout-title"]],
    span: [["className", "news-badge"]],
  },
  protocols: {
    href: ["http", "https", "mailto"],
  },
  required: {
    input: { disabled: true, type: "checkbox" },
  },
};

const handlers = {
  highlight(state: State, node: CustomNode) {
    return { type: "element", tagName: "mark", properties: { className: ["hl"] }, children: state.all(node as never) } as unknown as CustomNode;
  },
  badge(state: State, node: CustomNode) {
    return { type: "element", tagName: "span", properties: { className: ["news-badge"] }, children: state.all(node as never) } as unknown as CustomNode;
  },
  callout(state: State, node: CalloutNode) {
    const title = {
      type: "element" as const,
      tagName: "div",
      properties: { className: ["news-callout-title"] },
      children: [{ type: "text" as const, value: node.title }],
    };
    return {
      type: "element" as const,
      tagName: "aside",
      properties: { className: ["news-callout", node.kind] },
      children: [title, ...state.all(node as never)],
    } as unknown as CustomNode;
  },
} as unknown as Handlers;

function processorFor(locale: Locale) {
  return unified()
    .use(remarkParse)
    .use(remarkGfm)
    .use(remarkHighlight)
    .use(remarkBadge)
    .use(remarkCallout, locale)
    .use(remarkRehype, { allowDangerousHtml: false, handlers })
    .use(rehypeSanitize, schema)
    .use(rehypeReact, {
      Fragment,
      jsx,
      jsxs,
      elementAttributeNameCase: "react",
      components: {
        // A publisher table is wide; the wrapper scrolls instead of widening the page.
        table: ({ node: _node, ...props }: ComponentProps<"table"> & { node?: unknown }) =>
          createElement("div", { className: "news-table-wrap" }, createElement("table", props)),
      },
    } as unknown as RehypeReactOptions);
}

const processors = new Map<Locale, ReturnType<typeof processorFor>>();

/**
 * The desk's own heading convention predates Markdown: a short "二、战况" or
 * "II. Combat Situation" line is a section, not a paragraph. Keep that rule by turning the
 * line into an h2 before Markdown sees it. A block that already starts with `##` is left
 * alone.
 */
function promoteLegacyHeading(block: string): string {
  const value = block.trim();
  if (value.includes("\n") || /^#{1,6}\s/.test(value)) return block;
  return newsParagraphRole(value) === "heading" ? `## ${value}` : block;
}

/** Render one or more Markdown blocks to React nodes, preserving block boundaries. */
export async function renderNewsMarkdownBlocks(blocks: MarkdownBlock[], locale: Locale): Promise<ReactNode[]> {
  const processor = processors.get(locale) ?? processorFor(locale);
  processors.set(locale, processor);
  const rendered: ReactNode[] = [];
  for (const block of blocks) {
    try {
      const file = await processor.process(promoteLegacyHeading(block));
      if (file.result !== undefined && file.result !== null) rendered.push(file.result as ReactNode);
    } catch {
      // Markdown is untrusted input. If a block cannot be parsed, show its text escaped
      // rather than failing the whole news page.
      rendered.push(createElement("p", null, block));
    }
  }
  return rendered;
}
