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
 * revokes every credential. This page is what was missing around it: what the two
 * servers are, which scopes they require, who is actually calling them, and which keys
 * currently carry an MCP scope.
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
    purposeEn: "Read-only queries for agents acting for an entitled account: report search and detail, macro indicators and calendar, institution list. Every read asks the same publication gate the site asks — no article bodies or PDFs.",
    purposeZh: "面向已开通账户的 AI Agent 只读查询:研报搜索与详情、宏观指标与经济日历、发布机构列表。每条读取都过站点同一道公开闸门,不返回原文与 PDF。",
    tools: ["search_research", "get_research", "get_macro_indicator", "get_macro_calendar", "list_institutions"],
  },
  {
    endpoint: "/api/mcp/publisher",
    scope: "publisher:draft",
    en: "Publisher MCP",
    zh: "MCP 发布端",
    purposeEn: "Draft creation and submission for reviewers and admins. There is no publish, withdraw or delete tool — a human reviewer is the only way onward, in this console.",
    purposeZh: "面向审核员与管理员的草稿创建与送审。没有发布、撤回或删除工具——唯一出口是运营后台的人工审核队列。",
    tools: ["create_publication_draft", "update_publication_draft", "validate_publication_draft", "submit_publication_for_review", "list_publication_drafts"],
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
              "Two Model Context Protocol servers for AI agents and LLM applications. Stateless Streamable HTTP; the same API keys as everything else, with the scopes below.",
              "面向 AI Agent 与大模型应用的两个 MCP Server。无状态 Streamable HTTP;复用现有 API 密钥体系,凭下方 scope 区分两端。",
            )}
          </p>
        </div>
        <div className="tag-row">
          <span className="chip bull">{SERVERS.length} {tr(locale, "endpoints live", "个端点在线")}</span>
          <span className="chip acc">{activeKeys} {tr(locale, "MCP keys active", "把 MCP 密钥启用中")}</span>
        </div>
      </header>

      <div className="admin-columns">
        {SERVERS.map((server, index) => {
          const usage = usageByEndpoint.get(server.endpoint) ?? { calls: 0, errors: 0 };
          return (
            <section className="blk" key={server.endpoint}>
              <div className="section-t">
                <span>{tr(locale, server.en, server.zh)}</span>
                <span className="chip acc">{server.scope}</span>
              </div>
              <div className="apikey-docs">
                <code>POST {base}{server.endpoint}</code>
                <p>{tr(locale, server.purposeEn, server.purposeZh)}</p>
                <ul>
                  {server.tools.map((tool) => <li key={tool}><code>{tool}</code></li>)}
                </ul>
                <p className="apikey-note">
                  {tr(locale, "Last 30 days:", "近 30 天:")} {compact(usage.calls)} {tr(locale, "calls", "次调用")}
                  {usage.errors > 0 ? ` · ${usage.errors} ${tr(locale, "≥400 responses", "次 4xx/5xx")}` : ""}
                  {index === 0 ? ` · ${tr(locale, "entitlement: professional / founding / reviewer / admin", "开通范围:professional / founding / reviewer / admin")}` : ` · ${tr(locale, "publisher keys re-check the owner's role every call", "每次调用复查密钥持有者角色")}`}
                </p>
              </div>
            </section>
          );
        })}
      </div>

      <section className="blk">
        <div className="section-t">{tr(locale, "Connecting a client", "接入客户端")}</div>
        <ol className="apikey-docs">
          <li>
            {tr(locale, "Issue a key on the ", "在「")}
            <Link href={localePath(locale, "/admin/api")}>{tr(locale, "API & keys", "API 与密钥")}</Link>
            {tr(locale, " page and tick the MCP scope it is for. The two scopes must be issued on separate keys — the form refuses them together.", "」页签发密钥,勾选对应 MCP scope。两个 scope 必须分开签发,同勾会被拒绝。")}
          </li>
          <li>
            {tr(locale, "In the AI client (MCP host), add a remote MCP server: the endpoint URL above, then header ", "在 AI 客户端(MCP Host)添加远程 MCP Server:填上方端点 URL,请求头 ")}
            <code>Authorization: Bearer tli_…</code>
          </li>
          <li>
            {tr(locale, "The client's tools/list lists the tools above. The secret is shown once at creation; a lost key is rotated, never recovered.", "连接后 tools/list 会列出上方工具。密钥仅在签发时显示一次,遗失只能轮换。")}
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
