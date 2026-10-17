import assert from "node:assert/strict";
import test from "node:test";
import { imageMimeFromBytes } from "./newsImageFetch";

test("the stored image type comes from the bytes, not the response header", () => {
  assert.equal(imageMimeFromBytes(Uint8Array.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0])), "image/png");
  assert.equal(imageMimeFromBytes(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0])), "image/jpeg");
  assert.equal(imageMimeFromBytes(Buffer.from("GIF89a")), "image/gif");
  const webp = Buffer.concat([Buffer.from("RIFF"), Buffer.alloc(4), Buffer.from("WEBP")]);
  assert.equal(imageMimeFromBytes(webp), "image/webp");
  assert.equal(imageMimeFromBytes(Buffer.from("<html>not an image</html>")), null);
});
