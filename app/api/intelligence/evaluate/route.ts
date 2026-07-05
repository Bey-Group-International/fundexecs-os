import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { requireOrgAdmin } from "@/lib/rbac";
import { evaluateRoutingGoldens } from "@/lib/intelligence-eval";
import { RESEARCH_OUTPUT_COLUMNS, shouldUseBrowserResearch } from "@/lib/research-intelligence";

export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const admin = requireOrgAdmin(auth.ctx.role);
  if (!admin.ok) return NextResponse.json({ error: admin.error }, { status: admin.status });

  return NextResponse.json({
    generated_at: new Date().toISOString(),
    routing: evaluateRoutingGoldens(),
    research_output_standard: {
      required_columns: RESEARCH_OUTPUT_COLUMNS,
      browser_required_for: [
        "current external information",
        "company/contact verification",
        "sourcing and market mapping",
        "competitor or partner research",
      ],
      sample_browser_decision: shouldUseBrowserResearch("Source acquisition targets and verify founder contacts"),
    },
  });
}
