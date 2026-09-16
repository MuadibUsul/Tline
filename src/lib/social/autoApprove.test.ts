import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import test from "node:test";
import { AUTO_APPROVE_SETTING, autoApprovalRefusal, type AutoApprovalInput } from "./autoApprove";
import { draftCard } from "./feishu";

const value = (over: Partial<AutoApprovalInput["values"][number]> = {}) => ({
  actualInitial: { toString: () => "423429" },
  previousAtRelease: { toString: () => "424069" },
  consensusAtRelease: { toString: () => "421000" },
  ...over,
});

const input = (over: Partial<AutoApprovalInput> = {}): AutoApprovalInput => ({
  importance: 5,
  values: [value()],
  analysisEn: "Read-out in English.",
  analysisZh: "中文解读。",
  analysisAt: new Date("2026-09-16T14:31:00.000Z"),
  textEn: "DATA | Weekly Petroleum Status Report\nactual 423429 | consensus 421000 | previous 424069",
  textZh: "数据公布 | 美国每周石油状况报告",
  ...over,
});

test("a complete five-star release publishes without a reviewer", () => {
  assert.equal(autoApprovalRefusal(input()), null);
});

test("only five-star releases are eligible, whatever the switch says", () => {
  assert.match(autoApprovalRefusal(input({ importance: 4 }))!, /not a five-star/);
});

test("a missing previous value, consensus or actual holds the draft", () => {
  assert.match(autoApprovalRefusal(input({ values: [value({ consensusAtRelease: null })] }))!, /no survey consensus/);
  assert.match(autoApprovalRefusal(input({ values: [value({ previousAtRelease: null })] }))!, /no previous value/);
  assert.match(autoApprovalRefusal(input({ values: [] }))!, /no captured value/);
});

test("an incomplete bilingual read-out holds the draft", () => {
  assert.match(autoApprovalRefusal(input({ analysisZh: "  " }))!, /read-out/);
  assert.match(autoApprovalRefusal(input({ analysisAt: null }))!, /read-out/);
});

test("a post that fails the publishing rules holds the draft", () => {
  assert.match(autoApprovalRefusal(input({ textEn: "DATA | x\nsee https://tlines.tech" }))!, /URL/);
  assert.match(autoApprovalRefusal(input({ textZh: "稳赚" }))!, /prohibited/);
});

test("the gate looks at the series the post prints, not every indicator of the release", () => {
  // A third series without previous/consensus is not printed by the post, so it does not
  // hold a release whose printed numbers are complete.
  const extra = value({ consensusAtRelease: null, previousAtRelease: null });
  assert.equal(autoApprovalRefusal(input({ values: [value(), value(), extra] })), null);
  // But a missing consensus on the first two printed series does.
  assert.match(autoApprovalRefusal(input({ values: [value(), value({ consensusAtRelease: null }), extra] }))!, /no survey consensus/);
});

test("the switch is stored under one key and defaults to off", async () => {
  // An absent row has to read as off: this posts to a public account.
  assert.equal(AUTO_APPROVE_SETTING, "social.auto_approve_importance_5");
  const source = readFileSync(new URL("./autoApprove.ts", import.meta.url), "utf8");
  assert.match(source, /return row\?\.value === "on"/);
});

test("the cycle approves before it notifies, so the card announces a published post", () => {
  const pipeline = readFileSync(new URL("./pipeline.ts", import.meta.url), "utf8");
  const approve = pipeline.indexOf("await autoApproveDrafts()");
  const notify = pipeline.indexOf("await notifyDrafts()");
  assert.ok(approve > 0 && notify > 0 && approve < notify, "auto-approval must run before notification");
});

test("an automatically approved draft gets a notification card without decision buttons", () => {
  const base = { id: "draft_1", title: "美国每周石油状况报告", textEn: "English", textZh: "中文", version: 2, status: "PUBLISHING", approvalMode: "auto", routeSnapshot: JSON.stringify([{ label: "中文账号", language: "zh-CN" }]) };
  const card = draftCard({ ...base, deliveries: [{ status: "SUCCEEDED", lastError: null, mainPostId: "1", replyPostId: "2", account: { label: "中文账号", externalUsername: "tlines" } }] });
  const elements = card.body.elements as Array<Record<string, unknown>>;
  assert.equal(elements.some((element) => element.tag === "button"), false);
  const text = JSON.stringify(card);
  assert.match(text, /已自动发布/);
  assert.match(text, /五级数据/);
  // The group is still told what went out: the published text and the result are there.
  assert.match(text, /中文/);
  assert.match(text, /发布结果/);
});

test("a manually reviewed draft keeps its approval buttons", () => {
  const card = draftCard({ id: "draft_2", title: "标题", textEn: "English", textZh: "中文", version: 1, status: "PENDING_REVIEW", approvalMode: "manual" });
  const elements = card.body.elements as Array<Record<string, unknown>>;
  assert.equal(elements.filter((element) => element.tag === "button").length, 3);
  assert.match(JSON.stringify(card), /发布审核/);
});
