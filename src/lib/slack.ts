import { createHmac, timingSafeEqual } from "crypto";

export function verifySlackSignature(
  timestamp: string,
  signature: string,
  rawBody: string,
): boolean {
  const secret = process.env.SLACK_SIGNING_SECRET;
  if (!secret) throw new Error("SLACK_SIGNING_SECRET is not set");

  const ts = parseInt(timestamp, 10);
  if (Number.isNaN(ts)) return false;
  if (Math.abs(Date.now() / 1000 - ts) > 60 * 5) return false;

  const baseString = `v0:${timestamp}:${rawBody}`;
  const expected = `v0=${createHmac("sha256", secret).update(baseString).digest("hex")}`;
  if (signature.length !== expected.length) return false;
  try {
    return timingSafeEqual(Buffer.from(signature), Buffer.from(expected));
  } catch {
    return false;
  }
}

const SLACK_API = "https://slack.com/api";

function botToken(): string {
  const t = process.env.SLACK_BOT_TOKEN;
  if (!t) throw new Error("SLACK_BOT_TOKEN is not set");
  return t;
}

export async function postSlackMessage(
  channel: string,
  text: string,
  options?: { thread_ts?: string; blocks?: unknown[] },
): Promise<void> {
  const res = await fetch(`${SLACK_API}/chat.postMessage`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      Authorization: `Bearer ${botToken()}`,
    },
    body: JSON.stringify({
      channel,
      text,
      thread_ts: options?.thread_ts,
      blocks: options?.blocks,
    }),
  });
  const data = (await res.json()) as { ok: boolean; error?: string };
  if (!data.ok) throw new Error(`Slack postMessage failed: ${data.error}`);
}

export async function downloadSlackFile(url: string): Promise<{
  buffer: Uint8Array;
  mimeType: string;
}> {
  const res = await fetch(url, {
    headers: { Authorization: `Bearer ${botToken()}` },
  });
  if (!res.ok) {
    throw new Error(`Slack file download failed: ${res.status}`);
  }
  const mimeType = res.headers.get("content-type") ?? "application/octet-stream";
  const buffer = new Uint8Array(await res.arrayBuffer());
  return { buffer, mimeType };
}
