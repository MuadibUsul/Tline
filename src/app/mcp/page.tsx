import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getLocale, formatDate, localePath, tr } from "@/lib/i18n";
import { parseScopes } from "@/lib/apiKeys";
import { siteUrl } from "@/lib/site";
import { JsonLd, breadcrumbJsonLd, canonical, clamp, localizedUrl, ogImage } from "@/lib/seo";
import McpKeyForm from "./McpKeyForm";
import { revokeMyMcpKey } from "./actions";

export const dynamic = "force-dynamic";

const TOOLS = [
  { name: "search_research", en: "Search published reports and asset views", zh: "搜索已发布研报与资产观点" },
  { name: "get_research", en: "Read one report's derived analysis", zh: "读取单篇研报的结构化分析" },
  { name: "get_macro_indicator", en: "Read a macro series", zh: "读取宏观指标序列" },
  { name: "get_macro_calendar", en: "Read the economic calendar", zh: "读取经济日历" },
  { name: "list_institutions", en: "List publishing institutions", zh: "列出发布机构" },
];

export async function generateMetadata(): Promise<Metadata> {
  const locale = await getLocale();
  const title = tr(locale, "MCP for AI clients", "MCP 接入");
  const description = clamp(tr(
    locale,
    "Connect an AI client to Tlines' published research and macro data over MCP. Read-only, source-linked, and available to every registered account.",
    "让 AI 客户端通过 MCP 读取 Tlines 已发布的研报与宏观数据。只读、可溯源，所有注册账户均可使用。",
  ), 158);
  return {
    ...canonical("/mcp", locale),
    title: { absolute: `${title} · Tlines` },
    description,
    openGraph: { type: "website", title, description, url: localizedUrl("/mcp", locale), locale, images: [{ url: ogImage("MCP", title, tr(locale, "Research, readable by your AI client", "让 AI 客户端读懂机构研报")), width: 1200, height: 630 }] },
    twitter: { card: "summary_large_image", title, description },
  };
}

