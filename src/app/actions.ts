"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { COOKIE, makeToken, getSessionUser, SESSION_COOKIE_OPTS } from "@/lib/auth";
import { evaluateRules } from "@/lib/alerts";

function str(fd: FormData, key: string): string {
  return (fd.get(key)?.toString() ?? "").trim();
}

// ---- auth ----
export async function doSignIn(fd: FormData) {
  const email = str(fd, "email").toLowerCase();
  const name = str(fd, "name") || email.split("@")[0];
  if (!email || !email.includes("@")) redirect("/signin?error=email");
  const user = await prisma.user.upsert({
    where: { email },
    create: { email, name, tier: "pro" },
    update: {},
  });
  cookies().set(COOKIE, makeToken(user), SESSION_COOKIE_OPTS);
  redirect(str(fd, "next") || "/watchlist");
}

export async function doSignOut() {
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
  await prisma.watchlistItem.upsert({
    where: { userId_kind_refId: { userId: user!.id, kind, refId } },
    create: { userId: user!.id, kind, refId },
    update: {},
  });
  revalidatePath("/watchlist");
  const back = str(fd, "back");
  if (back) revalidatePath(back);
}

export async function removeWatch(fd: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  await prisma.watchlistItem.deleteMany({
    where: { userId: user!.id, kind: str(fd, "kind"), refId: str(fd, "refId") },
  });
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
  await prisma.alertRule.create({
    data: {
      userId: user!.id,
      name: `${ticker || "Any"} consensus ${label[type] ?? type} ${threshold}`,
      type,
      assetTicker: ticker || null,
      threshold,
    },
  });
  await evaluateRules();
  revalidatePath("/alerts");
}

export async function toggleRule(fd: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  const id = str(fd, "id");
  const rule = await prisma.alertRule.findFirst({ where: { id, userId: user!.id } });
  if (rule) await prisma.alertRule.update({ where: { id }, data: { active: !rule.active } });
  revalidatePath("/alerts");
}

export async function deleteRule(fd: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  await prisma.alertRule.deleteMany({ where: { id: str(fd, "id"), userId: user!.id } });
  revalidatePath("/alerts");
}
