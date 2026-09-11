import type { Metadata } from "next";
import type { Prisma } from "@prisma/client";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAdminLocale, tr } from "@/lib/i18n";
import { can } from "@/lib/permissions";
import { when } from "../_components/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "审计日志" };

const PAGE_SIZE = 50;

function validDate(value?: string, end = false) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return undefined;
  const date = new Date(`${value}T${end ? "23:59:59.999" : "00:00:00.000"}Z`);
  return Number.isNaN(date.getTime()) ? undefined : date;
}

function href(params: Record<string, string | undefined>, page: number) {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...params, page: String(page) })) if (value) query.set(key, value);
  return `?${query}`;
}

export default async function AuditPage(props: {
  searchParams: Promise<{ action?: string; actor?: string; target?: string; from?: string; to?: string; page?: string }>;
}) {
  const user = await getSessionUser();
  if (!user || !can(user, "admin.audit")) notFound();
  const locale = await getAdminLocale();
  const params = await props.searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const actor = params.actor?.trim().slice(0, 120);
  const target = params.target?.trim().slice(0, 120);
  const from = validDate(params.from);
  const to = validDate(params.to, true);
  const where: Prisma.AuditLogWhereInput = {
    ...(params.action ? { action: params.action } : {}),
    ...(actor ? { actor: { is: { OR: [{ email: { contains: actor } }, { name: { contains: actor } }] } } } : {}),
    ...(target ? { OR: [{ targetType: { contains: target } }, { targetId: { contains: target } }] } : {}),
    ...((from || to) ? { createdAt: { gte: from, lte: to } } : {}),
  };

  const [logs, total, actions] = await Promise.all([
    prisma.auditLog.findMany({
      where,
      include: { actor: { select: { email: true, name: true } } },
      orderBy: { createdAt: "desc" },
      skip: (page - 1) * PAGE_SIZE,
      take: PAGE_SIZE,
    }),
    prisma.auditLog.count({ where }),
    prisma.auditLog.findMany({ distinct: ["action"], select: { action: true }, orderBy: { action: "asc" } }),
  ]);
  const pages = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const filters = { action: params.action, actor: params.actor, target: params.target, from: params.from, to: params.to };

  return <>
    <header className="page-head admin-head">
      <div>
        <h1>{tr(locale, "Audit log", "审计日志")}</h1>
        <p className="sub">{tr(locale, "A searchable trail of administrative changes.", "可检索的后台管理变更轨迹。")}</p>
      </div>
      <span className="chip gray">{total} {tr(locale, "matching", "条匹配")}</span>
    </header>

    <section className="blk">
      <form className="admin-filters" method="get">
        <select name="action" defaultValue={params.action ?? ""} aria-label={tr(locale, "Action", "动作")}>
          <option value="">{tr(locale, "Any action", "全部动作")}</option>
          {actions.map(({ action }) => <option key={action} value={action}>{action}</option>)}
        </select>
        <input name="actor" defaultValue={params.actor ?? ""} placeholder={tr(locale, "Operator email or name", "操作人邮箱或姓名")} aria-label={tr(locale, "Operator", "操作人")} />
        <input name="target" defaultValue={params.target ?? ""} placeholder={tr(locale, "Target type or ID", "对象类型或 ID")} aria-label={tr(locale, "Target", "对象")} />
        <input name="from" type="date" defaultValue={params.from ?? ""} aria-label={tr(locale, "From date", "开始日期")} />
        <input name="to" type="date" defaultValue={params.to ?? ""} aria-label={tr(locale, "To date", "结束日期")} />
        <button className="minibtn p" type="submit">{tr(locale, "Apply", "筛选")}</button>
        <a className="minibtn" href="?">{tr(locale, "Reset", "重置")}</a>
      </form>

      <div className="tbl-wrap"><table className="admin-table">
        <thead><tr><th>{tr(locale, "Time", "时间")}</th><th>{tr(locale, "Action", "动作")}</th><th>{tr(locale, "Operator", "操作人")}</th><th>{tr(locale, "Target", "对象")}</th><th>{tr(locale, "Metadata", "元数据")}</th></tr></thead>
        <tbody>
          {logs.length === 0 && <tr><td colSpan={5}><div className="empty-state">{tr(locale, "No audit event matches this filter.", "没有符合筛选条件的审计事件。")}</div></td></tr>}
          {logs.map((log) => <tr key={log.id}>
            <td className="mono-cell">{when(log.createdAt, locale)}</td>
            <td><code>{log.action}</code></td>
            <td className="inst"><b>{log.actor?.email ?? tr(locale, "System / deleted user", "系统 / 已删除用户")}</b>{log.actor?.name && <small>{log.actor.name}</small>}</td>
            <td className="mono-cell">{log.targetType ?? "—"}<small>{log.targetId ?? "—"}</small></td>
            <td><details><summary>{tr(locale, "View", "展开")}</summary><pre className="audit-json">{log.metadata}</pre></details></td>
          </tr>)}
        </tbody>
      </table></div>

      {pages > 1 && <div className="pagination">
        {page > 1 ? <a href={href(filters, page - 1)}>← {tr(locale, "Previous", "上一页")}</a> : <span />}
        <span>{tr(locale, `page ${page} of ${pages}`, `第 ${page} / ${pages} 页`)}</span>
        {page < pages ? <a href={href(filters, page + 1)}>{tr(locale, "Next", "下一页")} →</a> : <span />}
      </div>}
    </section>
  </>;
}
