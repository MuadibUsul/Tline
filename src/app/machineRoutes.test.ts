import assert from "node:assert/strict";
import test from "node:test";
import { GET as llms } from "./llms.txt/route";

test("llms.txt is a successful UTF-8 plain-text machine response", async () => {
  const response = llms();
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("content-type"), "text/plain; charset=utf-8");
  assert.match(await response.text(), /Tlines Institutional Intelligence/);
});
