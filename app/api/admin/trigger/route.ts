import { NextResponse, type NextRequest } from "next/server";
import { serializeError } from "@/src/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Déclenche un traitement maintenant : appelle /api/poll avec le CRON_SECRET
 * (qui reste côté serveur). Protégé par le middleware admin.
 */
export async function POST(req: NextRequest) {
  try {
    const secret = process.env.CRON_SECRET;
    const url = new URL("/api/poll", req.nextUrl.origin).toString();
    const res = await fetch(url, {
      headers: secret ? { authorization: `Bearer ${secret}` } : {},
    });
    const body = await res.text();
    return new NextResponse(body, {
      status: res.status,
      headers: { "content-type": res.headers.get("content-type") ?? "application/json" },
    });
  } catch (err) {
    return NextResponse.json({ ok: false, error: serializeError(err) }, { status: 500 });
  }
}
