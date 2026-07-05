import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { requireOrgAdmin } from "@/lib/rbac";
import { evaluateRoutingGoldens } from "@/lib/intelligence-eval";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = requireOrgAdmin(auth.ctx.role);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    routing: evaluateRoutingGoldens(),
  });
}
