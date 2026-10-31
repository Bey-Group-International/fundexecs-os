import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { getIssuanceProvider } from "@/lib/providers";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(req.url);
    const securityId = searchParams.get("securityId");
    if (!securityId) {
      return NextResponse.json({ error: "securityId query param required" }, { status: 400 });
    }

    const provider = getIssuanceProvider();
    const result = await provider.getStatus(securityId, auth.ctx.orgId);
    return NextResponse.json({ provider: provider.name, ...result });
  } catch (err) {
    console.error("[/api/issuance/status]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
