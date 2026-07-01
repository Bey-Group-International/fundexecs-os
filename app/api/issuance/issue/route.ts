import { NextResponse } from "next/server";
import { getIssuanceProvider } from "@/lib/providers";

export const runtime = "nodejs";

// Tier 3 — operator approval must be verified upstream before calling this.
export async function POST(req: Request) {
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
