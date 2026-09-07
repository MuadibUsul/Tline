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
  if (!actor) return { error: "Not authorised." };
  const id = formData.get("id")?.toString();
  const role = formData.get("role")?.toString() ?? "";
  if (!id) return { error: "Missing account." };

  const target = await prisma.user.findUnique({ where: { id }, select: { id: true, email: true, role: true } });
  if (!target) return { error: "That account no longer exists." };

  const refusal = refuseRoleChange({
    actorId: actor.id,
    targetId: target.id,
    nextRole: role,
    currentRole: isRole(target.role) ? target.role : "member",
    adminCount: await countAdmins(),
  });
  if (refusal === "unknown_role") return { error: "That is not a role this system defines." };
  if (refusal === "self_demotion") return { error: "Ask another admin to change your own role." };
  if (refusal === "last_admin") return { error: "This is the last admin. Promote someone else first." };

  await prisma.user.update({ where: { id }, data: { role } });
  await writeAudit({ actorId: actor.id, action: "user.role.set", targetType: "user", targetId: id, metadata: { email: target.email, from: target.role, to: role } });
  refresh(id);
  return { ok: `Role set to ${role}.` };
}

export async function setUserTier(_previous: UserActionResult, formData: FormData): Promise<UserActionResult> {
  const actor = await operator();
  if (!actor) return { error: "Not authorised." };
  const id = formData.get("id")?.toString();
  const tier = formData.get("tier")?.toString() ?? "";
  if (!id) return { error: "Missing account." };

  const target = await prisma.user.findUnique({ where: { id }, select: { email: true, tier: true } });
  if (!target) return { error: "That account no longer exists." };
  // Submitting a legacy tier unchanged is how the picker behaves when nobody touched it;
  // that is a no-op, not an attempt to introduce a tier the system does not define.
  if (tier === target.tier) return { ok: "Tier unchanged." };
  if (!isTier(tier)) return { error: "That is not a tier this system defines." };

  await prisma.user.update({ where: { id }, data: { tier } });
  await writeAudit({ actorId: actor.id, action: "user.tier.set", targetType: "user", targetId: id, metadata: { email: target.email, from: target.tier, to: tier } });
  refresh(id);
  return { ok: `Tier set to ${tier}.` };
}

export async function setUserSuspension(_previous: UserActionResult, formData: FormData): Promise<UserActionResult> {
  const actor = await operator();
  if (!actor) return { error: "Not authorised." };
  const id = formData.get("id")?.toString();
  const suspend = formData.get("suspend") === "true";
  if (!id) return { error: "Missing account." };
  if (suspend && id === actor.id) return { error: "You cannot suspend your own account." };

  const target = await prisma.user.findUnique({ where: { id }, select: { email: true, role: true, suspendedAt: true } });
  if (!target) return { error: "That account no longer exists." };
  // Suspending the last admin is the same lockout as demoting them, by another route.
  if (suspend && target.role === "admin" && (await countAdmins()) <= 1) {
    return { error: "This is the last admin. Promote someone else first." };
  }
  // The allowlist is what makes the console recoverable; suspending an owner would take
  // that guarantee away while leaving the allowlist looking as if it still held.
  if (suspend && isOperationsOwner({ id, tier: "free", email: target.email })) {
    return { error: "This account is an operations owner (ADMIN_EMAILS). Remove it there first." };
  }

  await prisma.user.update({ where: { id }, data: { suspendedAt: suspend ? new Date() : null } });
  if (suspend) await revokeSessions(id);
  await writeAudit({ actorId: actor.id, action: suspend ? "user.suspend" : "user.restore", targetType: "user", targetId: id, metadata: { email: target.email } });
  refresh(id);
  return { ok: suspend ? "Account suspended and signed out everywhere." : "Account restored." };
}

export async function forceSignOut(_previous: UserActionResult, formData: FormData): Promise<UserActionResult> {
  const actor = await operator();
  if (!actor) return { error: "Not authorised." };
  const id = formData.get("id")?.toString();
  if (!id) return { error: "Missing account." };
  const target = await prisma.user.findUnique({ where: { id }, select: { email: true } });
  if (!target) return { error: "That account no longer exists." };

  await revokeSessions(id);
  await writeAudit({ actorId: actor.id, action: "user.signout.force", targetType: "user", targetId: id, metadata: { email: target.email } });
  refresh(id);
  return { ok: "Signed out on every device." };
}

export async function updateUserNote(_previous: UserActionResult, formData: FormData): Promise<UserActionResult> {
  const actor = await operator();
  if (!actor) return { error: "Not authorised." };
  const id = formData.get("id")?.toString();
  if (!id) return { error: "Missing account." };
  const note = formData.get("note")?.toString().trim().slice(0, 2000) ?? "";

  await prisma.user.update({ where: { id }, data: { note: note || null } });
  // The note itself is not copied into the audit trail: it is an operator's working
  // remark about a person, and the log records that it changed, not what it said.
  await writeAudit({ actorId: actor.id, action: "user.note.set", targetType: "user", targetId: id, metadata: { length: note.length } });
  refresh(id);
  return { ok: "Note saved." };
}

export async function deleteUser(_previous: UserActionResult, formData: FormData): Promise<UserActionResult> {
  const actor = await operator();
  if (!actor) return { error: "Not authorised." };
  const id = formData.get("id")?.toString();
  const confirm = formData.get("confirm")?.toString().trim().toLowerCase() ?? "";
  if (!id) return { error: "Missing account." };
  if (id === actor.id) return { error: "You cannot delete your own account." };

  const target = await prisma.user.findUnique({ where: { id }, select: { email: true, role: true } });
  if (!target) return { error: "That account no longer exists." };
  // Typing the address is the confirmation: a deletion cannot be undone, and a click
  // that lands on the wrong row should not be enough to cause one.
  if (confirm !== target.email.toLowerCase()) return { error: "Type the account's email exactly to confirm." };
  if (target.role === "admin" && (await countAdmins()) <= 1) return { error: "This is the last admin. Promote someone else first." };

  // Watchlists, rules and sessions cascade; keys and audit entries keep their history
  // with the actor detached, so what was done stays recorded after who did it is gone.
  await prisma.user.delete({ where: { id } });
  await writeAudit({ actorId: actor.id, action: "user.delete", targetType: "user", targetId: id, metadata: { email: target.email, role: target.role } });
  revalidatePath("/admin/users");
  return { ok: `${target.email} deleted.` };
}
