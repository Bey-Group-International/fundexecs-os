import { NextResponse } from "next/server";
import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import {
  classifyActiveTab,
  processBackgroundTabs,
  type EdgeTab,
} from "@/lib/edge-context";
import { mergeEdgeContextIntoMemory } from "@/lib/brains/session-memory";

// POST /api/edge-context
// Receives edge_all_open_tabs from the browser layer, classifies the active tab
// synchronously, kicks off background processing, and stores the result in the
// session row so all subsequent agent calls can read it.
//
// Body: { tabs: EdgeTab[], session_id?: string }
// Response: { context_hash: string, workflow_context: string, primary_agent: string | null }
export async function POST(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return NextResponse.json({ error: auth.error }, { status: auth.status });
  }

  let body: { tabs?: unknown; session_id?: unknown };
  try {
    body = await request.json();
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }

  if (!Array.isArray(body.tabs)) {
    return NextResponse.json({ error: "Missing 'tabs' array" }, { status: 400 });
  }

  const tabs = body.tabs as EdgeTab[];
  const sessionId = typeof body.session_id === "string" ? body.session_id : null;

  // Synchronous: classify active tab immediately.
  const partial = classifyActiveTab(tabs);

  // Async: process background tabs and merge into session store.
  // Fire-and-forget — does not block the response.
  void (async () => {
    try {
      const full = await processBackgroundTabs(tabs, partial);

      if (sessionId) {
        const supabase = await createServerClient();
        // Store serialized EdgeContextResult in the session row.
        await supabase
          .from("sessions")
          .update({ edge_context: full as never } as never)
          .eq("id", sessionId);

        // Merge workflow context into session memory card constraints.
        await mergeEdgeContextIntoMemory(sessionId, full);
      }
    } catch (err) {
      console.error("[edge-context] Background processing error:", err);
    }
  })();

  // Store partial result synchronously so the next agent call has something
  // to read even before background processing finishes.
  if (sessionId) {
    try {
      const supabase = await createServerClient();
      await supabase
        .from("sessions")
        .update({ edge_context: partial as never } as never)
        .eq("id", sessionId);
    } catch {
      // Non-fatal — the context enrichment is supplementary.
    }
  }

  return NextResponse.json({
    context_hash: partial.contextHash,
    workflow_context: partial.workflowContext,
    primary_agent: partial.primaryAgentHint,
    safety_flags: partial.safetyFlags,
  });
}
