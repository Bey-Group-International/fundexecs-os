import { NextResponse } from "next/server";
import { getCapitalRailProvider } from "@/lib/providers";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const supabase = createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const { searchParams } = new URL(req.url);
    const transferId = searchParams.get("transferId");
    if (!transferId) {
      return NextResponse.json({ error: "transferId query param required" }, { status: 400 });
    }

    const provider = getCapitalRailProvider();
    const result = await provider.getStatus(transferId);
    return NextResponse.json({ provider: provider.name, ...result });
  } catch (err) {
    console.error("[/api/capital/status]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
