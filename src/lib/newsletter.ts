import { randomBytes } from "node:crypto";
import { createRequire } from "node:module";
import { prisma } from "./db";
import { localePath, tr, type Locale } from "./i18n";
import { siteUrl } from "./site";

/**
 * Newsletter subscription.
 *
 * Double opt-in: a row starts PENDING and only the confirmation link moves it to
 * CONFIRMED, so a mistyped or borrowed address never receives anything but the one
 * message that asks for consent. There is one row per address whatever happens after
 * that — an unsubscribe is a state change, not a second identity — which keeps "we never
 * send after unsubscribe" provable rather than a promise.
 */

export type NewsletterStatus = "PENDING" | "CONFIRMED" | "UNSUBSCRIBED";

/** The machine endpoint both links of a confirmation email point at. */
const CONFIRM_PATH = "/api/newsletter/confirm";

/** 192 bits of URL-safe randomness: the token in a link is the only credential it needs. */
export function newConfirmToken(): string {
  return randomBytes(24).toString("base64url");
}

/** Trimmed and case-folded, so one address is one identity however it was typed. */
export function normalizeEmail(raw: string): string {
  return raw.trim().toLowerCase();
}

const LOCAL = /^[a-z0-9][a-z0-9._%+-]*$/;
const LABEL = /^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/;

/**
 * Whether an address is worth sending to.
 *
 * Deliberately not RFC 5322: that grammar accepts things no mail provider does, and the
 * confirmation email is the real validator — it either arrives or it does not. This only
 * refuses what is plainly not an address (no single @, no dotted domain, absurd length),
 * so a valid but unusual address is never turned away here.
 */
export function isPlausibleEmail(raw: string): boolean {
  const email = normalizeEmail(raw);
  if (email.length < 6 || email.length > 254) return false; // the shortest real form, a@b.co, is 6
  const at = email.indexOf("@");
  if (at < 1 || at !== email.lastIndexOf("@")) return false;
  const local = email.slice(0, at);
  const domain = email.slice(at + 1);
  if (local.length > 64 || local.endsWith(".") || local.includes("..") || !LOCAL.test(local)) return false;
  if (domain.length > 253) return false;
  const labels = domain.split(".");
  if (labels.length < 2 || labels.some((label) => !LABEL.test(label))) return false;
  return /^[a-z]{2,}$/.test(labels[labels.length - 1]);
}

/**
 * The address a confirmation email sends the reader to.
 *
 * A machine endpoint takes no language prefix — localePath leaves the path as it is —
 * but the locale is still the argument here because it is the subscriber's, carried into
 * the email so the redirect after the click can land in the language they signed up in.
 */
export function confirmUrl(token: string, locale: Locale): string {
  const url = new URL(localePath(locale, CONFIRM_PATH), siteUrl());
  url.searchParams.set("token", token);
  return url.toString();
}

/** The same endpoint, switched to the action that ends the subscription. */
export function unsubscribeUrl(token: string, locale: Locale): string {
  const url = new URL(confirmUrl(token, locale));
  url.searchParams.set("action", "unsubscribe");
  return url.toString();
}

/** The stored locale, when it is one we know; anything else is left to the request. */
export function asLocale(value: string | null | undefined): Locale | null {
  return value === "en" || value === "zh-CN" ? value : null;
}

/**
 * The state a resubmission lands in.
 *
 * CONFIRMED is left alone — the page answers a resubmission with the same sentence
 * whatever the row was, so the form cannot be used to discover who is on the list.
 * Everything else re-enters double opt-in with a fresh token: a re-subscribe is a new
 * consent, and a PENDING resubmission is usually someone whose first email went missing.
 */
export function nextStatusAfterResubscribe(status: string | null | undefined): NewsletterStatus {
  return status === "CONFIRMED" ? "CONFIRMED" : "PENDING";
}

export type SubscribeOutcome = "pending" | "already" | "invalid";

/**
 * Records the intent to subscribe and sends the one message that asks for confirmation.
 *
 * The outcome distinguishes "pending" from "already" for the caller's own logic, but both
 * are answered identically to the visitor. The mail is attempted last and only for the
 * states that need it: an address that already opted in is not asked again, and a failed
 * send never fails the write — the row is what the link will come back to.
 */
