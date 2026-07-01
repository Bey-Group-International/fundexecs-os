import { NextResponse } from "next/server";
import { getCapitalRailProvider } from "@/lib/providers";
import type { CapitalTransferParams } from "@/lib/providers";

export const runtime = "nodejs";

// Tier 3 — operator approval must be verified upstream before calling this.
export async function POST(req: Request) {
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
