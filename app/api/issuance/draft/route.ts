import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { getIssuanceProvider } from "@/lib/providers";
import type { IssuanceParams } from "@/lib/providers";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const body = await req.json() as Partial<IssuanceParams>;
    if (!body.dealId || !body.securityName || typeof body.offeringAmountUsd !== "number") {
      return NextResponse.json(
        { error: "dealId, securityName, and offeringAmountUsd are required" },
        { status: 400 },
      );
    }

    const provider = getIssuanceProvider();
    const result = await provider.draftSecurity({
      orgId: auth.ctx.orgId,
      dealId: body.dealId,
      securityName: body.securityName,
      offeringAmountUsd: body.offeringAmountUsd,
      investorIds: body.investorIds ?? [],
      requestedBy: auth.ctx.userId,
    });

    return NextResponse.json({ provider: provider.name, ...result });
  } catch (err) {
    console.error("[/api/issuance/draft]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