export async function subscribeToNewsletter(input: { email: string; locale: Locale; source?: string }): Promise<{ outcome: SubscribeOutcome }> {
  const email = normalizeEmail(input.email);
  if (!isPlausibleEmail(email)) return { outcome: "invalid" };
  const source = input.source?.trim().slice(0, 40) || null;

  const existing = await prisma.newsletterSubscriber.findUnique({ where: { email } });
  if (existing && nextStatusAfterResubscribe(existing.status) === "CONFIRMED") {
    return { outcome: "already" };
  }

  // One upsert covers both resubmission shapes: PENDING gets a fresh token (the previous
  // email may be lost, and rotating invalidates links from an earlier, abandoned attempt)
  // and UNSUBSCRIBED re-enters double opt-in. The two timestamps describe the current
  // opt-in state, so both are cleared: only the pair matching `status` is ever set.
  const confirmToken = newConfirmToken();
  await prisma.newsletterSubscriber.upsert({
    where: { email },
    create: { email, locale: input.locale, status: "PENDING", confirmToken, source },
    update: { locale: input.locale, status: "PENDING", confirmToken, confirmedAt: null, unsubscribedAt: null, ...(source ? { source } : {}) },
  });

  await sendConfirmationEmail({ to: email, locale: input.locale, token: confirmToken });
  return { outcome: "pending" };
}

export type ConfirmOutcome = "confirmed" | "unsubscribed" | "invalid";

/**
 * The click on the confirmation link, and on a repeat of it.
 *
 * A link that matches no row is "invalid" — nothing distinguishes a mistyped token from
 * a rotated one, and neither should say more. A token that resolves to an UNSUBSCRIBED
 * row returns "unsubscribed" rather than confirming: an old email's confirmation link
 * must not silently undo a deliberate opt-out.
 */
export async function confirmSubscription(token: string): Promise<{ outcome: ConfirmOutcome; locale: Locale | null }> {
  const clean = cleanToken(token);
  if (!clean) return { outcome: "invalid", locale: null };
  const row = await prisma.newsletterSubscriber.findUnique({ where: { confirmToken: clean } });
  if (!row) return { outcome: "invalid", locale: null };
  const locale = asLocale(row.locale);
  if (row.status === "CONFIRMED") return { outcome: "confirmed", locale };
  if (row.status === "UNSUBSCRIBED") return { outcome: "unsubscribed", locale };
  await prisma.newsletterSubscriber.update({ where: { id: row.id }, data: { status: "CONFIRMED", confirmedAt: new Date() } });
  return { outcome: "confirmed", locale };
}

export type UnsubscribeOutcome = "unsubscribed" | "invalid";

/**
 * The click on the unsubscribe link, from any email and in any state.
 *
 * Idempotent by design: a second click keeps the row and the original timestamp, so a
 * double-click in a mail client cannot rewrite when the opt-out happened.
 */
export async function unsubscribeByToken(token: string): Promise<{ outcome: UnsubscribeOutcome; locale: Locale | null }> {
  const clean = cleanToken(token);
  if (!clean) return { outcome: "invalid", locale: null };
  const row = await prisma.newsletterSubscriber.findUnique({ where: { confirmToken: clean } });
  if (!row) return { outcome: "invalid", locale: null };
  const locale = asLocale(row.locale);
  if (row.status !== "UNSUBSCRIBED") {
    await prisma.newsletterSubscriber.update({ where: { id: row.id }, data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date() } });
  }
  return { outcome: "unsubscribed", locale };
}

/** Tokens are 32 URL-safe characters; anything of another shape cannot match a row. */
function cleanToken(token: string): string | null {
  const clean = token.trim();
  return clean && clean.length <= 128 ? clean : null;
}

interface MailTransport {
  sendMail(message: { from: string; to: string; subject: string; text: string; html: string; headers?: Record<string, string> }): Promise<unknown>;
}

