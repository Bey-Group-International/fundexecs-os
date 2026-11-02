import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { buildExecutedPdf, copyTokenValid } from "@/lib/lp-subscription-signing.server";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One executed (or LP-signed) subscription agreement as a PDF. Two ways in:
//  - the LP, who has no account, with the token from the copy we emailed them
//    (an HMAC of this session's id, so it opens this agreement only);
//  - a member of the fund that owns the session, through their own session and
//    row-level security.
export async function GET(req: Request, props: { params: Promise<{ sessionId: string }> }) {
  const { sessionId } = await props.params;
  if (!UUID.test(sessionId)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const token = new URL(req.url).searchParams.get("t");

  let built = null;
  if (token) {
    if (!copyTokenValid(sessionId, token) || !hasSupabaseServiceEnv()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    built = await buildExecutedPdf(createServiceClient(), sessionId);
  } else {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    built = await buildExecutedPdf(await createServerClient(), sessionId, ctx.orgId);
  }
  if (!built) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const who = built.lpName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "lp";
  return new NextResponse(Buffer.from(built.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Subscription-Agreement-${who}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
