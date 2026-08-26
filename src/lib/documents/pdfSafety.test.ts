import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeSourcePdf } from "./pdfSafety";

test("accepts an inert PDF signature", () => {
  assert.doesNotThrow(() => assertSafeSourcePdf(Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj")));
});

test("rejects active content and encrypted source PDFs", () => {
  assert.throws(() => assertSafeSourcePdf(Buffer.from("%PDF-1.7\n/JavaScript")), /active content/);
  assert.throws(() => assertSafeSourcePdf(Buffer.from("%PDF-1.7\n/Encrypt 4 0 R")), /Encrypted/);
});
