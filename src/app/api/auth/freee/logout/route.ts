import { NextResponse } from "next/server";
import { updateFreeeAuth } from "@/lib/session";

export const runtime = "nodejs";

export async function POST(request: Request) {
  await updateFreeeAuth(undefined);
  const origin = new URL(request.url).origin;
  return NextResponse.redirect(`${origin}/`, { status: 303 });
}
