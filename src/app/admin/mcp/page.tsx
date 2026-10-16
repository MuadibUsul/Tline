import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAdminLocale, localePath, tr } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { parseScopes, type ApiScope } from "@/lib/apiKeys";
import { usagePerKey } from "@/lib/apiUsage";
import { shiftDay } from "@/lib/analytics/identity";
import { siteUrl } from "@/lib/site";
import { age, compact, when } from "../_components/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "MCP 服务" };

/**
 * The console's view of the two MCP servers.
 *
 * Key issuance deliberately stays on the API page — one place issues, rotates and
 * revokes every credential. This page answers what that page cannot: what the two
 * servers are in plain language, which scope each requires, who is calling them, and
 * which keys currently carry an MCP scope.
 */

const MCP_SCOPE_SET = new Set<ApiScope>(["mcp:user", "publisher:draft"]);

function hasMcpScope(raw: string) {
  return parseScopes(raw).some((scope) => MCP_SCOPE_SET.has(scope));
}

/** Mirrors the registered tool sets; the protocol test asserts the servers expose exactly these. */
const SERVERS = [
  {
    endpoint: "/api/mcp/user",
    scope: "mcp:user",
    en: "User MCP",
    zh: "MCP 用户端",
    purposeEn: "A read-only connection for AI clients: search and read published reports, macro indicators and the economic calendar, list institutions. Answers match the website exactly — no article bodies or PDFs.",
    purposeZh: "给 AI 客户端用的只读连接:搜索与阅读已发布研报、查询宏观指标与经济日历、列出机构。返回内容与网站一致,不含原文与 PDF。",
    audienceEn: "entitlement: professional / founding / reviewer / admin",
    audienceZh: "开通范围:professional / founding / reviewer / admin",
    tools: ["search_research", "get_research", "get_macro_indicator", "get_macro_calendar", "list_institutions"],
  },
  {
    endpoint: "/api/mcp/publisher",
    scope: "publisher:draft / publisher:publish",
    en: "Publisher MCP",
    zh: "MCP 发布端",
    purposeEn: "The drafting-and-publishing channel for AI clients: create, revise and validate drafts, submit them for review — and, when the key also carries publisher:publish, publish a draft as a public report. Publishing is judged by the same gate as every crawled report (the reply carries the verdict), and taking anything down stays an operations action, never an MCP one.",
    purposeZh: "给 AI 客户端的投稿与发布通道:创建、修改、校验草稿并送审;密钥带 publisher:publish 时还可直接发布。发布与抓取的文章走同一道公开闸门(结果随响应返回可核验);下架始终是运营操作,MCP 不提供。",
    audienceEn: "requires a reviewer / admin key; publishing additionally requires the publisher:publish scope, and the owner's role is re-checked on every call",
    audienceZh: "需 reviewer / admin 密钥;直接发布另需 publisher:publish scope;每次调用复查持有人角色",
    tools: ["create_publication_draft", "update_publication_draft", "validate_publication_draft", "submit_publication_for_review", "publish_publication_draft", "list_publication_drafts"],
  },
] as const;

