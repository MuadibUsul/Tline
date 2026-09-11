import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAdminLocale, tr, localePath, type Locale } from "@/lib/i18n";
import { can, ROLES } from "@/lib/permissions";
import { listUsers, TIERS, USER_PAGE_SIZE, USER_STATUSES, type UserStatus } from "@/lib/adminUsers";
import { adminLabel, age, tone, when } from "../_components/format";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "账户管理" };

const STATUS_LABEL: Record<UserStatus, [string, string]> = {
  active: ["Active", "正常"],
  suspended: ["Suspended", "已封禁"],
  invited: ["Invited", "待设密码"],
};

/** Keeps the current filters while changing one of them, so links compose. */
function href(base: Record<string, string | undefined>, change: Record<string, string | undefined>) {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...base, ...change })) {
    if (value) params.set(key, value);
  }
  const query = params.toString();
  return query ? `?${query}` : "?";
}

export default async function UsersPage(props: {
  searchParams: Promise<{ q?: string; role?: string; tier?: string; status?: string; sort?: string; page?: string }>;
}) {
  const actor = await getSessionUser();
  if (!actor || !can(actor, "admin.users")) notFound();
  const locale: Locale = await getAdminLocale();
  const params = await props.searchParams;
  const page = Math.max(1, Number(params.page) || 1);
  const week = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const [{ users, total, pages }, allUsers, newUsers, activeUsers, suspended] = await Promise.all([
    listUsers(params, page),
    prisma.user.count(),
    prisma.user.count({ where: { createdAt: { gte: week } } }),
    prisma.user.count({ where: { lastSeenAt: { gte: week } } }),
    prisma.user.count({ where: { suspendedAt: { not: null } } }),
  ]);

  const filters = { q: params.q, role: params.role, tier: params.tier, status: params.status, sort: params.sort };

  return <>
    <header className="page-head admin-head">
      <div>
        <h1>{tr(locale, "Accounts", "账户管理")}</h1>
        <p className="sub">{tr(locale, "Who has an account, what they may do, and whether they are still using it.", "谁拥有账户、他们被允许做什么，以及他们是否仍在使用。")}</p>
      </div>
      <div className="tag-row"><span className="chip gray">{total} {tr(locale, "matching", "条匹配")}</span></div>
    </header>

    <section className="admin-stats" aria-label={tr(locale, "Account summary", "账户概览")}>
      <div className="admin-stat"><span>{tr(locale, "Total accounts", "账户总数")}</span><b>{allUsers}</b><small>&nbsp;</small></div>
      <div className="admin-stat"><span>{tr(locale, "New · 7d", "7 日新增")}</span><b>{newUsers}</b><small>&nbsp;</small></div>
      <div className="admin-stat"><span>{tr(locale, "Active · 7d", "7 日活跃")}</span><b>{activeUsers}</b><small>{tr(locale, "signed in within a week", "一周内有过访问")}</small></div>
      <div className={`admin-stat${suspended ? " admin-stat-alarm" : ""}`}><span>{tr(locale, "Suspended", "已封禁")}</span><b>{suspended}</b><small>{tr(locale, "refused at sign-in", "登录被拒绝")}</small></div>
    </section>

    <section className="blk">
      <div className="section-t"><span>{tr(locale, "Accounts", "账户")}</span><span className="chip gray">{tr(locale, `page ${page} of ${pages}`, `第 ${page} / ${pages} 页`)}</span></div>

      {/* A GET form: the filter state lives in the address, so an operator can bookmark
          "suspended professionals" and hand the link to a colleague. */}
      <form className="admin-filters" method="get">
        <input type="search" name="q" defaultValue={params.q ?? ""} placeholder={tr(locale, "Email or name", "邮箱或姓名")} aria-label={tr(locale, "Search accounts", "搜索账户")} />
        <select name="role" defaultValue={params.role ?? ""} aria-label={tr(locale, "Role", "角色")}>
          <option value="">{tr(locale, "Any role", "全部角色")}</option>
          {ROLES.map((role) => <option key={role} value={role}>{adminLabel(role)}</option>)}
        </select>
        <select name="tier" defaultValue={params.tier ?? ""} aria-label={tr(locale, "Tier", "套餐")}>
          <option value="">{tr(locale, "Any tier", "全部套餐")}</option>
          {TIERS.map((tier) => <option key={tier} value={tier}>{adminLabel(tier)}</option>)}
        </select>
        <select name="status" defaultValue={params.status ?? ""} aria-label={tr(locale, "Status", "状态")}>
          <option value="">{tr(locale, "Any status", "全部状态")}</option>
          {USER_STATUSES.map((status) => <option key={status} value={status}>{tr(locale, ...STATUS_LABEL[status])}</option>)}
        </select>
        <select name="sort" defaultValue={params.sort ?? "recent"} aria-label={tr(locale, "Sort", "排序")}>
          <option value="recent">{tr(locale, "Newest first", "最新注册")}</option>
          <option value="oldest">{tr(locale, "Oldest first", "最早注册")}</option>
          <option value="active">{tr(locale, "Recently active", "最近活跃")}</option>
          <option value="email">{tr(locale, "Email A→Z", "邮箱 A→Z")}</option>
        </select>
        <button className="minibtn p" type="submit">{tr(locale, "Apply", "筛选")}</button>
        <a className="minibtn" href="?">{tr(locale, "Reset", "重置")}</a>
      </form>

      <div className="tbl-wrap"><table className="admin-table">
        <thead><tr>
          <th>{tr(locale, "Account", "账户")}</th>
          <th>{tr(locale, "Role", "角色")}</th>
          <th>{tr(locale, "Tier", "套餐")}</th>
          <th>{tr(locale, "Status", "状态")}</th>
          <th>{tr(locale, "Joined", "注册")}</th>
          <th>{tr(locale, "Last seen", "最近活跃")}</th>
          <th>{tr(locale, "Uses", "使用")}</th>
        </tr></thead>
        <tbody>
          {users.length === 0 && <tr><td colSpan={7}><div className="empty-state">{tr(locale, "No account matches this filter.", "没有符合筛选条件的账户。")}</div></td></tr>}
          {users.map((account) => <tr key={account.id}>
            <td className="inst">
              <Link href={localePath(locale, `/admin/users/${account.id}`)}>{account.email}</Link>
              <small>{account.name ?? "—"}</small>
            </td>
            <td><span className={`chip ${account.role === "admin" ? "acc" : "gray"}`}>{adminLabel(account.role)}</span></td>
            <td><span className="chip gray">{adminLabel(account.tier)}</span></td>
            <td><span className={`chip ${tone(account.status)}`}>{tr(locale, ...STATUS_LABEL[account.status])}</span></td>
            <td className="mono-cell">{when(account.createdAt, locale)}</td>
            <td className="mono-cell">{age(account.lastSeenAt, locale)}</td>
            <td className="mono-cell">{account.watchlist} / {account.rules}<small>{tr(locale, "watchlist / rules", "关注 / 提醒")}</small></td>
          </tr>)}
        </tbody>
      </table></div>

      {pages > 1 && <div className="pagination">
        {page > 1 ? <a href={href(filters, { page: String(page - 1) })}>← {tr(locale, "Previous", "上一页")}</a> : <span />}
        <span>{tr(locale, `${total} accounts · ${USER_PAGE_SIZE} per page`, `共 ${total} 个账户 · 每页 ${USER_PAGE_SIZE}`)}</span>
        {page < pages ? <a href={href(filters, { page: String(page + 1) })}>{tr(locale, "Next", "下一页")} →</a> : <span />}
      </div>}
    </section>
  </>;
}
