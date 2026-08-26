"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { COOKIE, makeToken, getSessionUser, SESSION_COOKIE_OPTS } from "@/lib/auth";
import { evaluateRules } from "@/lib/alerts";
import { writeAudit } from "@/lib/audit";

function str(fd: FormData, key: string): string {
  return (fd.get(key)?.toString() ?? "").trim();
}

// ---- auth ----
export async function doSignIn(fd: FormData) {
  if (process.env.NODE_ENV === "production" && process.env.ALLOW_INSECURE_DEMO_AUTH !== "true") {
    redirect("/signin?error=disabled");
  }
  const email = str(fd, "email").toLowerCase();
  const name = str(fd, "name") || email.split("@")[0];
  if (!email || !email.includes("@")) redirect("/signin?error=email");
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, tier: "pro" },
    update: {},
  });
  await writeAudit({ actorId: user.id, action: "auth.sign_in" });
  cookies().set(COOKIE, makeToken(user), SESSION_COOKIE_OPTS);
  redirect(str(fd, "next") || "/watchlist");
}

export async function doSignOut() {
  const user = await getSessionUser();
  if (user) await writeAudit({ actorId: user.id, action: "auth.sign_out" });
  cookies().delete(COOKIE);
  redirect("/");
}

// ---- watchlist ----
export async function addWatch(fd: FormData) {
  const user = await getSessionUser();
  const kind = str(fd, "kind");
  const refId = str(fd, "refId");
  if (!user) redirect(`/signin?next=${encodeURIComponent(str(fd, "back") || "/watchlist")}`);
  if (!kind || !refId) return;
  const item = await prisma.watchlistItem.upsert({
    where: { userId_kind_refId: { userId: user!.id, kind, refId } },
    create: { userId: user!.id, kind, refId },
    update: {},
  });
  await writeAudit({ actorId: user!.id, action: "watchlist.upsert", targetType: kind, targetId: refId, metadata: { itemId: item.id } });
  revalidatePath("/watchlist");
  const back = str(fd, "back");
  if (back) revalidatePath(back);
}

export async function removeWatch(fd: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  const deleted = await prisma.watchlistItem.deleteMany({
    where: { userId: user!.id, kind: str(fd, "kind"), refId: str(fd, "refId") },
  });
  if (deleted.count) await writeAudit({ actorId: user!.id, action: "watchlist.delete", targetType: str(fd, "kind"), targetId: str(fd, "refId") });
  revalidatePath("/watchlist");
}

// ---- alert rules ----
export async function createRule(fd: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/signin?next=/alerts");
  const type = str(fd, "type");
  const ticker = str(fd, "assetTicker");
  const threshold = Number(str(fd, "threshold"));
  if (!type || Number.isNaN(threshold)) return;
  const label: Record<string, string> = {
    CONSENSUS_ABOVE: "above", CONSENSUS_BELOW: "below",
    CONSENSUS_DROP_24H: "drops", CONSENSUS_RISE_24H: "rises",
  };
  const rule = await prisma.alertRule.create({
    data: {
      userId: user!.id,
      name: `${ticker || "Any"} consensus ${label[type] ?? type} ${threshold}`,
      type,
      assetTicker: ticker || null,
      threshold,
    },
  });
  await writeAudit({ actorId: user!.id, action: "alert.create", targetType: "alert_rule", targetId: rule.id });
  await evaluateRules();
  revalidatePath("/alerts");
}

export async function toggleRule(fd: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  const id = str(fd, "id");
  const rule = await prisma.alertRule.findFirst({ where: { id, userId: user!.id } });
  if (rule) {
    await prisma.alertRule.update({ where: { id }, data: { active: !rule.active } });
    await writeAudit({ actorId: user!.id, action: "alert.toggle", targetType: "alert_rule", targetId: id, metadata: { active: !rule.active } });
  }
  revalidatePath("/alerts");
}

export async function deleteRule(fd: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  const id = str(fd, "id");
  const deleted = await prisma.alertRule.deleteMany({ where: { id, userId: user!.id } });
  if (deleted.count) await writeAudit({ actorId: user!.id, action: "alert.delete", targetType: "alert_rule", targetId: id });
  revalidatePath("/alerts");
}
