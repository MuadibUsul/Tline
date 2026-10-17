"use client";

import { useActionState } from "react";
import type { NewsFormState } from "./actions";

/**
 * Attach one image to an existing post. Position is the paragraph to insert after
 * (0 = before the first paragraph), so the original map/figure order survives.
 */
export default function ImageUploadForm({
  action,
  postId,
  slug,
  labels,
}: {
  action: (previous: NewsFormState, formData: FormData) => Promise<NewsFormState>;
  postId: string;
  slug: string;
  labels: { image: string; position: string; caption: string; alt: string; submit: string; submitting: string; hint: string };
}) {
  const [state, submit, pending] = useActionState<NewsFormState, FormData>(action, {});
  return (
    <form action={submit} className="news-form">
      <input type="hidden" name="postId" value={postId} />
      <input type="hidden" name="slug" value={slug} />
      <label className="news-field">
        <span>{labels.image}</span>
        <input name="image" type="file" accept="image/png,image/jpeg,image/webp,image/gif" required />
      </label>
      <label className="news-field">
        <span>{labels.position}</span>
        <input name="position" type="number" min={0} defaultValue={0} />
      </label>
      <label className="news-field">
        <span>{labels.caption}</span>
        <input name="caption" maxLength={300} />
      </label>
      <label className="news-field">
        <span>{labels.alt}</span>
        <input name="alt" maxLength={300} />
      </label>
      <p className="sub" style={{ margin: 0, fontSize: 11.5 }}>{labels.hint}</p>
      <button className="minibtn p" type="submit" disabled={pending}>{pending ? labels.submitting : labels.submit}</button>
      {state.error ? <p className="apikey-error" role="alert">{state.error}</p> : null}
      {state.issues?.length ? (
        <ul className="apikey-error" role="alert" style={{ margin: 0, paddingLeft: 18 }}>
          {state.issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}
        </ul>
      ) : null}
    </form>
  );
}
