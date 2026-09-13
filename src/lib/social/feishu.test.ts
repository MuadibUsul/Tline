import assert from "node:assert/strict";
import { createCipheriv, createHash, randomBytes } from "node:crypto";
import test from "node:test";
import { approverAllowed, decryptFeishuPayload, draftCard, feishuConfigStatus, feishuSignature, mergeFeishuSettings, requireMessageReceiver, type FeishuFormInput, type FeishuSettings } from "./feishu";

const empty: FeishuSettings = { appId: "", appSecret: "", encryptKey: "", verificationToken: "", receiveId: "", receiveIdType: "open_id", approverOpenIds: "", source: "none" };

function form(overrides: Partial<FeishuFormInput> = {}): FeishuFormInput {
  return { appId: "", appSecret: "", encryptKey: "", verificationToken: "", receiveId: "", receiveIdType: "open_id", approverOpenIds: "", ...overrides };
}

function settingsOf(result: ReturnType<typeof mergeFeishuSettings>) {
  if ("error" in result) assert.fail(`unexpected validation error: ${result.error}`);
  return result.settings;
}

test("A: app id and app secret alone save a basic configuration", () => {
  const settings = settingsOf(mergeFeishuSettings(form({ appId: "cli_test", appSecret: "secret_test" }), empty));
  assert.deepEqual(settings, { appId: "cli_test", appSecret: "secret_test", encryptKey: "", verificationToken: "", receiveId: "", receiveIdType: "open_id", approverOpenIds: "" });
});

test("B: an empty recipient id does not block saving", () => {
  const settings = settingsOf(mergeFeishuSettings(form({ appId: "cli_test", appSecret: "secret_test", receiveId: "" }), empty));
  assert.equal(settings.receiveId, "");
});

test("a save with neither app id nor stored secret is still rejected", () => {
  assert.deepEqual(mergeFeishuSettings(form({ appId: "cli_test" }), empty), { error: "请填写 App ID 和 App Secret。" });
  assert.deepEqual(mergeFeishuSettings(form(), empty), { error: "请填写 App ID 和 App Secret。" });
});

test("C: clearing the encrypt key writes empty to storage instead of keeping the old value", () => {
  const current: FeishuSettings = { ...empty, encryptKey: "stored-key" };
  assert.equal(settingsOf(mergeFeishuSettings(form({ appId: "cli_test", appSecret: "secret_test" }), current)).encryptKey, "");
  assert.equal(settingsOf(mergeFeishuSettings(form({ appId: "cli_test", appSecret: "secret_test", encryptKey: "new-key" }), current)).encryptKey, "new-key");
});

test("D: sending with an empty recipient id fails with the configured message, never a server error", () => {
  assert.throws(() => requireMessageReceiver({ receiveId: "" }), /尚未配置飞书消息接收 ID/);
  assert.equal(requireMessageReceiver({ receiveId: "ou_test" }), "ou_test");
});

test("E: an empty reviewer whitelist rejects every approval action", () => {
  assert.equal(approverAllowed(null, ""), false);
  assert.equal(approverAllowed("ou_1", ""), false);
  assert.equal(approverAllowed("ou_1", " , "), false);
  assert.equal(approverAllowed("ou_1", " ou_1 , ou_2 "), true);
  assert.equal(approverAllowed("ou_3", "ou_1,ou_2"), false);
});

test("configuration status follows completeness", () => {
  assert.equal(feishuConfigStatus(empty), "none");
  assert.equal(feishuConfigStatus({ ...empty, appId: "cli", appSecret: "s" }), "basic");
  assert.equal(feishuConfigStatus({ ...empty, appId: "cli", appSecret: "s", receiveId: "ou_r" }), "receiver_pending");
  assert.equal(feishuConfigStatus({ ...empty, appId: "cli", appSecret: "s", approverOpenIds: "ou_a" }), "receiver_pending");
  assert.equal(feishuConfigStatus({ ...empty, appId: "cli", appSecret: "s", receiveId: "ou_r", approverOpenIds: "ou_a" }), "complete");
});

test("encrypted Feishu payloads use the official IV-prefixed AES format", () => {
  const encryptKey = "test-encrypt-key";
  const plaintext = JSON.stringify({ type: "url_verification", challenge: "test123" });
  const iv = randomBytes(16);
  const cipher = createCipheriv("aes-256-cbc", createHash("sha256").update(encryptKey).digest(), iv);
  const encrypt = Buffer.concat([iv, cipher.update(plaintext), cipher.final()]).toString("base64");
  assert.equal(decryptFeishuPayload(encrypt, encryptKey), plaintext);
});

test("review card uses schema 2.0 buttons instead of the legacy action container", () => {
  const base = { id: "draft_1", title: "标题", textEn: "English", textZh: "中文", version: 3, deliveries: [] };
  const card = draftCard({ ...base, status: "PENDING_REVIEW" });
  assert.equal(card.schema, "2.0");
  const elements = card.body.elements as Array<Record<string, unknown>>;
  assert.ok(elements.every((element) => element.tag !== "action" && !("actions" in element) && element.tag !== "note"), "no legacy action container or note element");
  const buttons = elements.filter((element) => element.tag === "button");
  assert.equal(buttons.length, 3);
  const behaviors = (element: Record<string, unknown>) => element.behaviors as Array<Record<string, unknown>>;
  assert.equal(behaviors(buttons[0])[0].type, "callback");
  assert.deepEqual(behaviors(buttons[0])[0].value, { action: "approve", draftId: "draft_1", version: 3 });
  assert.deepEqual(behaviors(buttons[1])[0].value, { action: "reject", draftId: "draft_1", version: 3 });
  assert.equal(behaviors(buttons[2])[0].type, "open_url");
  assert.match(String(behaviors(buttons[2])[0].default_url), /admin\/social\/draft_1/);
  const hint = elements.find((element) => element.tag === "div") as { text: Record<string, unknown> } | undefined;
  assert.equal((hint?.text as { text_size?: string }).text_size, "notation");
  const done = draftCard({ ...base, status: "SUCCEEDED" });
  assert.ok((done.body.elements as Array<Record<string, unknown>>).every((element) => element.tag !== "button"));
});

test("signature matches the official sha256(timestamp+nonce+encrypt_key+body), including an empty key", () => {
  const timestamp = "1726223600";
  const nonce = "nonce-1";
  const body = '{"type":"card.action.trigger","event":{"action":{"value":{"action":"approve"}}}}';
  const expected = createHash("sha256").update(timestamp + nonce + body).digest("hex");
  assert.equal(feishuSignature(timestamp, nonce, "", body), expected);
  assert.notEqual(feishuSignature(timestamp, nonce, "some-key", body), expected);
});
