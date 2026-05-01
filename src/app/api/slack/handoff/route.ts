import { NextResponse } from "next/server";
import { decryptHandoff } from "@/lib/handoff";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const token = url.searchParams.get("token");
  if (!token) {
    return NextResponse.json({ error: "missing token" }, { status: 400 });
  }
  try {
    const rows = decryptHandoff(token);
    return NextResponse.json({ rows });
  } catch (e) {
    const message = e instanceof Error ? e.message : "invalid";
    return NextResponse.json({ error: message }, { status: 400 });
  }
}
