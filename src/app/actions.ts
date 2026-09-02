"use server";

import { cookies } from "next/headers";
import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { prisma } from "@/lib/db";
import { COOKIE, makeToken, getSessionUser, SESSION_COOKIE_OPTS } from "@/lib/auth";
import { describeRule, evaluateRules } from "@/lib/alerts";
import { writeAudit } from "@/lib/audit";
import { can } from "@/lib/permissions";
import { checkWebhookUrl } from "@/lib/alertDelivery";

function str(fd: FormData, key: string): string {
  return (fd.get(key)?.toString() ?? "").trim();
}

function localPath(value: string, fallback: string) {
  return value.startsWith("/") && !value.startsWith("//") ? value : fallback;
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
  (await cookies()).set(COOKIE, makeToken(user), SESSION_COOKIE_OPTS);
  redirect(localPath(str(fd, "next"), "/watchlist"));
}

export async function doSignOut() {
  const user = await getSessionUser();
  if (user) await writeAudit({ actorId: user.id, action: "auth.sign_out" });
  (await cookies()).delete(COOKIE);
  redirect("/");
}

// ---- watchlist ----
export async function addWatch(fd: FormData) {
  const user = await getSessionUser();
  const kind = str(fd, "kind");
  let refId = str(fd, "refId");
  if (!user) redirect(`/signin?next=${encodeURIComponent(str(fd, "back") || "/watchlist")}`);
  if (!(["asset", "institution", "theme"] as string[]).includes(kind) || !refId || refId.length > 80) return;
  if (kind === "asset") {
    refId = refId.toUpperCase();
    if (!(await prisma.asset.findUnique({ where: { ticker: refId }, select: { id: true } }))) return;
  }
  if (kind === "institution" && !(await prisma.institution.findUnique({ where: { slug: refId }, select: { id: true } }))) return;
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
  if (!user) redirect("/signin?next=/watchlist");
  const type = str(fd, "type");
  const legacyTicker = str(fd, "assetTicker").toUpperCase();
  const scopeKind = str(fd, "scopeKind") || (legacyTicker ? "asset" : "market");
  let scopeRef = str(fd, "scopeRef") || legacyTicker;
  const threshold = Number(str(fd, "threshold") || 0);
  const consensusTypes = ["CONSENSUS_ABOVE", "CONSENSUS_BELOW", "CONSENSUS_DROP_24H", "CONSENSUS_RISE_24H"];
  const macroTypes = ["MACRO_RELEASE", "MACRO_SURPRISE_ABOVE", "MACRO_SURPRISE_BELOW", "MACRO_REVISION", "CENTRAL_BANK_DECISION", "POLICY_STANCE_CHANGE"];
  if (![...consensusTypes, "NEW_RESEARCH", ...macroTypes].includes(type) || !["asset", "institution", "theme", "market", "macro_indicator", "macro_release_family", "central_bank"].includes(scopeKind)) return;
  if (consensusTypes.includes(type) && !["asset", "market"].includes(scopeKind)) return;
  if (type === "NEW_RESEARCH" && !["asset", "institution", "theme"].includes(scopeKind)) return;
  if (["MACRO_RELEASE", "MACRO_REVISION"].includes(type) && !["macro_indicator", "macro_release_family"].includes(scopeKind)) return;
  if (["MACRO_SURPRISE_ABOVE", "MACRO_SURPRISE_BELOW"].includes(type) && scopeKind !== "macro_indicator") return;
  if (["CENTRAL_BANK_DECISION", "POLICY_STANCE_CHANGE"].includes(type) && scopeKind !== "central_bank") return;
  if (!Number.isFinite(threshold) || (consensusTypes.includes(type) && (threshold < 0 || threshold > 100)) || (macroTypes.includes(type) && Math.abs(threshold) > 10000)) return;
  if (scopeKind !== "market" && (!scopeRef || scopeRef.length > 80)) return;
  if (scopeKind === "asset") {
    scopeRef = scopeRef.toUpperCase();
    if (!(await prisma.asset.findUnique({ where: { ticker: scopeRef }, select: { id: true } }))) return;
  }
  if (scopeKind === "institution" && !(await prisma.institution.findUnique({ where: { slug: scopeRef }, select: { id: true } }))) return;
  if (scopeKind === "macro_indicator" && !(await prisma.macroIndicator.findUnique({ where: { canonicalKey: scopeRef }, select: { id: true } }))) return;
  if (scopeKind === "macro_release_family" && !(await prisma.macroRelease.findFirst({ where: { releaseFamily: scopeRef }, select: { id: true } }))) return;
  if (scopeKind === "central_bank" && !(await prisma.macroPolicyDocument.findFirst({ where: { centralBank: scopeRef }, select: { id: true } }))) return;
  const ruleShape = { type, threshold, scopeKind, scopeRef: scopeRef || null, assetTicker: scopeKind === "asset" ? scopeRef : null };
  const rule = await prisma.alertRule.create({
    data: {
      userId: user!.id,
      name: describeRule(ruleShape),
      ...ruleShape,
    },
  });
  if (scopeKind !== "market" && scopeRef) {
    await prisma.watchlistItem.upsert({
      where: { userId_kind_refId: { userId: user!.id, kind: scopeKind, refId: scopeRef } },
      create: { userId: user!.id, kind: scopeKind, refId: scopeRef },
      update: {},
    });
  }
  await writeAudit({ actorId: user!.id, action: "alert.create", targetType: "alert_rule", targetId: rule.id });
  await evaluateRules();
  revalidatePath("/watchlist");
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
  revalidatePath("/watchlist");
}

export async function deleteRule(fd: FormData) {
  const user = await getSessionUser();
  if (!user) redirect("/signin");
  const id = str(fd, "id");
  const deleted = await prisma.alertRule.deleteMany({ where: { id, userId: user!.id } });
  if (deleted.count) await writeAudit({ actorId: user!.id, action: "alert.delete", targetType: "alert_rule", targetId: id });
  revalidatePath("/watchlist");
}

/**
 * Set (or clear) the destination fired alerts are POSTed to. Validated here so an invalid
 * or private-range URL is rejected at the point of entry, not discovered at delivery time.
 */
export async function setAlertWebhook(fd: FormData) {
  const user = await getSessionUser();
  if (!user || !can(user, "alerts.manage")) return;
  const raw = fd.get("url")?.toString().trim() ?? "";
  if (!raw) {
    await prisma.user.update({ where: { id: user.id }, data: { alertWebhookUrl: null } });
    await writeAudit({ actorId: user.id, action: "alerts.webhook.clear", targetType: "user", targetId: user.id });
    revalidatePath("/watchlist");
    return;
  }
  const verdict = checkWebhookUrl(raw);
  if (!verdict.ok) return;
  await prisma.user.update({ where: { id: user.id }, data: { alertWebhookUrl: raw } });
  await writeAudit({
    actorId: user.id,
    action: "alerts.webhook.set",
    targetType: "user",
    targetId: user.id,
    metadata: { host: new URL(raw).host },
  });
  revalidatePath("/watchlist");
}
