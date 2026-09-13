import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "./route";

test("feishu url verification echoes the challenge verbatim before any other check", async () => {
  const request = new NextRequest("https://tlines.tech/api/social/feishu", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ type: "url_verification", challenge: "test123" }),
  });
  const response = await POST(request);
  assert.equal(response.status, 200);
  assert.match(response.headers.get("content-type") ?? "", /^application\/json\b/);
  assert.deepEqual(await response.json(), { challenge: "test123" });
});
