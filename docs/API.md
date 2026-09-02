# Public API

Read access to the platform's institutional research signal, for machine consumers.

Base URL: `https://tlines.tech/api/v1`

## What is served, and what is not

Responses carry **this platform's own analysis**: the generated summary, the extracted
views, and the direction, target and horizon each institution holds on each asset, plus
enough metadata to attribute a report and link back to the publisher.

Publisher article bodies and rendered PDFs are **not** served. Displaying licensed
third-party research on this site is not the same act as redistributing it into another
party's systems, and the API is drawn on that line deliberately. `sourceUrl` on every
report points at the publisher's own page, which is where a consumer should send anyone
who needs the original.

## Authentication

Every request needs a key issued from the operations console:

```
Authorization: Bearer tli_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx
```

A key is displayed once, at creation, and only its digest is stored — it cannot be
recovered afterwards, only replaced. Keys carry scopes (`research:read`,
`consensus:read`) and a per-minute request budget, and can be revoked at any time, which
takes effect on the next request.

### Errors

Failures return the same envelope with an HTTP status that matches:

```json
{ "error": { "code": "insufficient_scope", "message": "This API key lacks the scope for that resource." } }
```

| Status | `code` | Meaning |
| --- | --- | --- |
| 400 | `invalid_parameter`, `invalid_cursor` | A query parameter could not be read |
| 401 | `unauthorized` | Key missing, malformed or unrecognised |
| 401 | `key_revoked` | The key was revoked |
| 403 | `insufficient_scope` | The key does not carry the scope this route needs |
| 404 | `not_found` | No such report or asset |
| 429 | `rate_limited` | Budget exhausted; `Retry-After` says when to return |

### Rate limits

Every response carries the current budget:

```
X-RateLimit-Limit: 60
X-RateLimit-Remaining: 57
X-RateLimit-Reset: 1788365668
```

## `GET /research`

Scope: `research:read`. Published reports, newest first.

| Parameter | Default | Notes |
| --- | --- | --- |
| `limit` | 50 | 1–200 |
| `cursor` | — | `nextCursor` from the previous page |
| `since` / `until` | — | ISO-8601, filters on `publishedAt` |
| `institution` | — | Institution `slug` |
| `ticker` | — | Asset ticker, e.g. `SPX` |

```bash
curl -H "Authorization: Bearer $TLINE_KEY" \
  "https://tlines.tech/api/v1/research?since=2026-09-01T00:00:00Z&limit=50"
```

```json
{
  "data": [
    {
      "id": "cmtitm77i001un3fgrv5qlrbc",
      "title": { "en": "US rates chartbook", "zh": "美国利率图表手册" },
      "author": null,
      "language": "en",
      "publishedAt": "2026-09-01T12:51:54.700Z",
      "ingestedAt": "2026-09-01T13:04:11.208Z",
      "sourceUrl": "https://www.example-bank.com/research/us-rates",
      "institution": { "slug": "natixis", "name": "Natixis", "country": "FR", "authorityScore": 0.85 },
      "analysis": {
        "summary": { "en": "…", "zh": "…" },
        "keyArguments": { "en": ["…"], "zh": ["…"] },
        "keyNumbers": { "en": [{ "label": "…", "value": "…" }], "zh": [] },
        "risks": { "en": ["…"], "zh": ["…"] },
        "interpretation": { "en": "…", "zh": "…" },
        "importanceScore": 0.62,
        "confidence": 0.6
      },
      "assets": [
        {
          "ticker": "US10Y", "name": "US 10Y Treasury", "assetClass": "rate",
          "direction": 1, "directionLabel": "Bullish",
          "target": 4.2, "previousTarget": 4.0, "timeHorizon": "3M", "confidence": 0.6
        }
      ],
      "views": [
        {
          "position": 0, "type": "forecast", "asset": "US 10Y", "assetTicker": "US10Y",
          "topic": "rates", "direction": "bullish", "timeHorizon": "3M", "value": "4.2%",
          "text": { "en": "…", "zh": "…" },
          "condition": { "en": null, "zh": null },
          "rationale": { "en": "…", "zh": "…" },
          "confidence": "high", "importance": 4
        }
      ]
    }
  ],
  "nextCursor": "cmtitm7hs001abcde"
}
```

Page by passing `nextCursor` back as `cursor`; a `null` value means the end.

To follow new research, keep the newest `publishedAt` you have seen and pass it as
`since` — cheaper and more exact than re-reading from the start.

## `GET /research/{id}`

Scope: `research:read`. One report, in the shape above under `data`. A report that exists
but has not finished processing is reported as `404`.

## `GET /institutions`

Scope: `research:read`. The sources behind the `institution` filter.

```json
{ "data": [{ "slug": "anz", "name": "ANZ Research", "country": "AU", "language": "en", "authorityScore": 0.85, "reportCount": 4 }] }
```

## `GET /consensus`

Scope: `consensus:read`. Cross-institution consensus per asset. Pass `ticker` for one.

```json
{
  "data": [
    {
      "ticker": "SPX", "name": "S&P 500", "assetClass": "equity",
      "score": 38, "label": "Neutral", "tone": "neu",
      "institutionCount": 4, "bullishCount": 0, "neutralCount": 2, "bearishCount": 2,
      "isFallback": true,
      "windowStart": "2026-09-01T16:00:00.000Z",
      "windowEnd": "2026-09-02T16:00:00.000Z",
      "change": { "d1": 0, "d7": null, "d30": null }
    }
  ]
}
```

`score` runs 0–100, where 50 is neutral. `isFallback` is `true` when no research landed
in the window and an older one was used instead — a quiet asset rather than a current
reading, which is worth distinguishing before acting on a score.
