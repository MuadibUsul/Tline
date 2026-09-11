"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { can, isRole, isOperationsOwner } from "@/lib/permissions";
import { countAdmins, isTier, refuseRoleChange } from "@/lib/adminUsers";

/**
 * Account administration.
 *
 * Every mutation here re-reads the target and re-checks the rules on the server: the
 * console renders the buttons an operator is allowed, but a form post is not obliged to
 * come from that console.
 */

export interface UserActionResult {
  error?: string;
  ok?: string;
}

async function operator() {
  const user = await getSessionUser();
  return user && can(user, "admin.users") ? user : null;
}

function refresh(id: string) {
  revalidatePath("/admin/users");
  revalidatePath(`/admin/users/${id}`);
}

/** Ends every live session for an account, whichever provider issued it. */
async function revokeSessions(id: string) {
  // Database sessions cover the adapter's own; `passwordChangedAt` covers the JWTs,
  // which are refused on their next use by the check in auth-config.
  await prisma.$transaction([
    prisma.session.deleteMany({ where: { userId: id } }),
    prisma.user.update({ where: { id }, data: { passwordChangedAt: new Date() } }),
  ]);
}

export async function setUserRole(_previous: UserActionResult, formData: FormData): Promise<UserActionResult> {
  const actor = await operator();
  if (!actor) return { error: "无权执行此操作。" };
  const id = formData.get("id")?.toString();
  const role = formData.get("role")?.toString() ?? "";
  if (!id) return { error: "缺少账户。" };

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
  if (!target) return { error: "该账户已不存在。" };

  const refusal = refuseRoleChange({
    actorId: actor.id,
    targetId: target.id,
    nextRole: role,
    currentRole: isRole(target.role) ? target.role : "member",
    adminCount: await countAdmins(),
  });
  if (refusal === "unknown_role") return { error: "该角色未在系统中定义。" };
  if (refusal === "self_demotion") return { error: "请让另一位管理员修改你的角色。" };
  if (refusal === "last_admin") return { error: "这是最后一位管理员，请先将其他账户提升为管理员。" };

  await prisma.user.update({ where: { id }, data: { role } });
  await writeAudit({ actorId: actor.id, action: "user.role.set", targetType: "user", targetId: id, metadata: { email: target.email, from: target.role, to: role } });
  refresh(id);
  return { ok: `Role set to ${role}.` };
}

export async function setUserTier(_previous: UserActionResult, formData: FormData): Promise<UserActionResult> {
  const actor = await operator();
  if (!actor) return { error: "无权执行此操作。" };
  const id = formData.get("id")?.toString();
  const tier = formData.get("tier")?.toString() ?? "";
  if (!id) return { error: "缺少账户。" };

  const target = await prisma.user.findUnique({ where: { id }, select: { email: true, tier: true } });
  if (!target) return { error: "该账户已不存在。" };
  // Submitting a legacy tier unchanged is how the picker behaves when nobody touched it;
  // that is a no-op, not an attempt to introduce a tier the system does not define.
  if (tier === target.tier) return { ok: "套餐未发生变化。" };
  if (!isTier(tier)) return { error: "该套餐未在系统中定义。" };

  await prisma.user.update({ where: { id }, data: { tier } });
  await writeAudit({ actorId: actor.id, action: "user.tier.set", targetType: "user", targetId: id, metadata: { email: target.email, from: target.tier, to: tier } });
  refresh(id);
  return { ok: `Tier set to ${tier}.` };
}

