// The deals a recorded call can be linked to: the caller's organisation's,
// by name. Read on the caller's own client, so RLS decides what they see.
import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const supabase = await createServerClient();
  const { data, error } = await supabase
    .from("deals")
    .select("id, name")
    .eq("organization_id", auth.ctx.orgId)
    .order("name", { ascending: true })
    .limit(300);
  if (error) return NextResponse.json({ deals: [] });
  return NextResponse.json({
    deals: ((data ?? []) as Array<{ id: string; name: string | null }>).map((d) => ({ id: d.id, name: d.name?.trim() || "Deal" })),
  });
}
