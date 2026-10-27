/**
 * Ops alert → Feishu custom bot webhook.
 *
 * The production JOB_FAILURE_WEBHOOK_URL points at a Feishu custom bot, which
 * expects the custom-bot message format (`msg_type` + `content`), not a bare
 * JSON envelope. Every ops path — job failure, pipeline stall, heartbeat stale
 * — funnels through here so the format and the "no URL means skip" rule live
 * in one place.
 *
 * Importable by both plain-node scripts (.mjs) and tsx scripts (.ts).
 */

export async function sendOpsAlert(text) {
  const url = process.env.JOB_FAILURE_WEBHOOK_URL;
  if (!url) return false;
  const body = {
    msg_type: "text",
    content: { text: `[Tlines] ${text}` },
  };
  try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) {
      throw new Error(`webhook HTTP ${response.status}`);
    }
    const json = await response.json().catch(() => ({}));
    // Feishu custom bots answer { code: 0, msg: "success" } on success.
    if (json.code && json.code !== 0) {
      throw new Error(`feishu code ${json.code}: ${json.msg || "unknown"}`);
    }
    return true;
  } catch (error) {
    console.error(JSON.stringify({ event: "ops.webhook.failed", error: String(error) }));
    return false;
  }
}
