// app/api/meetings/glossary/route.ts
// The firm's glossary: names and terms the recogniser hears wrong — a fund,
// a portfolio company, a partner, an acronym. The live transcript is
// corrected to these spellings and the report model is told them.
//
// Any member reads it; anyone who can write to the firm adds and removes.
import { NextRequest, NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient, createServiceClient, hasSupabaseServiceEnv } from "@/lib/supabase/server";
import { GLOSSARY_MAX_TERMS, cleanTerm } from "@/lib/meetings/notetaker";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Db = { from: (table: string) => any };

async function db(): Promise<Db> {
  return hasSupabaseServiceEnv() ? (createServiceClient() as Db) : ((await createServerClient()) as Db);
}

function missing(error: unknown): boolean {
  return (error as { code?: string } | null)?.code === "42P01";
}

const UNAVAILABLE = "The glossary isn't available yet — try again in a few minutes.";

export async function GET() {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  const { data, error } = await (await db())
    .from("meeting_glossary_terms")
    .select("id, term")
    .eq("organization_id", auth.ctx.orgId)
    .order("term", { ascending: true })
    .limit(GLOSSARY_MAX_TERMS);
  if (error) return NextResponse.json({ terms: [] });
  return NextResponse.json({ terms: data ?? [] });
}

export async function POST(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.ctx.role === "viewer") return NextResponse.json({ error: "Viewers can't change the glossary." }, { status: 403 });
  const body = (await req.json().catch(() => ({}))) as { term?: unknown };
  const term = cleanTerm(body.term);
  if (!term) return NextResponse.json({ error: "A term is 2 to 80 characters." }, { status: 400 });
  const client = await db();
  const { count, error: countError } = await client
    .from("meeting_glossary_terms")
    .select("id", { count: "exact", head: true })
    .eq("organization_id", auth.ctx.orgId);
  if (countError && missing(countError)) return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
  if ((count ?? 0) >= GLOSSARY_MAX_TERMS) {
    return NextResponse.json({ error: `The glossary holds up to ${GLOSSARY_MAX_TERMS} terms.` }, { status: 409 });
  }
  const { data, error } = await client
    .from("meeting_glossary_terms")
    .insert({ organization_id: auth.ctx.orgId, term, created_by: auth.ctx.userId })
    .select("id, term")
    .single();
  if (error || !data) {
    const code = (error as { code?: string } | null)?.code;
    if (code === "23505") return NextResponse.json({ error: "That term is already in the glossary." }, { status: 409 });
    if (missing(error)) return NextResponse.json({ error: UNAVAILABLE }, { status: 503 });
    return NextResponse.json({ error: "Could not add the term." }, { status: 500 });
  }
  return NextResponse.json({ term: data });
}

export async function DELETE(req: NextRequest) {
  const auth = await requireOrgContext();
  if (!auth.ok) return NextResponse.json({ error: auth.error }, { status: auth.status });
  if (auth.ctx.role === "viewer") return NextResponse.json({ error: "Viewers can't change the glossary." }, { status: 403 });
  const id = req.nextUrl.searchParams.get("id") ?? "";
  if (!/^[0-9a-f-]{36}$/i.test(id)) return NextResponse.json({ error: "Say which term to remove." }, { status: 400 });
  const { data, error } = await (await db())
    .from("meeting_glossary_terms")
    .delete()
    .eq("id", id)
    .eq("organization_id", auth.ctx.orgId)
    .select("id");
  if (error) return NextResponse.json({ error: "Could not remove the term." }, { status: 500 });
  if (!(data ?? []).length) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ ok: true });
}
