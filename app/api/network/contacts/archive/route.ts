// POST /api/network/contacts/archive — soft-archive a relationship contact so it
// drops out of the active network (the FundExecs analog of LinkedIn's "Remove
// connection"). Non-destructive: sets archived_at, RLS-scoped to the caller's
// org. Only network_contacts are archivable here — investors, partners, and
// providers are managed from the Source hub where their lifecycle lives.

import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });

  const body = (await req.json().catch(() => null)) as { contactId?: string } | null;
  const contactId = body?.contactId?.trim();
  if (!contactId) {
    return NextResponse.json({ error: "contactId is required." }, { status: 400 });
  }

  try {
    // Cast — network_contacts is not in the generated database types.
    const supabase = (await createServerClient()) as unknown as {
      from: (t: string) => {
        update: (v: Record<string, unknown>) => {
          eq: (c: string, v: string) => {
            eq: (c: string, v: string) => Promise<{ error: { message: string } | null }>;
          };
        };
      };
    };
    const { error } = await supabase
      .from("network_contacts")
      .update({ archived_at: new Date().toISOString() })
      .eq("id", contactId)
      .eq("organization_id", auth.ctx.orgId);

    if (error) {
      return NextResponse.json({ error: error.message }, { status: 500 });
    }
    return NextResponse.json({ ok: true });
  } catch (err) {
    console.error("[network/contacts/archive]", err);
    return NextResponse.json({ error: "Failed to archive contact." }, { status: 500 });
  }
}
