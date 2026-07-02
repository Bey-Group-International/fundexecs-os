import { NextResponse } from "next/server";
import { getCapitalRailProvider } from "@/lib/providers";
import type { CapitalTransferParams } from "@/lib/providers";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";

export async function POST(req: Request) {
  const supabase = createServerClient();
  const { data: { user }, error: authError } = await supabase.auth.getUser();
  if (authError || !user) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  try {
    const body = await req.json() as Partial<CapitalTransferParams>;
    if (!body.capitalEventId || typeof body.amountUsd !== "number" || !body.railType) {
      return NextResponse.json(
        { error: "capitalEventId, amountUsd, and railType are required" },
        { status: 400 },
      );
    }

    const provider = getCapitalRailProvider();
    const result = await provider.initiate({
      orgId: body.orgId ?? "",
      capitalEventId: body.capitalEventId,
      amountUsd: body.amountUsd,
      railType: body.railType,
      fromAccountRef: body.fromAccountRef ?? "",
      toAccountRef: body.toAccountRef ?? "",
      memo: body.memo,
      requestedBy: body.requestedBy ?? "api",
    });

    return NextResponse.json({ provider: provider.name, ...result });
  } catch (err) {
    console.error("[/api/capital/transfer]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
