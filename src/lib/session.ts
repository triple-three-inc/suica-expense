import { cookies } from "next/headers";
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "crypto";

const COOKIE_NAME = "suica_session";
const ALGO = "aes-256-gcm";

export type FreeeAuth = {
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  companyId?: number;
  userName?: string;
  userEmail?: string;
};

export type Session = {
  // Google (primary auth)
  email: string;
  name?: string;
  picture?: string;
  accessToken: string;
  refreshToken?: string;
  expiresAt: number;
  // freee (optional)
  freee?: FreeeAuth;
};

function getKey(): Buffer {
  const secret = process.env.SESSION_SECRET;
  if (!secret) throw new Error("SESSION_SECRET is not set");
  return createHash("sha256").update(secret).digest();
}

function encrypt(plain: string): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv(ALGO, getKey(), iv);
  const enc = Buffer.concat([cipher.update(plain, "utf8"), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([iv, tag, enc]).toString("base64url");
}

function decrypt(token: string): string {
  const buf = Buffer.from(token, "base64url");
  const iv = buf.subarray(0, 12);
  const tag = buf.subarray(12, 28);
  const enc = buf.subarray(28);
  const decipher = createDecipheriv(ALGO, getKey(), iv);
  decipher.setAuthTag(tag);
  return Buffer.concat([decipher.update(enc), decipher.final()]).toString("utf8");
}

export async function getSession(): Promise<Session | null> {
  const store = await cookies();
  const c = store.get(COOKIE_NAME);
  if (!c) return null;
  try {
    return JSON.parse(decrypt(c.value)) as Session;
  } catch {
    return null;
  }
}

export async function setSession(session: Session): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, encrypt(JSON.stringify(session)), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 60 * 24 * 30,
  });
}

export async function clearSession(): Promise<void> {
  const store = await cookies();
  store.set(COOKIE_NAME, "", { path: "/", maxAge: 0 });
}

function stateCookieName(provider: string) {
  return `suica_oauth_state_${provider}`;
}

export async function setOAuthState(provider: string, state: string): Promise<void> {
  const store = await cookies();
  store.set(stateCookieName(provider), state, {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/",
    maxAge: 60 * 10,
  });
}

export async function consumeOAuthState(provider: string): Promise<string | null> {
  const store = await cookies();
  const name = stateCookieName(provider);
  const c = store.get(name);
  if (!c) return null;
  store.set(name, "", { path: "/", maxAge: 0 });
  return c.value;
}

export async function updateFreeeAuth(freee: FreeeAuth | undefined): Promise<void> {
  const current = await getSession();
  if (!current) throw new Error("先にGoogleログインが必要です");
  await setSession({ ...current, freee });
}
