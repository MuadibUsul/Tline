import Link from "next/link";
import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { getSessionUser } from "@/lib/auth";
import { prisma } from "@/lib/db";
import { getAdminLocale, tr, localePath } from "@/lib/i18n";
import { can, isOperationsOwner, ROLES } from "@/lib/permissions";
import { statusOf, tierOptions } from "@/lib/adminUsers";
import { adminLabel, age, json, tone, when } from "../../_components/format";
import ActionForm from "../_components/ActionForm";
import { deleteUser, forceSignOut, setUserRole, setUserSuspension, setUserTier, updateUserNote } from "../actions";

export const dynamic = "force-dynamic";
export const metadata: Metadata = { title: "账户详情" };

export default async function UserDetailPage(props: { params: Promise<{ id: string }> }) {
  const actor = await getSessionUser();
  if (!actor || !can(actor, "admin.users")) notFound();
  const locale = await getAdminLocale();
  const { id } = await props.params;

  const account = await prisma.user.findUnique({
    where: { id },
    include: {
      watchlist: { orderBy: { createdAt: "desc" }, take: 20 },
      rules: { orderBy: { createdAt: "desc" }, take: 20, include: { _count: { select: { events: true } } } },
      sessions: { orderBy: { expires: "desc" } },
      accounts: { select: { id: true, provider: true, type: true } },
      apiKeys: { orderBy: { createdAt: "desc" }, select: { id: true, name: true, prefix: true, revokedAt: true, requestCount: true } },
    },
  });
  if (!account) notFound();

  const auditTrail = await prisma.auditLog.findMany({
    // Both sides of the story: what this person did, and what was done to their account.
    where: { OR: [{ actorId: id }, { targetType: "user", targetId: id }] },
    orderBy: { createdAt: "desc" },
    take: 25,
    include: { actor: { select: { email: true } } },
  });

  const status = statusOf(account);
  const owner = isOperationsOwner({ id: account.id, tier: account.tier, email: account.email });
  const self = account.id === actor.id;
  const liveSessions = account.sessions.filter((session) => session.expires.getTime() > Date.now());

  return <>
    <header className="page-head admin-head">
      <div>
        <div className="eyebrow"><Link href={localePath(locale, "/admin/users")}>← {tr(locale, "Accounts", "账户管理")}</Link></div>
        <h1 className="admin-user-title">{account.email}</h1>
        <p className="sub">{account.name ?? tr(locale, "No display name", "未设置显示名")} · {tr(locale, "joined", "注册于")} {when(account.createdAt, locale)}</p>
      </div>
      <div className="tag-row">
        <span className={`chip ${tone(status)}`}>{status}</span>
        <span className={`chip ${account.role === "admin" ? "acc" : "gray"}`}>{adminLabel(account.role)}</span>
        <span className="chip gray">{adminLabel(account.tier)}</span>{account.foundingSeat !== null && <span className="chip acc" title="创始会员">#{account.foundingSeat}</span>}
        {owner && <span className="chip acc" title="ADMIN_EMAILS">所有者</span>}
      </div>
    </header>

    <section className="admin-stats" aria-label={tr(locale, "Account summary", "账户概览")}>
      <div className="admin-stat"><span>{tr(locale, "Last seen", "最近活跃")}</span><b className="admin-stat-sm">{age(account.lastSeenAt, locale)}</b><small>{when(account.lastSeenAt, locale)}</small></div>
      <div className="admin-stat"><span>{tr(locale, "Live sessions", "有效会话")}</span><b>{liveSessions.length}</b><small>{account.accounts.map((link) => link.provider).join(" · ") || tr(locale, "password only", "仅密码")}</small></div>
      <div className="admin-stat"><span>{tr(locale, "Watchlist", "关注")}</span><b>{account.watchlist.length}</b><small>{tr(locale, "newest 20 shown", "显示最新 20 条")}</small></div>
      <div className="admin-stat"><span>{tr(locale, "Alert rules", "提醒规则")}</span><b>{account.rules.length}</b><small>{account.rules.filter((rule) => rule.active).length} {tr(locale, "active", "启用中")}</small></div>
    </section>

    <div className="admin-columns">
      <section className="blk">
        <div className="section-t">{tr(locale, "Activity", "活动")}</div>

        <div className="section-sub">{tr(locale, "Watchlist", "关注列表")}</div>
        <div className="admin-review-list">
          {account.watchlist.length === 0 && <div className="empty-state">{tr(locale, "Nothing is being watched.", "没有关注任何标的。")}</div>}
          {account.watchlist.map((item) => <div className="admin-review-row" key={item.id}>
            <span className="admin-plain-row"><b>{item.refId}</b><small>{item.kind} · {when(item.createdAt, locale)}</small></span>
          </div>)}
        </div>

        <div className="section-sub">{tr(locale, "Alert rules", "提醒规则")}</div>
        <div className="admin-review-list">
          {account.rules.length === 0 && <div className="empty-state">{tr(locale, "No alert rules.", "没有提醒规则。")}</div>}
          {account.rules.map((rule) => <div className="admin-review-row" key={rule.id}>
            <span className="admin-plain-row"><b>{rule.name}</b><small>{rule.type} · {rule.scopeKind}:{rule.scopeRef ?? rule.assetTicker ?? "—"} · {rule._count.events} {tr(locale, "fired", "次触发")}</small></span>
            <span className={`chip ${rule.active ? "bull" : "gray"}`}>{rule.active ? tr(locale, "active", "启用") : tr(locale, "paused", "停用")}</span>
          </div>)}
        </div>

        <div className="section-sub">{tr(locale, "Audit trail", "审计轨迹")}</div>
        <div className="admin-jobs">
          {auditTrail.length === 0 && <div className="empty-state">{tr(locale, "Nothing recorded for this account.", "该账户没有审计记录。")}</div>}
          {auditTrail.map((entry) => {
            const metadata = json(entry.metadata);
            return <div className="admin-job" key={entry.id}>
              <div><b>{entry.action}</b><small>{entry.actorId === id ? tr(locale, "by this account", "本人操作") : `${tr(locale, "by", "操作人")} ${entry.actor?.email ?? tr(locale, "system", "系统")}`} · {age(entry.createdAt, locale)}</small></div>
              <div className="admin-job-state"><span className="mono admin-metric">{Object.entries(metadata).slice(0, 3).map(([key, value]) => `${key}:${String(value)}`).join(" · ") || "—"}</span></div>
            </div>;
          })}
        </div>
      </section>

      <aside>
        <section className="blk">
          <div className="section-t">{tr(locale, "Access", "访问权限")}</div>
          <div className="admin-panel">
            <ActionForm action={setUserRole} className="admin-inline-form">
              <input type="hidden" name="id" value={account.id} />
              <label><span>{tr(locale, "Role", "角色")}</span>
                <select name="role" defaultValue={account.role}>{ROLES.map((role) => <option key={role} value={role}>{adminLabel(role)}</option>)}</select>
              </label>
              <button className="minibtn p" type="submit">{tr(locale, "Save", "保存")}</button>
            </ActionForm>
            {self && <p className="admin-hint">{tr(locale, "This is your own account: another admin must change your role.", "这是你自己的账户：角色需由其他管理员修改。")}</p>}
            {owner && <p className="admin-hint">{tr(locale, "Listed in ADMIN_EMAILS, so this account is admin regardless of the role stored here.", "该邮箱在 ADMIN_EMAILS 中，无论此处角色为何都拥有管理员权限。")}</p>}

            <ActionForm action={setUserTier} className="admin-inline-form">
              <input type="hidden" name="id" value={account.id} />
              <label><span>{tr(locale, "Tier", "套餐")}</span>
                <select name="tier" defaultValue={account.tier}>{tierOptions(account.tier).map((option) => (
                  <option key={option.value} value={option.value}>{adminLabel(option.value)}{option.legacy ? "（历史值）" : ""}</option>
                ))}</select>
              </label>
              <button className="minibtn p" type="submit">{tr(locale, "Save", "保存")}</button>
            </ActionForm>
          </div>
        </section>

        <section className="blk">
          <div className="section-t">{tr(locale, "Session control", "会话控制")}</div>
          <div className="admin-panel">
            <ActionForm action={forceSignOut} className="admin-inline-form">
              <input type="hidden" name="id" value={account.id} />
              <button className="minibtn" type="submit">{tr(locale, "Sign out everywhere", "强制全端下线")}</button>
              <span className="admin-hint">{tr(locale, "Ends every session, password unchanged.", "结束全部会话，不改动密码。")}</span>
            </ActionForm>

            <ActionForm
              action={setUserSuspension}
              className="admin-inline-form"
              confirm={account.suspendedAt ? undefined : tr(locale, `Suspend ${account.email}? They will be signed out and refused at sign-in.`, `确定封禁 ${account.email}？该账户将被下线并拒绝登录。`)}
            >
              <input type="hidden" name="id" value={account.id} />
              <input type="hidden" name="suspend" value={account.suspendedAt ? "false" : "true"} />
              <button className={`minibtn${account.suspendedAt ? " p" : ""}`} type="submit">
                {account.suspendedAt ? tr(locale, "Restore access", "解除封禁") : tr(locale, "Suspend account", "封禁账户")}
              </button>
              {account.suspendedAt && <span className="admin-hint">{tr(locale, "Suspended", "封禁于")} {when(account.suspendedAt, locale)}</span>}
            </ActionForm>
          </div>
        </section>

        <section className="blk">
          <div className="section-t">{tr(locale, "Operator note", "运营备注")}</div>
          <ActionForm action={updateUserNote} className="admin-panel">
            <input type="hidden" name="id" value={account.id} />
            <textarea name="note" rows={4} maxLength={2000} defaultValue={account.note ?? ""} placeholder={tr(locale, "Only visible in this console.", "仅在本后台可见。")} />
            <button className="minibtn" type="submit">{tr(locale, "Save note", "保存备注")}</button>
          </ActionForm>
        </section>

        {account.apiKeys.length > 0 && <section className="blk">
          <div className="section-t">{tr(locale, "Keys issued by this account", "该账户签发的密钥")}</div>
          <div className="admin-review-list">{account.apiKeys.map((key) => <div className="admin-review-row" key={key.id}>
            <span className="admin-plain-row"><b>{key.name}</b><small>{key.prefix}… · {key.requestCount.toLocaleString()} {tr(locale, "requests", "次调用")}</small></span>
            <span className={`chip ${key.revokedAt ? "bear" : "bull"}`}>{key.revokedAt ? tr(locale, "revoked", "已吊销") : tr(locale, "active", "启用中")}</span>
          </div>)}</div>
        </section>}

        <section className="blk admin-danger">
          <div className="section-t">{tr(locale, "Delete account", "删除账户")}</div>
          <ActionForm action={deleteUser} className="admin-panel">
            <input type="hidden" name="id" value={account.id} />
            <p className="admin-hint">{tr(
              locale,
              "Removes the account, its watchlist, rules and sessions. Audit entries and issued keys are kept with the owner detached.",
              "将删除账户及其关注、提醒与会话。审计记录与已签发密钥保留，但不再关联到该账户。",
            )}</p>
            <input name="confirm" autoComplete="off" placeholder={tr(locale, `Type ${account.email} to confirm`, `输入 ${account.email} 以确认`)} aria-label={tr(locale, "Confirm email", "确认邮箱")} />
            <button className="minibtn danger" type="submit">{tr(locale, "Delete permanently", "永久删除")}</button>
          </ActionForm>
        </section>
      </aside>
    </div>
  </>;
}
