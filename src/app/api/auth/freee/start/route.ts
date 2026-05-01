import { NextResponse } from "next/server";
import { randomBytes } from "crypto";
import { buildFreeeAuthUrl } from "@/lib/freee-oauth";
import { setOAuthState } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const state = randomBytes(16).toString("hex");
  await setOAuthState("freee", state);
  return NextResponse.redirect(buildFreeeAuthUrl(state));
}
