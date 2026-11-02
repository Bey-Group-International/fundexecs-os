import { NextResponse } from "next/server";
import { PDFDocument } from "pdf-lib";
import { createServerClient } from "@/lib/supabase/server";
import { cleanBlocks } from "@/lib/envelope-fields";
import { loadEnvelopePdf } from "@/lib/envelope-pdf.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

async function member() {
  const supabase = await createServerClient();
  const { data: { user } } = await supabase.auth.getUser();
  return { supabase, user };
}

// The blocks placed on an envelope's document (members of the owning org).
export async function GET(_req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { supabase, user } = await member();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const [{ data: recipients }, { data: fields }, { data: env }] = await Promise.all([
    supabase.from("envelope_recipients").select("id, name, email, role, routing_order, status").eq("envelope_id", id).order("routing_order", { ascending: true }),
    supabase.from("envelope_fields").select("id, recipient_id, field_type, page, x_pct, y_pct, width_pct, height_pct, required, prefill, locked").eq("envelope_id", id),
    supabase.from("envelopes").select("id, title, status").eq("id", id).maybeSingle(),
  ]);
  if (!env) return NextResponse.json({ error: "Not found" }, { status: 404 });
  return NextResponse.json({ envelope: env, recipients: recipients ?? [], fields: fields ?? [] });
}

// Replace every block on a draft envelope. Blocks are placed before sending, never after.
export async function PUT(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;
  if (!UUID.test(id)) return NextResponse.json({ error: "Not found" }, { status: 404 });
  const { supabase, user } = await member();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  const { data: env } = await supabase.from("envelopes").select("id, status, pdf_storage_key").eq("id", id).maybeSingle();
  const envelope = env as { id: string; status: string; pdf_storage_key: string | null } | null;
  if (!envelope) return NextResponse.json({ error: "Not found" }, { status: 404 });
  if (envelope.status !== "draft") return NextResponse.json({ error: "Blocks can only be changed before the document is sent." }, { status: 409 });
  if (!envelope.pdf_storage_key) return NextResponse.json({ error: "This document has no PDF to place blocks on." }, { status: 409 });

  let body: { blocks?: unknown };
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  const { data: recs } = await supabase.from("envelope_recipients").select("id").eq("envelope_id", id);
  const bytes = await loadEnvelopePdf(envelope.pdf_storage_key);
  if (!bytes) return NextResponse.json({ error: "Could not read the document." }, { status: 500 });
  const pageCount = (await PDFDocument.load(bytes)).getPageCount();

  const cleaned = cleanBlocks(body.blocks, ((recs ?? []) as { id: string }[]).map((r) => r.id), pageCount);
  if (!cleaned.ok) return NextResponse.json({ error: cleaned.error }, { status: 400 });

  const { error: delErr } = await supabase.from("envelope_fields").delete().eq("envelope_id", id);
  if (delErr) return NextResponse.json({ error: "Could not save the blocks." }, { status: 500 });
  if (cleaned.blocks.length) {
    const { error: insErr } = await supabase.from("envelope_fields").insert(cleaned.blocks.map((b) => ({ ...b, envelope_id: id })));
    if (insErr) return NextResponse.json({ error: "Could not save the blocks." }, { status: 500 });
  }
  return NextResponse.json({ ok: true, count: cleaned.blocks.length, pageCount });
}