export default async function McpPage() {
  const locale = await getLocale();
  const user = await getSessionUser();
  const base = siteUrl();
  const keys = user
    ? (await prisma.apiKey.findMany({
        where: { createdById: user.id, revokedAt: null },
        orderBy: { createdAt: "desc" },
        select: { id: true, name: true, prefix: true, scopes: true, rateLimit: true, createdAt: true, lastUsedAt: true, requestCount: true },
      })).filter((key) => parseScopes(key.scopes).includes("mcp:user"))
    : [];

  return (
    <main className="wrap" style={{ maxWidth: 920 }}>
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Home", "首页"), path: "/" }, { name: tr(locale, "MCP", "MCP"), path: "/mcp" }])} />
      <div className="page-head">
        <div className="eyebrow">{tr(locale, "For AI clients", "给 AI 客户端")}</div>
        <h1>{tr(locale, "MCP access", "MCP 接入")}</h1>
        <p className="sub" style={{ maxWidth: "72ch" }}>
          {tr(locale,
            "Connect Claude, Cursor or any MCP-capable client to Tlines' published research and macro data. The connection is read-only, every answer carries its source and page URL, and it is available to every registered account.",
            "把 Claude、Cursor 或其他支持 MCP 的客户端接到 Tlines 的已发布研报与宏观数据。连接只读，每个结果都带来源与页面地址，所有注册账户均可使用。")}
        </p>
      </div>

      <section className="blk">
        <div className="section-t">{tr(locale, "What the client can read", "客户端可以读什么")}</div>
        <p className="sub" style={{ color: "var(--muted)", marginTop: 0 }}>
          {tr(locale,
            "Only reports that passed the publication gate. Article bodies, translations and PDFs are not served — the MCP returns Tlines' own structured analysis and metadata, with a link back to the page.",
            "仅限通过公开闸门的研报。不提供原文正文、译文与 PDF——MCP 返回的是 Tlines 自己的结构化分析与元数据，并附回链。")}
        </p>
        <div className="tag-row">
          {TOOLS.map((tool) => (
            <span className="chip gray" key={tool.name} title={locale === "zh-CN" ? tool.zh : tool.en}>{tool.name}</span>
          ))}
        </div>
        <div className="apikey-docs" style={{ marginTop: 16 }}>
          <p>{tr(locale, "Endpoint", "端点")}</p>
          <code>POST {base}/api/mcp/user</code>
          <p>{tr(locale, "Authentication header", "鉴权请求头")}</p>
          <code>Authorization: Bearer tli_…</code>
          <p className="apikey-note">
            {tr(locale, "Read-only Streamable HTTP. 60 requests per minute per key. Only reports the publication gate admits are visible.", "只读 Streamable HTTP。每个密钥每分钟 60 次请求。只返回通过公开闸门的研报。")}
          </p>
        </div>
      </section>

      {user ? (
        <section className="blk">
          <div className="section-t">
            <span>{tr(locale, "Your MCP keys", "你的 MCP 密钥")}</span>
            <span className="chip gray">{keys.length}</span>
          </div>
          {keys.length > 0 && (
            <div className="tbl-wrap">
              <table className="admin-table">
                <thead>
                  <tr>
                    <th>{tr(locale, "Name", "名称")}</th>
                    <th>{tr(locale, "Key", "密钥")}</th>
                    <th>{tr(locale, "Usage", "用量")}</th>
                    <th>{tr(locale, "Action", "操作")}</th>
                  </tr>
                </thead>
                <tbody>
                  {keys.map((key) => {
                    const scopes = parseScopes(key.scopes);
                    const revocable = scopes.length === 1 && scopes[0] === "mcp:user";
                    return (
                      <tr key={key.id}>
                        <td className="inst">
                          <b>{key.name}</b>
                          <small>{tr(locale, "created", "创建于")} {formatDate(key.createdAt, locale)}</small>
                        </td>
                        <td className="mono-cell">{key.prefix}…</td>
                        <td className="mono-cell">
                          {key.requestCount.toLocaleString(locale)}
                          <small>{key.rateLimit}/min · {key.lastUsedAt ? `${tr(locale, "last used", "最近调用")} ${formatDate(key.lastUsedAt, locale)}` : tr(locale, "never used", "尚未使用")}</small>
                        </td>
                        <td>
                          {revocable ? (
                            <form action={revokeMyMcpKey}>
                              <input type="hidden" name="id" value={key.id} />
                              <button className="minibtn danger" type="submit">{tr(locale, "Revoke", "吊销")}</button>
                            </form>
                          ) : <span className="chip gray">{tr(locale, "managed by an operator", "由运营签发")}</span>}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
          <div style={{ marginTop: 18 }}>
            <McpKeyForm
              labels={{
                name: tr(locale, "Key name", "密钥名称"),
                placeholder: tr(locale, "e.g. Claude Desktop", "例如：Claude Desktop"),
                submit: tr(locale, "Create MCP key", "创建 MCP 密钥"),
                submitting: tr(locale, "Creating…", "创建中……"),
                issued: tr(locale, "Key created", "密钥已创建"),
                warning: tr(locale, "Copy it now — the secret is shown only once.", "请立即复制——密钥只显示一次。"),
                copy: tr(locale, "Copy", "复制"),
                copied: tr(locale, "Copied", "已复制"),
              }}
            />
          </div>
        </section>
      ) : (
        <section className="blk">
          <div className="section-t">{tr(locale, "Registration required", "需要注册后使用")}</div>
          <p className="sub" style={{ color: "var(--muted)", marginTop: 0 }}>
            {tr(locale,
              "Sign in to issue a personal MCP key. New accounts are created with the same email sign-in; the key is bound to your account and stops working if the account is suspended.",
              "登录后即可签发个人 MCP 密钥。新账户通过同一邮箱登录流程创建；密钥绑定你的账户，账户停用后立即失效。")}
          </p>
          <Link
            className="minibtn p"
            href={`${localePath(locale, "/signin")}?next=${encodeURIComponent(localePath(locale, "/mcp"))}`}
          >
            {tr(locale, "Sign in / create an account", "登录 / 注册账户")} →
          </Link>
        </section>
      )}

      <section className="blk">
        <div className="section-t">{tr(locale, "Connecting a client", "接入客户端")}</div>
        <ol className="apikey-docs">
          <li>{tr(locale, "Create an MCP key above and copy the tli_… secret.", "在上方创建 MCP 密钥并复制 tli_… 密钥。")}</li>
          <li>{tr(locale, "Add a remote MCP server in your client with the endpoint and the Authorization header shown above.", "在客户端中添加远程 MCP Server，填入上方端点与 Authorization 请求头。")}</li>
          <li>{tr(locale, "The client lists the five tools; ask it to search or read a report and cite the page URL it returns.", "客户端会列出五个工具；让它搜索或读取研报，并引用返回的页面地址。")}</li>
        </ol>
      </section>
    </main>
  );
}
