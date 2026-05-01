import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { buildAuthUrl } from "@/lib/google-oauth";
import { setOAuthState } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const state = randomBytes(16).toString("hex");
  await setOAuthState(state);
  return NextResponse.redirect(buildAuthUrl(state));
}
