import { NextResponse } from "next/server";
import { getIssuanceProvider } from "@/lib/providers";
import type { IssuanceParams } from "@/lib/providers";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = await createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

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
      orgId: body.orgId ?? "",
      dealId: body.dealId,
      securityName: body.securityName,
      offeringAmountUsd: body.offeringAmountUsd,
      investorIds: body.investorIds ?? [],
      requestedBy: body.requestedBy ?? "api",
    });

    return NextResponse.json({ provider: provider.name, ...result });
  } catch (err) {
    console.error("[/api/issuance/draft]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