export default async function McpPage() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.api")) notFound();
  const locale = await getAdminLocale();

  const [keys, usageRows, perKey] = await Promise.all([
    prisma.apiKey.findMany({
      orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
      include: { createdBy: { select: { email: true } } },
    }),
    // The two MCP endpoints, 30 days. Queried directly rather than through usageReport:
    // its by-endpoint breakdown is the top 12 globally, and an early MCP install would
    // fall out of that list exactly while an operator is watching it.
    prisma.apiUsageDaily.findMany({
      where: { endpoint: { in: SERVERS.map((server) => server.endpoint) }, day: { gte: shiftDay(new Date(), -29) } },
      select: { endpoint: true, status: true, count: true },
    }),
    usagePerKey(7),
  ]);

  const usageByEndpoint = new Map<string, { calls: number; errors: number }>();
  for (const row of usageRows) {
    const bucket = usageByEndpoint.get(row.endpoint) ?? { calls: 0, errors: 0 };
    bucket.calls += row.count;
    if (row.status >= 400) bucket.errors += row.count;
    usageByEndpoint.set(row.endpoint, bucket);
  }
  const mcpKeys = keys.filter((key) => hasMcpScope(key.scopes));
  const activeKeys = mcpKeys.filter((key) => !key.revokedAt).length;
  const base = siteUrl();

  return (
    <>
      <header className="page-head admin-head">
        <div>
          <h1>{tr(locale, "MCP servers", "MCP 服务")}</h1>
          <p className="sub">
            {tr(
              locale,
              "Two connections for AI clients (Claude, ChatGPT agents, home-grown assistants). Managing them is the same as any API key: issue a key with the matching scope below.",
              "两个供 AI 客户端(Claude、ChatGPT 里的 Agent、自建助手等)连接的接口。管理方式与普通 API 密钥相同:签发一把带对应权限(scope)的密钥即可。",
            )}
          </p>
        </div>
        <div className="tag-row">
          <span className="chip bull">{SERVERS.length} {tr(locale, "endpoints live", "个端点已上线")}</span>
          <span className="chip acc">{activeKeys} {tr(locale, "MCP keys active", "个 MCP 密钥启用中")}</span>
        </div>
      </header>

      {SERVERS.map((server) => {
        const usage = usageByEndpoint.get(server.endpoint) ?? { calls: 0, errors: 0 };
        return (
          <section className="blk" key={server.endpoint}>
            <div className="section-t">
              <span>{tr(locale, server.en, server.zh)}</span>
              <span className="chip acc">{server.scope}</span>
            </div>
            <div className="apikey-docs">
              <p>{tr(locale, server.purposeEn, server.purposeZh)}</p>
              <code>POST {base}{server.endpoint}</code>
              <p style={{ margin: 0 }}>{tr(locale, "Tools this server exposes:", "此端点提供的工具:")}</p>
              <div className="tags">
                {server.tools.map((tool) => <span key={tool} className="chip gray">{tool}</span>)}
              </div>
              <p className="apikey-note">
                {tr(locale, "Last 30 days:", "近 30 天:")} {compact(usage.calls)} {tr(locale, "calls", "次调用")}
                {usage.errors > 0 ? tr(locale, ` (${usage.errors} refused: no or wrong key)`, `(其中 ${usage.errors} 次鉴权被拒)`) : ""}
                {" · "}{tr(locale, server.audienceEn, server.audienceZh)}
              </p>
            </div>
          </section>
        );
      })}

      <section className="blk">
        <div className="section-t">{tr(locale, "Connecting a client", "接入客户端")}</div>
        <ol className="apikey-docs">
          <li>
            {tr(locale, "Issue a key on the ", "在「")}
            <Link href={localePath(locale, "/admin/api")}>{tr(locale, "API & keys", "API 与密钥")}</Link>
            {tr(locale, " page and tick the scope of the server it is for. mcp:user must be issued on a key of its own; the two publisher scopes may share one key.", "」页签发密钥,勾选对应端点的 scope。mcp:user 必须单独签发;publisher:draft 与 publisher:publish 可签在同一把密钥上。")}
          </li>
          <li>
            {tr(locale, "In the AI client, add a remote MCP server: the endpoint URL above, with header ", "在 AI 客户端里添加远程 MCP Server:填上方端点 URL,请求头 ")}
            <code>Authorization: Bearer tli_…</code>
          </li>
          <li>
            {tr(locale, "The client will list the tools above. The secret is shown once at creation; a lost key is rotated, never recovered.", "连接后客户端会列出上方工具。密钥仅在签发时显示一次,遗失只能轮换。")}
          </li>
        </ol>
      </section>

      <section className="blk">
        <div className="section-t">
          <span>{tr(locale, "MCP keys", "MCP 密钥")}</span>
          <span className="chip gray">{mcpKeys.length}</span>
        </div>
        <div className="tbl-wrap">
          <table className="admin-table">
            <thead>
              <tr>
                <th>{tr(locale, "Name", "名称")}</th>
                <th>{tr(locale, "Key", "密钥")}</th>
                <th>{tr(locale, "Scopes", "权限")}</th>
                <th>{tr(locale, "Usage", "用量")}</th>
                <th>{tr(locale, "Action", "操作")}</th>
              </tr>
            </thead>
            <tbody>
              {mcpKeys.length === 0 && (
                <tr><td colSpan={5}><div className="empty-state">
                  {tr(locale, "No MCP key has been issued yet. ", "尚未签发 MCP 密钥。")}
                  <Link href={localePath(locale, "/admin/api")}>{tr(locale, "Issue one on the API & keys page", "去 API 与密钥页签发")} →</Link>
                </div></td></tr>
              )}
              {mcpKeys.map((key) => {
                const sevenDay = perKey(key.id).reduce((sum, point) => sum + point.primary, 0);
                return (
                  <tr key={key.id}>
                    <td className="inst">
                      <b>{key.name}</b>
                      <small>{tr(locale, "created", "创建于")} {when(key.createdAt, locale)}{key.createdBy?.email ? ` · ${key.createdBy.email}` : ""}</small>
                    </td>
                    <td className="mono-cell">
                      {key.prefix}…
                      <small>
                        {key.revokedAt
                          ? <span className="chip bear">{tr(locale, "revoked", "已吊销")} {when(key.revokedAt, locale)}</span>
                          : <span className="chip bull">{tr(locale, "active", "启用中")}</span>}
                      </small>
                    </td>
                    <td>
                      <div className="tags">
                        {parseScopes(key.scopes).map((scope) => <span key={scope} className={`chip ${MCP_SCOPE_SET.has(scope) ? "acc" : "gray"}`}>{scope}</span>)}
                      </div>
                    </td>
                    <td className="mono-cell">
                      {sevenDay.toLocaleString(locale)}
                      <small>{tr(locale, "7d", "7天")} · {key.rateLimit}/min · {tr(locale, "last used", "最近调用")} {age(key.lastUsedAt, locale)}</small>
                    </td>
                    <td>
                      <Link className="minibtn" href={localePath(locale, "/admin/api")}>{tr(locale, "Manage", "管理")} →</Link>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </section>
    </>
  );
}
