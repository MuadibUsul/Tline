"use client";

import { useActionState } from "react";
import type { NewsFormState } from "./actions";

/**
 * The create/edit form. Server actions do the validation; this only renders the outcome —
 * field issues as a list, a hard error as one line. Kind defaults to "brief" because most
 * of what the desk publishes is a paragraph, not a feature.
 */
export default function NewsForm({
  action,
  labels,
  initial,
  columns,
}: {
  action: (previous: NewsFormState, formData: FormData) => Promise<NewsFormState>;
  labels: { kind: string; column: string; noColumn: string; titleZh: string; titleEn: string; bodyZh: string; bodyEn: string; sourceUrl: string; sources: string; sourcesHint: string; save: string; saving: string; hint: string; kinds: Record<string, string> };
  initial?: { id?: string; kind?: string; columnSlug?: string; titleZh?: string; titleEn?: string; bodyZh?: string; bodyEn?: string; sourceUrl?: string; sources?: string[] };
  columns: Array<{ slug: string; nameZh: string; nameEn: string | null }>;
}) {
  const [state, submit, pending] = useActionState<NewsFormState, FormData>(action, {});
  return (
    <form action={submit} className="news-form">
      {initial?.id ? <input type="hidden" name="id" value={initial.id} /> : null}
      <label className="news-field">
        <span>{labels.kind}</span>
        <select name="kind" defaultValue={initial?.kind ?? "brief"}>
          {Object.entries(labels.kinds).map(([value, label]) => <option key={value} value={value}>{label}</option>)}
        </select>
      </label>
      <label className="news-field">
        <span>{labels.column}</span>
        <select name="columnSlug" defaultValue={initial?.columnSlug ?? ""}>
          <option value="">{labels.noColumn}</option>
          {columns.map((column) => <option key={column.slug} value={column.slug}>{column.nameZh}{column.nameEn ? ` · ${column.nameEn}` : ""}</option>)}
        </select>
      </label>
      <label className="news-field">
        <span>{labels.titleZh}</span>
        <input name="titleZh" defaultValue={initial?.titleZh ?? ""} maxLength={300} />
      </label>
      <label className="news-field">
        <span>{labels.titleEn}</span>
        <input name="titleEn" defaultValue={initial?.titleEn ?? ""} maxLength={300} />
      </label>
      <label className="news-field">
        <span>{labels.bodyZh}</span>
        <textarea name="bodyZh" defaultValue={initial?.bodyZh ?? ""} rows={6} maxLength={40000} />
      </label>
      <label className="news-field">
        <span>{labels.bodyEn}</span>
        <textarea name="bodyEn" defaultValue={initial?.bodyEn ?? ""} rows={6} maxLength={40000} />
      </label>
      <label className="news-field">
        <span>{labels.sourceUrl}</span>
        <input name="sourceUrl" defaultValue={initial?.sourceUrl ?? ""} placeholder="https://…" maxLength={2000} />
      </label>
      <label className="news-field">
        <span>{labels.sources}</span>
        <textarea name="sources" defaultValue={(initial?.sources ?? []).join("\n")} rows={4} placeholder={"https://…\nhttps://…"} />
        <small className="sub meta-tertiary">{labels.sourcesHint}</small>
      </label>
      <p className="sub" style={{ margin: 0, fontSize: 11.5 }}>{labels.hint}</p>
      <button className="minibtn p" type="submit" disabled={pending}>{pending ? labels.saving : labels.save}</button>
      {state.error ? <p className="apikey-error" role="alert">{state.error}</p> : null}
      {state.issues?.length ? (
        <ul className="apikey-error list-tight" role="alert">
          {state.issues.map((issue) => <li key={issue.code}>{issue.message}</li>)}
        </ul>
      ) : null}
    </form>
  );
}
