// app/api/meetings/follow-up-templates/route.ts
// The firm's saved follow-up emails. Any member reads them; anyone who can
// write to the firm adds and removes. Filled in per meeting by the rewrite
// route's template mode.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { MAX_TEMPLATES, cleanTemplateBody, cleanTemplateName } from "@/lib/meetings/follow-up-loop";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Db = { from: (table: string) => any };

async function db(): Promise<Db> {
  return hasSupabaseServiceEnv() ? (createServiceClient() as Db) : ((await createServerClient()) as Db);
}

const UNAVAILABLE = "Templates aren't available yet — try again in a few minutes.";

export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { data, error } = await (await db())
    .from("followup_templates")
    .select("id, name, body")
    .eq("organization_id", auth.ctx.orgId)
    .order("name", { ascending: true })
    .limit(MAX_TEMPLATES);
  if (error) return NextResponse.json({ templates: [] });
  return NextResponse.json({ templates: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.ctx.role === "viewer") return NextResponse.json({ error: "Viewers can't change templates." }, { status: 403 });
  const payload = (await req.json().catch(() => ({}))) as { name?: unknown; body?: unknown };
  const name = cleanTemplateName(payload.name);
  const body = cleanTemplateBody(payload.body);
  if (!name || !body) return NextResponse.json({ error: "A template needs a name and a body." }, { status: 400 });
  const client = await db();
  const { count, error: countError } = await client
    .from("followup_templates")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", auth.ctx.orgId);
  if ((countError as { code?: string } | null)?.code === "42P01") return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  if ((count ?? 0) >= MAX_TEMPLATES) return NextResponse.json({ error: `Your firm can keep up to ${MAX_TEMPLATES} templates.` }, { status: 409 });
  const { data, error } = await client
    .from("followup_templates")
    .insert({ organization_id: auth.ctx.orgId, name, body, created_by: auth.ctx.userId })
    .select("id, name, body")
    .single();
  if (error || !data) {
    const missing = (error as { code?: string } | null)?.code === "42P01";
    return NextResponse.json({ error: missing ? UNAVAILABLE : "Couldn't save the template." }, { status: missing ? 503 : 500 });
  }
  return NextResponse.json({ template: data });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.ctx.role === "viewer") return NextResponse.json({ error: "Viewers can't change templates." }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Say which template to remove." }, { status: 400 });
  const { data, error } = await (await db())
    .from("followup_templates")
    .delete()
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId)
    .select("id");
  if (error) return NextResponse.json({ error: "Couldn't remove the template." }, { status: 500 });
  if (!(data ?? []).length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
