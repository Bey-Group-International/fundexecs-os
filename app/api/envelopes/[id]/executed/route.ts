import { NextResponse } from "next/server";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { envelopeCopyTokenValid } from "@/lib/envelope-notify.server";
import { getEnvelopeCopy } from "@/lib/signing/executed-envelope.server";
import type { SupabaseClient } from "@supabase/supabase-js";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

// The document with every signer's blocks and signature on it. Two ways in: a member of
// the owning organization, or anyone holding the HMAC link emailed once it is fully signed.
// The seal goes on only when every party has signed, so a sealed file means fully executed.
export async function GET(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const token = new URL(req.url).searchParams.get("t");

  let built = null;
  if (token) {
    if (!envelopeCopyTokenValid(id, token) || !hasSupabaseServiceEnv()) return NextResponse.json({ error: "Not found" }, { status: 404 });
    built = await getEnvelopeCopy(createServiceClient() as unknown as SupabaseClient, id);
  } else {
    const supabase = await createServerClient();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    // The member's own client: row-level security limits this to their organization.
    built = await getEnvelopeCopy(supabase as unknown as SupabaseClient, id);
  }
  if (!built) return NextResponse.json({ error: "Nothing has been signed yet" }, { status: 404 });

  const name = (built.title || "document").replace(/[^A-Za-z0-9]+/g, "-").replace(/^-|-$/g, "").slice(0, 50) || "document";
  return new NextResponse(Buffer.from(built.pdf), {
    headers: {
      "Content-Type": "application/pdf",
      "Content-Disposition": `attachment; filename="${name}${built.executed ? "-executed" : "-signed-so-far"}.pdf"`,
      "Cache-Control": "private, no-store",
    },
  });
}
