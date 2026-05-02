import { NextResponse } from "next/server";
import { exchangeFreeeCode, fetchFreeeMe } from "@/lib/freee-oauth";
import { consumeOAuthState, updateFreeeAuth } from "@/lib/session";

export const runtime = "nodejs";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const state = url.searchParams.get("state");
  const error = url.searchParams.get("error");
  const origin = url.origin;

  if (error) {
    return NextResponse.redirect(`${origin}/?freee_error=${encodeURIComponent(error)}`);
  }
  if (!code || !state) {
    return NextResponse.redirect(`${origin}/?freee_error=missing_params`);
  }

  const expectedState = await consumeOAuthState("freee");
  if (!expectedState || expectedState !== state) {
    return NextResponse.redirect(`${origin}/?freee_error=state_mismatch`);
  }

  try {
    const tokens = await exchangeFreeeCode(code);
    const me = await fetchFreeeMe(tokens.access_token);
    const defaultCompany =
      me.user.companies?.find((c) => c.default_company) ?? me.user.companies?.[0];
    const companyId = tokens.company_id ?? defaultCompany?.id;

    await updateFreeeAuth({
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000,
      companyId,
      userName: me.user.display_name,
      userEmail: me.user.email,
    });
    return NextResponse.redirect(`${origin}/`);
  } catch (err) {
    const message = err instanceof Error ? err.message : "unknown";
    return NextResponse.redirect(`${origin}/?freee_error=${encodeURIComponent(message)}`);
  }
}
