import type { Metadata } from "next";
import Link from "next/link";
import { prisma } from "@/lib/db";
import { getSessionUser } from "@/lib/auth";
import { getLocale, formatDate, localePath, tr } from "@/lib/i18n";
import { parseScopes } from "@/lib/apiKeys";
import { siteUrl } from "@/lib/site";
import { JsonLd, breadcrumbJsonLd, canonical, clamp, localizedUrl, ogImage } from "@/lib/seo";
import McpKeyForm from "./McpKeyForm";
import CopyKeyButton from "@/app/_components/CopyKeyButton";
import { revokeMyMcpKey } from "./actions";
import { Icon } from "@/app/_components/Icon";

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
        select: { id: true, name: true, prefix: true, secret: true, scopes: true, rateLimit: true, createdAt: true, lastUsedAt: true, requestCount: true },
      })).filter((key) => parseScopes(key.scopes).includes("mcp:user"))
    : [];

  return (
    <main className="wrap mcp-page">
      <JsonLd data={breadcrumbJsonLd(locale, [{ name: tr(locale, "Home", "首页"), path: "/" }, { name: tr(locale, "MCP", "MCP"), path: "/mcp" }])} />

      <header className="mcp-hero">
        <div className="mcp-hero-copy">
          <div className="eyebrow">{tr(locale, "For AI clients", "给 AI 客户端")}</div>
          <h1>{tr(locale, "MCP access", "MCP 接入")}</h1>
          <p className="sub">
            {tr(locale,
              "Connect Claude, Cursor or any MCP-capable client to Tlines' published research and macro data. The connection is read-only, every answer carries its source and page URL, and it is available to every registered account.",
              "把 Claude、Cursor 或其他支持 MCP 的客户端接到 Tlines 的已发布研报与宏观数据。连接只读，每个结果都带来源与页面地址，所有注册账户均可使用。")}
          </p>
          <div className="mcp-facts" role="group" aria-label={tr(locale, "Connection properties", "连接特性")}>
            <span><Icon name="check" />{tr(locale, "Read-only", "只读")}</span>
            <span><Icon name="check" />{tr(locale, "Source-linked", "来源回链")}</span>
            <span><Icon name="check" />{tr(locale, "60 requests/min", "每密钥 60 次/分钟")}</span>
          </div>
        </div>

        <aside className="mcp-endpoint" aria-label={tr(locale, "Endpoint", "端点")}>
          <div className="mcp-endpoint-head">
            <span className="mcp-endpoint-label">{tr(locale, "Endpoint", "端点")}</span>
            <span className="mcp-method">POST</span>
          </div>
          <code className="mcp-endpoint-url">{base}/api/mcp/user</code>
          <div className="mcp-endpoint-auth">
            <span>{tr(locale, "Authentication", "鉴权请求头")}</span>
            <code>Authorization: Bearer tli_…</code>
          </div>
          <p>{tr(locale, "Read-only Streamable HTTP. Only reports the publication gate admits are visible.", "只读 Streamable HTTP。只返回通过公开闸门的研报。")}</p>
          <CopyKeyButton value={`${base}/api/mcp/user`} label={tr(locale, "Copy endpoint", "复制端点")} copiedLabel={tr(locale, "Copied", "已复制")} />
        </aside>
      </header>

      <section className="mcp-section" aria-labelledby="mcp-tools-title">
        <div className="mcp-section-head">
          <div>
            <span className="eyebrow">{tr(locale, "Tools", "工具")}</span>
            <h2 id="mcp-tools-title">{tr(locale, "What the client can read", "客户端可以读什么")}</h2>
          </div>
          <p>
            {tr(locale,
              "Only reports that passed the publication gate. Article bodies, translations and PDFs are not served — the MCP returns Tlines' own structured analysis and metadata, with a link back to the page.",
              "仅限通过公开闸门的研报。不提供原文正文、译文与 PDF——MCP 返回的是 Tlines 自己的结构化分析与元数据，并附回链。")}
          </p>
        </div>
        <ol className="mcp-tools">
          {TOOLS.map((tool, index) => (
            <li className="mcp-tool" key={tool.name}>
              <span className="mcp-tool-index" aria-hidden="true">{String(index + 1).padStart(2, "0")}</span>
              <code className="mcp-tool-name">{tool.name}</code>
              <p>{locale === "zh-CN" ? tool.zh : tool.en}</p>
            </li>
          ))}
        </ol>
      </section>

      <section className="mcp-section" aria-labelledby="mcp-access-title">
        {user ? (
          <>
            <div className="mcp-section-head">
              <div>
                <span className="eyebrow">{tr(locale, "Access", "访问")}</span>
                <h2 id="mcp-access-title">{tr(locale, "Your MCP keys", "你的 MCP 密钥")}</h2>
              </div>
              <p>{tr(locale, "The secret is shown in full here and at creation; revoke a key as soon as a client stops using it.", "密钥在此处和创建时完整显示；客户端停用后请及时吊销。")}</p>
            </div>
            {keys.length > 0 ? (
              <>
              <div className="tbl-wrap mcp-table" tabIndex={0} role="region" aria-label={tr(locale, "Your MCP keys, scrollable table", "你的 MCP 密钥，可滚动表格")}>
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
                          <td className="mono-cell">{key.secret ? (<span className="api-key-value"><code>{key.secret}</code><CopyKeyButton value={key.secret} label={tr(locale, "Copy", "复制")} copiedLabel={tr(locale, "Copied", "已复制")} /></span>) : <>{key.prefix}… <span className="chip gray">{tr(locale, "not recoverable — rotate", "不可恢复，请轮换")}</span></>}</td>
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
              <p className="mcp-table-hint">{tr(locale, "Swipe the table sideways to see usage and actions.", "左右滑动表格查看用量与操作。")}</p>
              </>
            ) : (
              <p className="mcp-empty">{tr(locale, "No MCP key yet. Create one below, then place it in your client's Authorization header.", "还没有 MCP 密钥。在下方创建一把，然后填入客户端的 Authorization 请求头。")}</p>
            )}
            <div className="mcp-key-create">
              <div>
                <h3>{keys.length > 0 ? tr(locale, "Create another key", "再创建一把密钥") : tr(locale, "Create your first key", "创建第一把密钥")}</h3>
                <p>{tr(locale, "Name it after the client so you can tell them apart later.", "按客户端命名，方便之后区分。")}</p>
              </div>
              <div className="mcp-key-form">
                <McpKeyForm
                  labels={{
                    name: tr(locale, "Key name", "密钥名称"),
                    placeholder: tr(locale, "e.g. Claude Desktop", "例如：Claude Desktop"),
                    submit: tr(locale, "Create MCP key", "创建 MCP 密钥"),
                    submitting: tr(locale, "Creating…", "创建中……"),
                    issued: tr(locale, "Key created", "密钥已创建"),
                    warning: tr(locale, "Saved — copy it again from the list below whenever needed.", "已保存，可随时在下方列表再次复制。"),
                    copy: tr(locale, "Copy", "复制"),
                    copied: tr(locale, "Copied", "已复制"),
                  }}
                />
              </div>
            </div>
          </>
        ) : (
          <div className="mcp-access">
            <div className="mcp-access-copy">
              <span className="eyebrow">{tr(locale, "Access", "访问")}</span>
              <h2 id="mcp-access-title">{tr(locale, "Registration required", "需要注册后使用")}</h2>
              <p>
                {tr(locale,
                  "Sign in to issue a personal MCP key. New accounts are created with the same email sign-in; the key is bound to your account and stops working if the account is suspended.",
                  "登录后即可签发个人 MCP 密钥。新账户通过同一邮箱登录流程创建；密钥绑定你的账户，账户停用后立即失效。")}
              </p>
              <Link className="minibtn p mcp-cta" href={`${localePath(locale, "/signin")}?next=${encodeURIComponent(localePath(locale, "/mcp"))}`}>
                {tr(locale, "Sign in / create an account", "登录 / 注册账户")} <Icon name="arrow-right" />
              </Link>
            </div>
            <ul className="mcp-access-list">
              <li><Icon name="check" />{tr(locale, "The key is bound to your account.", "密钥绑定你的账户。")}</li>
              <li><Icon name="check" />{tr(locale, "The account stops working when suspended.", "账户停用后密钥立即失效。")}</li>
              <li><Icon name="check" />{tr(locale, "Revoke a key at any time.", "可随时吊销密钥。")}</li>
            </ul>
          </div>
        )}
      </section>

      <section className="mcp-section" aria-labelledby="mcp-connect-title">
        <div className="mcp-section-head">
          <div>
            <span className="eyebrow">{tr(locale, "Connect", "接入")}</span>
            <h2 id="mcp-connect-title">{tr(locale, "Connecting a client", "接入客户端")}</h2>
          </div>
          <p>{tr(locale, "Three steps from a key to a cited answer.", "从密钥到可引用的回答，只需三步。")}</p>
        </div>
        <ol className="mcp-steps">
          <li className="mcp-step">
            <span className="mcp-step-num" aria-hidden="true">1</span>
            <h3>{tr(locale, "Create a key", "创建密钥")}</h3>
            <p>{tr(locale, "Create an MCP key above and copy the tli_… secret.", "在上方创建 MCP 密钥并复制 tli_… 密钥。")}</p>
          </li>
          <li className="mcp-step">
            <span className="mcp-step-num" aria-hidden="true">2</span>
            <h3>{tr(locale, "Add the remote server", "添加远程服务器")}</h3>
            <p>{tr(locale, "Add a remote MCP server in your client with the endpoint and the Authorization header shown above.", "在客户端中添加远程 MCP Server，填入上方端点与 Authorization 请求头。")}</p>
          </li>
          <li className="mcp-step">
            <span className="mcp-step-num" aria-hidden="true">3</span>
            <h3>{tr(locale, "Search and cite", "检索并引用")}</h3>
            <p>{tr(locale, "The client lists the five tools; ask it to search or read a report and cite the page URL it returns.", "客户端会列出五个工具；让它搜索或读取研报，并引用返回的页面地址。")}</p>
          </li>
        </ol>
      </section>
    </main>
  );
}
