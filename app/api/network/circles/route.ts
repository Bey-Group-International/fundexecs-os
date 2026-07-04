import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { ctx } = auth;

  const body = await req.json().catch(() => ({}));
  const { name, description } = body;
  if (!name?.trim()) {
    return NextResponse.json({ error: "name is required" }, { status: 400 });
  }

  const supabase = await createServerClient() as any;
  const { data, error } = await supabase
    .from("syndicate_circles")
    .insert({
      organization_id: ctx.orgId,
      created_by: ctx.userId,
      name: name.trim(),
      description: description?.trim() || null,
    })
    .select("id, name, description, member_count, invite_code, is_active, created_at")
    .single();

  if (error || !data) {
    return NextResponse.json({ error: "Failed to create circle" }, { status: 500 });
  }

  return NextResponse.json({
    id: data.id,
    name: data.name,
    description: data.description,
    memberCount: data.member_count ?? 1,
    inviteCode: data.invite_code ?? "",
    isActive: data.is_active ?? true,
    createdAt: data.created_at,
  });
}
