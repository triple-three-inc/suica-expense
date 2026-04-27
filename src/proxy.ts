import { NextResponse } from "next/server";
import type { NextRequest } from "next/server";

export function proxy(request: NextRequest) {
  const expectedPassword = process.env.APP_PASSWORD;
  if (!expectedPassword) {
    return NextResponse.next();
  }

  const basicAuth = request.headers.get("authorization");
  if (basicAuth) {
    const [, token] = basicAuth.split(" ");
    try {
      const decoded = atob(token);
      const separatorIndex = decoded.indexOf(":");
      const pwd = decoded.slice(separatorIndex + 1);
      if (pwd === expectedPassword) {
        return NextResponse.next();
      }
    } catch {
      // fallthrough to 401
    }
  }

  return new NextResponse("Authentication required", {
    status: 401,
    headers: {
      "WWW-Authenticate": 'Basic realm="Suica Expense"',
    },
  });
}

export const config = {
  matcher: ["/((?!_next/static|_next/image|favicon.ico).*)"],
};
