import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { getIdentityVerificationProvider } from "@/lib/providers";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  try {
    const { searchParams } = new URL(req.url);
    const verificationId = searchParams.get("verificationId");
    if (!verificationId) {
      return NextResponse.json({ error: "verificationId query param required" }, { status: 400 });
    }

    const provider = getIdentityVerificationProvider();
    const result = await provider.getStatus(verificationId, auth.ctx.orgId);
    return NextResponse.json({ provider: provider.name, ...result });
  } catch (err) {
    console.error("[/api/identity/status]", err);
    return NextResponse.json({ error: String(err) }, { status: 500 });
  }
}
