const DEFAULT_MAX_BYTES = 50 * 1024 * 1024;

const ACTIVE_TOKENS = [
  "/JavaScript",
  "/Launch",
  "/EmbeddedFile",
  "/RichMedia",
  "/OpenAction",
];

export function assertSafeSourcePdf(buffer: Buffer) {
  const configured = Number(process.env.DOCUMENT_MAX_BYTES || DEFAULT_MAX_BYTES);
  const maxBytes = Number.isFinite(configured) && configured > 0 ? configured : DEFAULT_MAX_BYTES;
  if (buffer.byteLength > maxBytes) throw new Error(`Native PDF exceeds the ${maxBytes} byte limit.`);
  if (!buffer.subarray(0, 1024).includes(Buffer.from("%PDF-"))) throw new Error("Downloaded file is not a PDF.");

  const source = buffer.toString("latin1");
  if (/\/Encrypt\b/.test(source)) throw new Error("Encrypted source PDFs are not accepted.");
  const active = ACTIVE_TOKENS.find((token) => source.includes(token));
  if (active) throw new Error(`Source PDF contains unsupported active content (${active}).`);
}
