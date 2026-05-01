import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";
import type { TransactionRow } from "./types";

const ALGO = "aes-256-gcm";
const TTL_MS = 60 * 60 * 1000;

type HandoffPayload = {
  rows: TransactionRow[];
  exp: number;
  source: "slack";
  slackUserId?: string;
};

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHash("sha256").update(secret).digest();
}

export function encryptHandoff(rows: TransactionRow[], slackUserId?: string): string {
  const payload: HandoffPayload = {
    rows,
    exp: Date.now() + TTL_MS,
    source: "slack",
    slackUserId,
  };
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([
    cipher.update(JSON.stringify(payload), "utf8"),
    cipher.final(),
  ]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

export function decryptHandoff(token: string): TransactionRow[] {
  const buf = Buffer.from(token, "base64url");
  if (buf.length < 28) throw new Error("invalid handoff token");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  const plain = Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
  const payload = JSON.parse(plain) as HandoffPayload;
  if (payload.exp < Date.now()) throw new Error("handoff token expired");
  return payload.rows;
}
