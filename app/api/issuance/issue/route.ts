import { NextResponse } from "next/server";
import { getIssuanceProvider } from "@/lib/providers";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json() as { securityId?: string; requestedBy?: string };
    if (!body.securityId) {
      return NextResponse.json({ error: "securityId is required" }, { status: 400 });
    }

    const provider = getIssuanceProvider();
    const result = await provider.issueSecurity(
      body.securityId,
      body.requestedBy ?? "api",
    );

    return NextResponse.json({ provider: provider.name, ...result });
  } catch (err) {
    console.error("[/api/issuance/issue]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
