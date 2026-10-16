"use server";
import { redirect } from "next/navigation";
import { getLocale, localePath } from "@/lib/i18n";
import { asLocale, isPlausibleEmail, normalizeEmail, subscribeToNewsletter } from "@/lib/newsletter";

/**
 * The newsletter form, from the newsletter page and from every NewsletterCTA placement.
 *
 * The answer never depends on what the row already was: a new address, a repeat
 * submission and an address that is already confirmed all end at "check your inbox", so
 * the form cannot be used to learn whether someone is on the list. The form carries its
 * locale and source as hidden fields — the submitting page knows both — with the request
 * itself as the fallback.
 */
export async function subscribeAction(formData: FormData) {
  const raw = String(formData.get("email") ?? "");
  const locale = asLocale(String(formData.get("locale") ?? "")) ?? (await getLocale());
  const source = String(formData.get("source") ?? "").trim();
  const back = localePath(locale, "/newsletter");

  if (!isPlausibleEmail(raw)) redirect(`${back}?status=invalid`);

  const { outcome } = await subscribeToNewsletter({ email: normalizeEmail(raw), locale, source: source || undefined });
  // "pending" and "already" deliberately collapse into the same message.
  redirect(`${back}?status=${outcome === "invalid" ? "invalid" : "pending"}`);
}
