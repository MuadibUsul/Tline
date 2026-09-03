import Link from "next/link";
import type { Metadata } from "next";
import { noIndex } from "@/lib/seo";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLocale, tr } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { API_SCOPES, parseScopes } from "@/lib/apiKeys";
import { revokeApiKey } from "../actions";
import CreateKeyForm from "./CreateKeyForm";

export const dynamic = "force-dynamic";

// Behind a sign-in: robots.txt asks a crawler not to fetch this, which does not keep
// it out of an index if something links to it. This does.
export const metadata: Metadata = { title: "API keys", ...noIndex };


function when(value: Date | null, locale: string) {
  if (!value) return "—";
  return new Intl.DateTimeFormat(locale === "zh-CN" ? "zh-CN" : "en-GB", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: "UTC",
  }).format(value);
}

export default async function ApiKeysPage() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.review")) notFound();
  const locale = await getLocale();

  const keys = await prisma.apiKey.findMany({
    orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
    include: { createdBy: { select: { email: true } } },
  });
  const active = keys.filter((key) => !key.revokedAt).length;

  return (
    <main className="wrap admin-page">
      <header className="page-head admin-head">
        <div>
          <div className="eyebrow">Operations Console</div>
          <h1>{tr(locale, "API keys", "API 密钥")}</h1>
          <p className="sub">
            {tr(
              locale,
              "Keys for machine consumers of the public API. Only a digest is stored, so a key can be shown once and never again.",
              "供第三方系统调用公开 API 的密钥。系统只保存摘要,因此密钥仅在创建时显示一次,之后无法找回。",
            )}
          </p>
        </div>
        <div className="tag-row">
          <span className="chip acc">{active} {tr(locale, "active", "启用中")}</span>
          <Link className="minibtn" href="/admin">{tr(locale, "← Operations", "← 运营后台")}</Link>
        </div>
      </header>

      <div className="admin-columns">
        <section className="blk">
          <div className="section-t">
            <span>{tr(locale, "Issued keys", "已签发密钥")}</span>
            <span className="chip gray">{keys.length}</span>
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
                {keys.length === 0 && (
                  <tr><td colSpan={5}><div className="empty-state">{tr(locale, "No keys have been issued yet.", "尚未签发任何密钥。")}</div></td></tr>
                )}
                {keys.map((key) => (
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
                        {parseScopes(key.scopes).map((scope) => <span key={scope} className="chip gray">{scope}</span>)}
                      </div>
                    </td>
                    <td className="mono-cell">
                      {key.requestCount.toLocaleString()}
                      <small>{key.rateLimit}/min · {tr(locale, "last used", "最近调用")} {when(key.lastUsedAt, locale)}</small>
                    </td>
                    <td>
                      <div className="admin-actions">
                        {!key.revokedAt && (
                          <form action={revokeApiKey}>
                            <input type="hidden" name="id" value={key.id} />
                            <button className="minibtn" type="submit">{tr(locale, "Revoke", "吊销")}</button>
                          </form>
                        )}
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>

        <aside>
          <section className="blk">
            <div className="section-t">{tr(locale, "Issue a key", "签发新密钥")}</div>
            <CreateKeyForm
              scopes={API_SCOPES}
              labels={{
                name: tr(locale, "Issued to", "签发给"),
                namePlaceholder: tr(locale, "e.g. Partner feed", "例如:合作方数据接入"),
                scopes: tr(locale, "Scopes", "权限范围"),
                rateLimit: tr(locale, "Requests per minute", "每分钟请求上限"),
                submit: tr(locale, "Create key", "创建密钥"),
                submitting: tr(locale, "Creating…", "创建中……"),
                issued: tr(locale, "Key created", "密钥已创建"),
                warning: tr(
                  locale,
                  "Copy it now — this is the only time it is shown.",
                  "请立即复制,离开本页后将无法再次查看。",
                ),
                copy: tr(locale, "Copy", "复制"),
                copied: tr(locale, "Copied", "已复制"),
              }}
            />
          </section>

          <section className="blk">
            <div className="section-t">{tr(locale, "Endpoints", "接口")}</div>
            <div className="apikey-docs">
              <p>{tr(locale, "Authenticate with a bearer token:", "使用 Bearer 令牌鉴权:")}</p>
              <code>Authorization: Bearer tli_…</code>
              <ul>
                <li><code>GET /api/v1/research</code> — <span>{tr(locale, "newest first, cursor paged", "按时间倒序,游标翻页")}</span></li>
                <li><code>GET /api/v1/research/&#123;id&#125;</code> — <span>{tr(locale, "one report", "单篇研报")}</span></li>
                <li><code>GET /api/v1/institutions</code> — <span>{tr(locale, "source list", "机构列表")}</span></li>
                <li><code>GET /api/v1/consensus</code> — <span>{tr(locale, "consensus per asset", "各资产共识")}</span></li>
              </ul>
              <p className="apikey-note">
                {tr(
                  locale,
                  "Responses carry this platform's own analysis and metadata. Publisher article bodies and PDFs are not served: displaying licensed research here is not the same as redistributing it.",
                  "接口返回本平台自有的分析结论与元数据,不包含出版方原文与 PDF —— 在本站展示受版权保护的研报,与将其转发给第三方系统是两回事。",
                )}
              </p>
            </div>
          </section>
        </aside>
      </div>
    </main>
  );
}
