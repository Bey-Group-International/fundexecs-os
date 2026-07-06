import { NextResponse } from "next/server";
import { getSessionContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { saveAutomationCanvas } from "@/lib/automation-canvas";
import type { CanvasLayout } from "@/lib/automation-canvas";

export const runtime = "nodejs";

// Persist the visual canvas layout for an automation. WorkflowCanvas POSTs the
// full CanvasLayout here; we verify the automation belongs to the caller's org
// (defense in depth on top of RLS) before writing canvas_json.
export async function POST(req: Request, props: { params: Promise<{ id: string }> }) {
  const { id } = await props.params;

  const ctx = await getSessionContext();
  if (!ctx?.orgId) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const supabase = await createServerClient();
  const { data: automation } = await supabase
    .from("automations")
    .select("id")
    .eq("id", id)
    .eq("organization_id", ctx.orgId)
    .maybeSingle();
  if (!automation) {
    return NextResponse.json({ error: "Automation not found" }, { status: 404 });
  }

  let layout: CanvasLayout;
  try {
    const body = (await req.json()) as unknown;
    if (
      !body ||
      typeof body !== "object" ||
      !Array.isArray((body as { nodes?: unknown }).nodes) ||
      !Array.isArray((body as { edges?: unknown }).edges)
    ) {
      return NextResponse.json({ error: "Invalid canvas layout" }, { status: 400 });
    }
    layout = body as CanvasLayout;
  } catch {
    return NextResponse.json({ error: "Invalid JSON body" }, { status: 400 });
  }

  try {
    await saveAutomationCanvas(id, layout);
  } catch (err) {
    // Log the underlying error server-side but return a generic message so we
    // don't leak Supabase/internal details to the client.
    console.error("Failed to save automation canvas", err);
    return NextResponse.json({ error: "Save failed" }, { status: 500 });
  }

  return NextResponse.json({ ok: true });
}
