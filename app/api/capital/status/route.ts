import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { getCapitalRailProvider } from "@/lib/providers";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(req.url);
    const transferId = searchParams.get("transferId");
    if (!transferId) {
      return NextResponse.json({ error: "transferId query param required" }, { status: 400 });
    }

    const provider = getCapitalRailProvider();
    const result = await provider.getStatus(transferId, auth.ctx.orgId);
    return NextResponse.json({ provider: provider.name, ...result });
  } catch (err) {
    console.error("[/api/capital/status]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
