import assert from "node:assert/strict";
import test from "node:test";
import { prisma } from "./db";
import { endpointOf, flushApiUsage, recordApiCall, resetApiUsage } from "./apiUsage";
import { dayKey } from "./analytics/identity";

test("identifiers are folded out of the endpoint, so the breakdown stays readable", () => {
  assert.equal(endpointOf("https://x.test/api/v1/research/cmtaez8fb000013i4baqusdyk"), "/api/v1/research/{id}");
  assert.equal(endpointOf("https://x.test/api/v1/research/1234"), "/api/v1/research/{id}");
  assert.equal(endpointOf("https://x.test/api/v1/research?limit=50"), "/api/v1/research");
  assert.equal(endpointOf("https://x.test/api/v1/institutions"), "/api/v1/institutions");
});

test("a short path segment is a route, not an identifier", () => {
  // "consensus" is nine characters; the cut-off must not swallow real route names.
  assert.equal(endpointOf("https://x.test/api/v1/consensus"), "/api/v1/consensus");
});

test("an unparseable url is bucketed rather than thrown away", () => {
  assert.equal(endpointOf("not a url"), "unknown");
});

test("repeated calls collapse into one counter row and accumulate across flushes", async (t) => {
  const endpoint = "/api/v1/__test__";
  const day = dayKey();
  const clear = () => prisma.apiUsageDaily.deleteMany({ where: { endpoint } });
  resetApiUsage();
  await clear();
  t.after(async () => {
    resetApiUsage();
    await clear();
  });

  recordApiCall("k1", endpoint, 200, 10);
  recordApiCall("k1", endpoint, 200, 30);
  // A different status is a different row: an error rate is only visible if failures are
  // counted apart from successes.
  recordApiCall("k1", endpoint, 429, 1);
  // An unauthenticated call has no key, and must still be counted rather than dropped.
  recordApiCall(null, endpoint, 401, 2);
  assert.equal(await flushApiUsage(), 3);

  const ok = await prisma.apiUsageDaily.findUnique({
    where: { day_keyId_endpoint_status: { day, keyId: "k1", endpoint, status: 200 } },
  });
  assert.equal(ok?.count, 2);
  assert.equal(ok?.totalMs, 40);

  const anonymous = await prisma.apiUsageDaily.findUnique({
    where: { day_keyId_endpoint_status: { day, keyId: "", endpoint, status: 401 } },
  });
  assert.equal(anonymous?.count, 1);

  // A second window adds to the existing row instead of inserting beside it — the case a
  // nullable keyId would silently get wrong for the anonymous row.
  recordApiCall("k1", endpoint, 200, 20);
  recordApiCall(null, endpoint, 401, 5);
  await flushApiUsage();
  assert.equal((await prisma.apiUsageDaily.count({ where: { endpoint } })), 3);
  assert.equal((await prisma.apiUsageDaily.findUnique({
    where: { day_keyId_endpoint_status: { day, keyId: "k1", endpoint, status: 200 } },
  }))?.count, 3);
  assert.equal((await prisma.apiUsageDaily.findUnique({
    where: { day_keyId_endpoint_status: { day, keyId: "", endpoint, status: 401 } },
  }))?.count, 2);
});

test("flushing an empty buffer writes nothing", async () => {
  resetApiUsage();
  assert.equal(await flushApiUsage(), 0);
});

test.after(() => prisma.$disconnect());
