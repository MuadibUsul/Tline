import assert from "node:assert/strict";
import test from "node:test";

test("S3 storage returns a short-lived signed private download URL", async () => {
  process.env.DOCUMENT_STORAGE_DRIVER = "s3";
  process.env.S3_BUCKET = "private-tline-test";
  process.env.S3_REGION = "us-east-1";
  process.env.AWS_ACCESS_KEY_ID = "test-access-key";
  process.env.AWS_SECRET_ACCESS_KEY = "test-secret-key";
  process.env.S3_SIGNED_URL_TTL_SECONDS = "60";
  const { privateDownloadUrl } = await import("./storage");
  const url = await privateDownloadUrl("articles/a1/original.pdf", "Research.pdf", "application/pdf");
  assert.ok(url);
  const signed = new URL(url);
  assert.match(signed.hostname, /private-tline-test/);
  assert.equal(signed.searchParams.get("X-Amz-Expires"), "60");
  assert.equal(signed.searchParams.get("response-content-type"), "application/pdf");
});