// nodemailer ships no type declarations and no @types package is installed. Loading it
// through the runtime resolver keeps the one boundary that needs a type — createTransport
// and sendMail — declared locally, rather than suppressing the compiler with a comment.
const nodeRequire = createRequire(import.meta.url);

/**
 * One message, sent once per PENDING address, and never able to break its caller.
 *
 * Delivery is the one step here that depends on something outside this codebase, and a
 * visitor can act on none of its failures. An unconfigured or refusing mail server is
 * reported exactly once, in the server log, under newsletter.mail.failed — the greeting
 * that finds it — while the row stays PENDING and the site keeps working.
 */
async function sendConfirmationEmail(input: { to: string; locale: Locale; token: string }): Promise<void> {
  const server = process.env.EMAIL_SERVER;
  const from = process.env.EMAIL_FROM;
  if (!server || !from) {
    console.error("newsletter.mail.failed", { reason: "EMAIL_SERVER/EMAIL_FROM not configured", to: input.to });
    return;
  }
  const confirm = confirmUrl(input.token, input.locale);
  const leave = unsubscribeUrl(input.token, input.locale);
  const { subject, text, html } = confirmationMail(input.locale, confirm, leave);
  try {
    const { createTransport } = nodeRequire("nodemailer") as { createTransport: (server: string) => MailTransport };
    await createTransport(server).sendMail({
      from,
      to: input.to,
      subject,
      text,
      html,
      // A mail client's own unsubscribe affordance, pointing at the same endpoint. No
      // List-Unsubscribe-Post: that header promises a one-click POST this route does not take.
      headers: { "List-Unsubscribe": `<${leave}>` },
    });
  } catch (error) {
    console.error("newsletter.mail.failed", { reason: String(error), to: input.to });
  }
}

/** Both languages of the message, each complete on its own — the reader gets one of them. */
function confirmationMail(locale: Locale, confirm: string, leave: string): { subject: string; text: string; html: string } {
  const subject = tr(locale, "Confirm your subscription — Tlines newsletter", "确认订阅 Tlines 每周通讯");
  const intro = tr(locale,
    "One more step: confirm this address to receive the Tlines weekly newsletter.",
    "还差一步:请确认这个邮箱,以接收 Tlines 每周通讯。");
  const button = tr(locale, "Confirm subscription", "确认订阅");
  const blurb = tr(locale,
    "The newsletter is weekly and bilingual, and a short read: the institutional research that mattered this week, each item linked to its source report. No spam, and every email carries a one-click unsubscribe.",
    "通讯每周一封、中英双语,内容精炼:当周值得关注的机构研报,每条都附原始报告链接。不发垃圾邮件,每封邮件都可一键退订。");
  const fallback = tr(locale, "If the button does not work, paste this address into your browser:", "如果按钮无法点击,请将以下链接复制到浏览器打开:");
  const ignore = tr(locale,
    "If you did not request this, simply ignore this message — nothing else is ever sent to this address without confirmation.",
    "如果这不是你本人的操作,忽略本邮件即可——未经确认,我们不会再向该地址发送任何内容。");
  const cancel = tr(locale, "To cancel this request instead:", "如需撤销本次订阅请求:");

  const confirmHref = confirm.replaceAll("&", "&amp;");
  const leaveHref = leave.replaceAll("&", "&amp;");
  const text = [intro, `${button}: ${confirm}`, blurb, fallback, confirm, ignore, cancel, leave].join("\n\n");
  const html = [
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',sans-serif;font-size:15px;line-height:1.65;color:#111;max-width:560px">`,
    `<p>${intro}</p>`,
    `<p><a href="${confirmHref}" style="display:inline-block;background:#111;color:#fff;padding:10px 16px;border-radius:8px;text-decoration:none">${button}</a></p>`,
    `<p>${blurb}</p>`,
    `<p style="color:#555;font-size:13px">${fallback}<br><a href="${confirmHref}">${confirm}</a></p>`,
    `<p style="color:#555;font-size:13px">${ignore}<br>${cancel} <a href="${leaveHref}">${leave}</a></p>`,
    `</div>`,
  ].join("\n");
  return { subject, text, html };
}
