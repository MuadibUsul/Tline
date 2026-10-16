"use client";

import Link from "next/link";
import { useActionState } from "react";
import { usePathname } from "next/navigation";
import { toggleBookmarkAction, type BookmarkFormState } from "@/app/actions";
import type { Locale } from "@/lib/i18n";

/**
 * Save a report, or unsave one already saved, from the page it is read on.
 *
 * Signed out, this renders as a plain link and nothing else — no JS runs, no state is
 * hidden: the reader is sent to sign in and comes back to this very address, because
 * `next` is the path they are on.
 *
 * Signed in, it is a button driven by the action's own result: the label and `aria-pressed`
 * follow the state the server reported, so the next press's meaning is announced as well as
 * shown.
 */
/**
 * Client components do not import @/lib/i18n: that module carries next/headers, which
 * cannot enter a client bundle. The convention across the site is a local label table —
 * the same strings the server would have rendered.
 */
const TXT = {
  en: { signIn: "Sign in to save", save: "Bookmark", saved: "Bookmarked", unauthorised: "Sign in first.", failed: "That did not work. Try again." },
  "zh-CN": { signIn: "登录后收藏", save: "收藏", saved: "已收藏", unauthorised: "请先登录。", failed: "操作失败，请重试。" },
} as const;

export default function BookmarkButton({
  articleId,
  initialBookmarked,
  signedIn,
  locale,
}: {
  articleId: string;
  initialBookmarked: boolean;
  signedIn: boolean;
  locale: Locale;
}) {
  const pathname = usePathname() ?? "/";
  const t = TXT[locale];
  const [state, action, pending] = useActionState<BookmarkFormState, FormData>(toggleBookmarkAction, { bookmarked: initialBookmarked });

  if (!signedIn) {
    return (
      <Link className="minibtn" href={`/signin?next=${encodeURIComponent(pathname)}`}>
        {t.signIn}
      </Link>
    );
  }

  // An error response carries no state, so the last known truth is the initial one.
  const bookmarked = state.bookmarked ?? initialBookmarked;
  return (
    <form action={action} style={{ display: "inline" }}>
      <input type="hidden" name="articleId" value={articleId} />
      {/* The page the button sits on, so the action can revalidate it. */}
      <input type="hidden" name="path" value={pathname} />
      <button
        className={bookmarked ? "minibtn" : "minibtn p"}
        type="submit"
        aria-pressed={bookmarked}
        disabled={pending}
      >
        {bookmarked ? t.saved : t.save}
      </button>
      {state.error && (
        <p className="chip bear" role="alert" style={{ display: "inline-block", marginLeft: 8 }}>
          {state.error === "unauthorised"
            ? t.unauthorised
            : t.failed}
        </p>
      )}
    </form>
  );
}
