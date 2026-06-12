import { NextResponse, type NextRequest } from "next/server";

/**
 * Authentification admin (Basic Auth) sur /admin et /api/admin.
 * Mot de passe = ADMIN_PASSWORD (côté serveur, jamais exposé au client).
 * Identifiant ignoré ; seul le mot de passe compte.
 */
export function middleware(req: NextRequest) {
  const expected = process.env.ADMIN_PASSWORD;
  if (!expected) {
    return new NextResponse("ADMIN_PASSWORD non configuré côté serveur.", { status: 500 });
  }
  const auth = req.headers.get("authorization");
  if (auth?.startsWith("Basic ")) {
    try {
      const decoded = atob(auth.slice(6));
      const pass = decoded.slice(decoded.indexOf(":") + 1);
      if (pass === expected) return NextResponse.next();
    } catch {
      /* ignore */
    }
  }
  return new NextResponse("Authentification requise.", {
    status: 401,
    headers: { "WWW-Authenticate": 'Basic realm="Console Admin Uneo", charset="UTF-8"' },
  });
}

export const config = { matcher: ["/admin/:path*", "/api/admin/:path*"] };
