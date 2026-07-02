import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { searchNetwork } from "@/lib/network-search";

export const dynamic = "force-dynamic";

export async function GET(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const q = req.nextUrl.searchParams.get("q") ?? "";
  const limit = Math.min(50, parseInt(req.nextUrl.searchParams.get("limit") ?? "20", 10));

  if (!q.trim()) return NextResponse.json({ results: [] });

  try {
    const results = await searchNetwork(q, limit);
    return NextResponse.json({ results });
  } catch (err) {
    console.error("[network/search]", err);
    return NextResponse.json({ error: "Search failed" }, { status: 500 });
  }
}
