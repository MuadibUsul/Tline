import assert from "node:assert/strict";
import test from "node:test";
import { NextRequest } from "next/server";
import { POST } from "./route";

test("feishu url verification echoes the challenge verbatim before any other check", async () => {
  const request = new NextRequest("https://tlines.tech/api/social/feishu", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ challenge: "test123456", type: "url_verification", token: "test-token" }),
  });
  const response = await POST(request);
  assert.equal(response.status, 200);
  assert.deepEqual(await response.json(), { challenge: "test123456" });
});
