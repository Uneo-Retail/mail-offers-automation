import { NextResponse, type NextRequest } from "next/server";
import { getMessageDetail } from "@/src/admin/data";
import { serializeError } from "@/src/log";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(_req: NextRequest, { params }: { params: { id: string } }) {
  try {
    const detail = await getMessageDetail(decodeURIComponent(params.id));
    if (!detail) return NextResponse.json({ error: "introuvable" }, { status: 404 });
    return NextResponse.json(detail);
  } catch (err) {
    return NextResponse.json({ error: serializeError(err) }, { status: 500 });
  }
}