export async function setUserSuspension(_previous: UserActionResult, formData: FormData): Promise<UserActionResult> {
  const actor = await operator();
  if (!actor) return { error: "无权执行此操作。" };
  const id = formData.get("id")?.toString();
  const suspend = formData.get("suspend") === "true";
  if (!id) return { error: "缺少账户。" };
  if (suspend && id === actor.id) return { error: "不能封禁自己的账户。" };

  const target = await prisma.user.findUnique({ where: { id }, select: { email: true, role: true, suspendedAt: true } });
  if (!target) return { error: "该账户已不存在。" };
  // Suspending the last admin is the same lockout as demoting them, by another route.
  if (suspend && target.role === "admin" && (await countAdmins()) <= 1) {
    return { error: "这是最后一位管理员，请先将其他账户提升为管理员。" };
  }
  // The allowlist is what makes the console recoverable; suspending an owner would take
  // that guarantee away while leaving the allowlist looking as if it still held.
  if (suspend && isOperationsOwner({ id, tier: "free", email: target.email })) {
    return { error: "该账户是运营所有者，请先从 ADMIN_EMAILS 中移除。" };
  }

  await prisma.user.update({ where: { id }, data: { suspendedAt: suspend ? new Date() : null } });
  if (suspend) await revokeSessions(id);
  await writeAudit({ actorId: actor.id, action: suspend ? "user.suspend" : "user.restore", targetType: "user", targetId: id, metadata: { email: target.email } });
  refresh(id);
  return { ok: suspend ? "账户已封禁并强制全端下线。" : "账户已恢复。" };
}

export async function forceSignOut(_previous: UserActionResult, formData: FormData): Promise<UserActionResult> {
  const actor = await operator();
  if (!actor) return { error: "无权执行此操作。" };
  const id = formData.get("id")?.toString();
  if (!id) return { error: "缺少账户。" };
  const target = await prisma.user.findUnique({ where: { id }, select: { email: true } });
  if (!target) return { error: "该账户已不存在。" };

  await revokeSessions(id);
  await writeAudit({ actorId: actor.id, action: "user.signout.force", targetType: "user", targetId: id, metadata: { email: target.email } });
  refresh(id);
  return { ok: "已强制从所有设备退出。" };
}

export async function updateUserNote(_previous: UserActionResult, formData: FormData): Promise<UserActionResult> {
  const actor = await operator();
  if (!actor) return { error: "无权执行此操作。" };
  const id = formData.get("id")?.toString();
  if (!id) return { error: "缺少账户。" };
  const note = formData.get("note")?.toString().trim().slice(0, 2000) ?? "";

  await prisma.user.update({ where: { id }, data: { note: note || null } });
  // The note itself is not copied into the audit trail: it is an operator's working
  // remark about a person, and the log records that it changed, not what it said.
  await writeAudit({ actorId: actor.id, action: "user.note.set", targetType: "user", targetId: id, metadata: { length: note.length } });
  refresh(id);
  return { ok: "备注已保存。" };
}

export async function deleteUser(_previous: UserActionResult, formData: FormData): Promise<UserActionResult> {
  const actor = await operator();
  if (!actor) return { error: "无权执行此操作。" };
  const id = formData.get("id")?.toString();
  const confirm = formData.get("confirm")?.toString().trim().toLowerCase() ?? "";
  if (!id) return { error: "缺少账户。" };
  if (id === actor.id) return { error: "不能删除自己的账户。" };

  const target = await prisma.user.findUnique({ where: { id }, select: { email: true, role: true } });
  if (!target) return { error: "该账户已不存在。" };
  // Typing the address is the confirmation: a deletion cannot be undone, and a click
  // that lands on the wrong row should not be enough to cause one.
  if (confirm !== target.email.toLowerCase()) return { error: "请输入该账户的完整邮箱以确认。" };
  if (target.role === "admin" && (await countAdmins()) <= 1) return { error: "这是最后一位管理员，请先将其他账户提升为管理员。" };

  // Watchlists, rules and sessions cascade; keys and audit entries keep their history
  // with the actor detached, so what was done stays recorded after who did it is gone.
  await prisma.user.delete({ where: { id } });
  await writeAudit({ actorId: actor.id, action: "user.delete", targetType: "user", targetId: id, metadata: { email: target.email, role: target.role } });
  revalidatePath("/admin/users");
  return { ok: `${target.email} deleted.` };
}
