/**
 * One HTTP byte range, or the reason it cannot be served.
 *
 * Only the single-range form is supported: pdf.js asks for exactly that, and a
 * multipart/byteranges response would add a second parser for no reader benefit. An
 * unparseable or multi-range header returns null so the caller serves the whole file,
 * which is always a valid HTTP answer.
 */
export interface ByteRange { start: number; end: number }

export type ParsedRange = ByteRange | "unsatisfiable" | null;

export function parseRangeHeader(header: string | null, size: number): ParsedRange {
  if (!header) return null;
  if (size <= 0) return "unsatisfiable";
  const match = /^bytes=(\d*)-(\d*)$/.exec(header.trim());
  if (!match) return null;
  const [, rawStart, rawEnd] = match;
  if (!rawStart && !rawEnd) return "unsatisfiable";

  let start: number;
  let end: number;
  if (!rawStart) {
    const suffix = Number(rawEnd);
    if (!Number.isFinite(suffix) || suffix <= 0) return "unsatisfiable";
    start = Math.max(0, size - suffix);
    end = size - 1;
  } else {
    start = Number(rawStart);
    end = rawEnd ? Number(rawEnd) : size - 1;
  }
  if (!Number.isFinite(start) || !Number.isFinite(end) || start > end || start >= size) return "unsatisfiable";
  return { start, end: Math.min(end, size - 1) };
}
