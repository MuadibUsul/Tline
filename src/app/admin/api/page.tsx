import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getLocale, tr } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { API_SCOPES, parseScopes } from "@/lib/apiKeys";
import { usagePerKey, usageReport } from "@/lib/apiUsage";
import { revokeApiKey, updateApiKeyLimit } from "../actions";
import { age, compact, plural, when } from "../_components/format";
import { BarList, StatCard, TimeSeries } from "@/app/_components/charts";
import CreateKeyForm from "./CreateKeyForm";
import RotateKeyButton from "./RotateKeyButton";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "API" };

export default async function ApiPage() {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.api")) notFound();
  const locale = await getLocale();

  const [keys, usage, sparkline] = await Promise.all([
    prisma.apiKey.findMany({
      orderBy: [{ revokedAt: "asc" }, { createdAt: "desc" }],
      include: { createdBy: { select: { email: true } } },
    }),
    usageReport(30),
    usagePerKey(7),
  ]);
  const active = keys.filter((key) => !key.revokedAt).length;
  const keyName = new Map(keys.map((key) => [key.id, key.name]));
  const errorRate = usage.totals.calls === 0 ? null : (usage.totals.errors / usage.totals.calls) * 100;

  return (
    <>
      <header className="page-head admin-head">
        <div>
          <h1>{tr(locale, "API & keys", "API 与密钥")}</h1>
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
        </div>
      </header>

      <section className="admin-stats" aria-label={tr(locale, "API summary", "API 概览")}>
        <StatCard label={tr(locale, "Requests · 30d", "30 天调用")} value={compact(usage.totals.calls)} note={tr(locale, "authenticated and refused", "含成功与被拒")} />
        <StatCard
          label={tr(locale, "Error rate", "错误率")}
          value={errorRate === null ? "—" : `${errorRate.toFixed(1)}%`}
          note={tr(locale, `${plural(usage.totals.errors, "response", "responses")} ≥ 400`, `${usage.totals.errors} 次 4xx/5xx`)}
        />
        <StatCard
          label={tr(locale, "Rate limited", "触发限流")}
          value={compact(usage.totals.rateLimited)}
          note={tr(locale, "429 responses", "429 响应")}
        />
        <StatCard
          label={tr(locale, "Response time", "响应耗时")}
          value={usage.totals.avgMs === null ? "—" : `${Math.round(usage.totals.avgMs)}ms`}
          note={tr(locale, "server-side average", "服务端平均值")}
        />
      </section>

      {usage.totals.calls > 0 && <>
        <section className="blk">
          <div className="section-t"><span>{tr(locale, "Requests per day", "每日调用量")}</span><span className="chip gray">30d · UTC</span></div>
          <TimeSeries points={usage.series} primaryLabel={tr(locale, "Requests", "调用次数")} />
        </section>

        <div className="analytics-grid">
          <section className="blk">
            <div className="section-t">{tr(locale, "By endpoint", "按接口")}</div>
            <BarList
              empty={tr(locale, "No call recorded.", "没有调用记录。")}
              rows={usage.byEndpoint.map((row) => ({
                label: row.value,
                value: row.calls,
                hint: row.errors ? tr(locale, plural(row.errors, "error", "errors"), `${row.errors} 次错误`) : undefined,
              }))}
            />
          </section>

          <section className="blk">
            <div className="section-t">{tr(locale, "By key", "按密钥")}</div>
            <BarList
              empty={tr(locale, "No call recorded.", "没有调用记录。")}
              rows={usage.byKey.map((row) => ({
                // An unauthenticated call has no key to name: those are the callers who
                // never got in, and hiding them would hide a misconfigured integration.
                label: row.value ? keyName.get(row.value) ?? row.value : tr(locale, "Unauthenticated", "未鉴权"),
                value: row.calls,
                hint: row.errors ? tr(locale, plural(row.errors, "error", "errors"), `${row.errors} 次错误`) : undefined,
              }))}
            />
          </section>

          <section className="blk">
            <div className="section-t">{tr(locale, "By status", "按状态码")}</div>
            <BarList
              empty={tr(locale, "No call recorded.", "没有调用记录。")}
              rows={usage.byStatus.map((row) => ({ label: String(row.status), value: row.calls }))}
            />
          </section>
        </div>
      </>}

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
                      <small>{key.rateLimit}/min · {tr(locale, "last used", "最近调用")} {age(key.lastUsedAt, locale)}</small>
                      {/* Seven days beside the all-time total: the total says a key was
                          used once, the shape says whether it still is. */}
                      <span className="key-spark"><TimeSeries points={sparkline(key.id)} width={160} height={34} bare primaryLabel={tr(locale, "Requests · 7d", "7 天调用")} /></span>
                    </td>
                    <td>
                      <div className="admin-actions">
                        {!key.revokedAt && <>
                          {/* Changing the limit needs no new secret, so it is a plain
                              form rather than part of rotation. */}
                          <form action={updateApiKeyLimit} className="admin-inline-form">
                            <input type="hidden" name="id" value={key.id} />
                            <input name="rateLimit" type="number" min={1} max={6000} defaultValue={key.rateLimit} aria-label={tr(locale, "Requests per minute", "每分钟请求上限")} className="rate-input" />
                            <button className="minibtn" type="submit">{tr(locale, "Set", "设定")}</button>
                          </form>
                          <RotateKeyButton
                            id={key.id}
                            labels={{
                              rotate: tr(locale, "Rotate", "轮换"),
                              rotating: tr(locale, "Rotating…", "轮换中……"),
                              confirm: tr(locale, `Rotate "${key.name}"? The current secret stops working immediately.`, `轮换「${key.name}」？当前密钥将立即失效。`),
                              issued: tr(locale, "New key", "新密钥"),
                              warning: tr(locale, "Copy it now — this is the only time it is shown.", "请立即复制，离开本页后将无法再次查看。"),
                              copy: tr(locale, "Copy", "复制"),
                              copied: tr(locale, "Copied", "已复制"),
                            }}
                          />
                          <form action={revokeApiKey}>
                            <input type="hidden" name="id" value={key.id} />
                            <button className="minibtn danger" type="submit">{tr(locale, "Revoke", "吊销")}</button>
                          </form>
                        </>}
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
    </>
  );
}
