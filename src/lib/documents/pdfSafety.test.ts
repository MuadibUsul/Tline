import assert from "node:assert/strict";
import test from "node:test";
import { assertSafeSourcePdf } from "./pdfSafety";

test("accepts an inert PDF signature", () => {
  assert.doesNotThrow(() => assertSafeSourcePdf(Buffer.from("%PDF-1.7\n1 0 obj\n<<>>\nendobj")));
});

test("rejects active content and encrypted source PDFs", () => {
  assert.throws(() => assertSafeSourcePdf(Buffer.from("%PDF-1.7\n/JavaScript")), /active content/);
  assert.throws(() => assertSafeSourcePdf(Buffer.from("%PDF-1.7\n/OpenAction 2 0 R\n2 0 obj\n<</S /URI /URI (https:\/\/example.com)>>\nendobj")), /active content/);
  assert.throws(() => assertSafeSourcePdf(Buffer.from("%PDF-1.7\n/Encrypt 4 0 R")), /Encrypted/);
});

test("allows inert initial-page destinations", () => {
  assert.doesNotThrow(() => assertSafeSourcePdf(Buffer.from("%PDF-1.7\n/OpenAction [3 0 R /XYZ null null 1]")));
  assert.doesNotThrow(() => assertSafeSourcePdf(Buffer.from("%PDF-1.7\n/OpenAction 2 0 R\n2 0 obj\n<</D [3 0 R /Fit] /S /GoTo>>\nendobj")));
});
