import { NextResponse, type NextRequest } from "next/server";
import { listMessages } from "@/src/admin/data";
import { serializeError } from "@/src/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  try {
    const status = req.nextUrl.searchParams.get("status") || undefined;
    const search = req.nextUrl.searchParams.get("search") || undefined;
    const items = await listMessages({ status, search });
    return NextResponse.json({ items });
  } catch (err) {
    return NextResponse.json({ error: serializeError(err) }, { status: 500 });
  }
}
