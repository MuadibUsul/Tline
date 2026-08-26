import assert from "node:assert/strict";
import test from "node:test";
import { writePrivateFile } from "./storage";

test("private storage rejects traversal", async () => {
  await assert.rejects(() => writePrivateFile("../outside.pdf", Buffer.from("x")), /Invalid private storage key/);
});
