"use server";

import { revalidatePath } from "next/cache";
import { getSessionUser } from "@/lib/auth";
import { writeAudit } from "@/lib/audit";
import { prisma } from "@/lib/db";
import { hashPassword, passwordProblem, verifyPassword } from "@/lib/password";

export interface PasswordFormState {
  error?: "unauthorised" | "short" | "long" | "email" | "common" | "mismatch" | "wrong-current";
  done?: boolean;
  /** True when the change also ended this session, so the form asks for a fresh sign-in. */
  signedOut?: boolean;
}

/**
 * Sets or changes the signed-in account's password.
 *
 * Someone who already has one must prove it, so a borrowed unlocked browser cannot be
 * used to lock the owner out. Changing an existing password stamps passwordChangedAt,
 * which ends every session issued before that moment — including this one, so the caller
 * signs in again. Setting the first password does not: there are no other sessions to
 * end, and enrolment should not close with a needless sign-out.
 */
export async function setPassword(_previous: PasswordFormState, formData: FormData): Promise<PasswordFormState> {
  const user = await getSessionUser();
  if (!user) return { error: "unauthorised" };

  const next = formData.get("password")?.toString() ?? "";
  const confirm = formData.get("confirm")?.toString() ?? "";
  const current = formData.get("current")?.toString() ?? "";

  if (user.passwordHash && !(await verifyPassword(current, user.passwordHash))) return { error: "wrong-current" };
  if (next !== confirm) return { error: "mismatch" };
  const problem = passwordProblem(next, user.email);
  if (problem) return { error: problem };

  const replacing = Boolean(user.passwordHash);
  await prisma.user.update({
    where: { id: user.id },
    data: {
      passwordHash: await hashPassword(next),
      ...(replacing ? { passwordChangedAt: new Date() } : {}),
    },
  });
  await writeAudit({ actorId: user.id, action: replacing ? "auth.password_change" : "auth.password_set" });
  revalidatePath("/account/password");
  return { done: true, signedOut: replacing };
}
