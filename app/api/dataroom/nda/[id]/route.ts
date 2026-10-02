import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { loadNdaRecord } from "@/lib/nda-signing.server";
import { buildNdaPdf, ndaCopyTokenValid } from "@/lib/nda.server";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One signed NDA as a PDF. Two ways in:
//  - the signer, who has no account, with the token from the copy we emailed
//    them (an HMAC of this signature's id, so it opens this record only);
//  - a member of the fund that owns the signature, through their own session
//    and row-level security.
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const token = new URL(req.url).searchParams.get("t");

  let record = null;
  if (token) {
    if (!ndaCopyTokenValid(id, token) || !hasSupabaseServiceEnv()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    record = await loadNdaRecord(createServiceClient(), id);
  } else {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    record = await loadNdaRecord(await createServerClient(), id, ctx.orgId);
  }
  if (!record) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const pdf = await buildNdaPdf(record);
  const who = record.signerName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "signer";
  return new NextResponse(Buffer.from(pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="NDA-${who}-${record.signedAt.slice(0, 10)}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
