const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

const ACTIVE_TOKENS = [
  "/JavaScript",
  "/Launch",
  "/EmbeddedFile",
  "/RichMedia",
];

function hasUnsafeOpenAction(source: string) {
  for (const match of source.matchAll(/\/OpenAction\b/g)) {
    const value = source.slice(match.index! + match[0].length);
    // A destination array only selects the initial page and zoom level.
    if (/^\s*\[/.test(value)) continue;
    const ref = /^\s*(\d+)\s+(\d+)\s+R\b/.exec(value);
    if (!ref) return true;
    const object = new RegExp(`(?:^|\\s)${ref[1]}\\s+${ref[2]}\\s+obj\\s*<<(.*?)>>\\s*endobj`, "s").exec(source);
    // An indirect local GoTo is the object form of the same inert page destination.
    if (!object || !/\/S\s*\/GoTo\b/.test(object[1]) || /\/Next\b/.test(object[1])) return true;
  }
  return false;
}

export function assertSafeSourcePdf(buffer: Buffer) {
  const configured = Number(process.env.DOCUMENT_MAX_BYTES || DEFAULT_MAX_BYTES);
  const maxBytes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
  if (buffer.byteLength > maxBytes) throw new Error(`Native PDF exceeds the ${maxBytes} byte limit.`);
  if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("Downloaded file is not a PDF.");

  const source = buffer.toString("latin1");
  if (/\/Encrypt\b/.test(source)) throw new Error("Encrypted source PDFs are not accepted.");
  const active = ACTIVE_TOKENS.find((token) => source.includes(token));
  if (active) throw new Error(`Source PDF contains unsupported active content (${active}).`);
  if (hasUnsafeOpenAction(source)) throw new Error("Source PDF contains unsupported active content (/OpenAction).");
}
