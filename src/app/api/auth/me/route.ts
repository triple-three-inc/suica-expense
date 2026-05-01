import { NextResponse } from "next/server";
import { getSession } from "@/lib/session";

export const runtime = "nodejs";

export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ loggedIn: false, freee: null });
  }
  return NextResponse.json({
    loggedIn: true,
    email: session.email,
    name: session.name,
    picture: session.picture,
    freee: session.freee
      ? {
          connected: true,
          userName: session.freee.userName,
          userEmail: session.freee.userEmail,
          companyId: session.freee.companyId,
        }
      : null,
  });
}
