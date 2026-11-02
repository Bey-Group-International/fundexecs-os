import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { buildSignedCopy, signedCopyTokenValid } from "@/lib/document-signing.server";

export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// One signed data-room file as a PDF. Two ways in: the signer, who has no
// account, with the token from their emailed receipt (an HMAC of this
// signature's id); or a member of the fund that owns it, through their session.
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const token = new URL(req.url).searchParams.get("t");

  let built = null;
  if (token) {
    if (!signedCopyTokenValid(id, token) || !hasSupabaseServiceEnv()) {
      return NextResponse.json({ error: "Not found" }, { status: 404 });
    }
    built = await buildSignedCopy(createServiceClient(), id);
  } else {
    const ctx = await getSessionContext();
    if (!ctx?.orgId) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    built = await buildSignedCopy(await createServerClient(), id, ctx.orgId);
  }
  if (!built) return NextResponse.json({ error: "Not found" }, { status: 404 });

  const who = built.signerName.replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 40) || "signer";
  return new NextResponse(Buffer.from(built.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="Signed-${who}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
