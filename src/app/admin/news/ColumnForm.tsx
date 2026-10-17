"use client";

import { useActionState } from "react";
import type { NewsFormState } from "./actions";

/** Create a recurring column. Editing a column is not needed yet; its slug is permanent. */
export default function ColumnForm({
  action,
  labels,
}: {
  action: (previous: NewsFormState, formData: FormData) => Promise<NewsFormState>;
  labels: { slug: string; nameZh: string; nameEn: string; descriptionZh: string; descriptionEn: string; cadence: string; submit: string; submitting: string; cadences: Record<string, string> };
}) {
  const [state, submit, pending] = useActionState<NewsFormState, FormData>(action, {});
  return (
    <form action={submit} className="news-form">
      <label className="news-field">
        <span>{labels.slug}</span>
        <input name="slug" required pattern="[a-z0-9]+(?:-[a-z0-9]+)*" placeholder="ukraine-war-brief" maxLength={60} />
      </label>
      <label className="news-field">
        <span>{labels.nameZh}</span>
        <input name="nameZh" required maxLength={80} placeholder="俄乌战场简报" />
      </label>
      <label className="news-field">
        <span>{labels.nameEn}</span>
        <input name="nameEn" maxLength={80} placeholder="Ukraine War Brief" />
      </label>
      <label className="news-field">
        <span>{labels.descriptionZh}</span>
        <textarea name="descriptionZh" rows={3} maxLength={500} />
      </label>
      <label className="news-field">
        <span>{labels.descriptionEn}</span>
        <textarea name="descriptionEn" rows={3} maxLength={500} />
      </label>
      <label className="news-field">
        <span>{labels.cadence}</span>
        <select name="cadence" defaultValue="daily">
          {Object.entries(labels.cadences).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
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
