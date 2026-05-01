import type { FreeeAuth } from "./session";
import { updateFreeeAuth } from "./session";

const AUTH_URL = "https://accounts.secure.freee.co.jp/public_api/authorize";
const TOKEN_URL = "https://accounts.secure.freee.co.jp/public_api/token";
const ME_URL = "https://api.freee.co.jp/api/1/users/me";

function requireEnv(name: string): string {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
}

export function buildFreeeAuthUrl(state: string): string {
  const params = new URLSearchParams({
    client_id: requireEnv("FREEE_CLIENT_ID"),
    redirect_uri: requireEnv("FREEE_REDIRECT_URI"),
    response_type: "code",
    state,
  });
  return `${AUTH_URL}?${params.toString()}`;
}

type TokenResponse = {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  scope?: string;
  token_type?: string;
  company_id?: number;
};

export async function exchangeFreeeCode(code: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "authorization_code",
      code,
      client_id: requireEnv("FREEE_CLIENT_ID"),
      client_secret: requireEnv("FREEE_CLIENT_SECRET"),
      redirect_uri: requireEnv("FREEE_REDIRECT_URI"),
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`freee token exchange failed: ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

export async function refreshFreeeToken(refreshToken: string): Promise<TokenResponse> {
  const res = await fetch(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({
      grant_type: "refresh_token",
      refresh_token: refreshToken,
      client_id: requireEnv("FREEE_CLIENT_ID"),
      client_secret: requireEnv("FREEE_CLIENT_SECRET"),
    }).toString(),
  });
  if (!res.ok) {
    throw new Error(`freee token refresh failed: ${await res.text()}`);
  }
  return (await res.json()) as TokenResponse;
}

type FreeeMe = {
  user: {
    id: number;
    email: string;
    display_name?: string;
    companies?: Array<{ id: number; name: string; role: string; default_company?: boolean }>;
  };
};

export async function fetchFreeeMe(accessToken: string): Promise<FreeeMe> {
  const res = await fetch(ME_URL, {
    headers: { Authorization: `Bearer ${accessToken}` },
  });
  if (!res.ok) throw new Error(`freee /users/me failed: ${await res.text()}`);
  return (await res.json()) as FreeeMe;
}

export async function ensureFreshFreeeAuth(auth: FreeeAuth): Promise<FreeeAuth> {
  const skewMs = 60 * 1000;
  if (auth.expiresAt - skewMs > Date.now()) return auth;
  if (!auth.refreshToken) throw new Error("freeeのリフレッシュトークンが無いので再ログインが必要");
  const t = await refreshFreeeToken(auth.refreshToken);
  const refreshed: FreeeAuth = {
    ...auth,
    accessToken: t.access_token,
    refreshToken: t.refresh_token ?? auth.refreshToken,
    expiresAt: Date.now() + t.expires_in * 1000,
  };
  await updateFreeeAuth(refreshed);
  return refreshed;
}
