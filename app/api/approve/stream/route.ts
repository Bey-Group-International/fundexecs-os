import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { decideApproval, type ProgressEvent } from "@/lib/engine";

// Approval triggers step execution, which calls Claude per step.
export const maxDuration = 300;

// POST /api/approve/stream — the live-canvas variant of /api/approve, scoped to
// the "approved" decision. It runs the exact same approve + execute path
// (through decideApproval, so the human-approval gate is untouched — it still
// requires the approval_id), piping live step progress to the response as
// newline-delimited JSON so the canvas lights up steps as they execute:
//   {"type":"step_start","step_id":"...","title":"...","step_order":1}
//   {"type":"step_done","step_id":"...","title":"..."}
//   {"type":"workflow_done","workflow_id":"..."}
// On any failure it emits {"type":"error"} and the client falls back to the
// non-streaming /api/approve path. Non-"approved" decisions are rejected here;
// the client routes those through /api/approve as before.
export async function POST(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const payload = await request.json().catch(() => null);
  const approvalId = payload?.approval_id;
  if (!approvalId || typeof approvalId !== "string") {
    return new Response(JSON.stringify({ error: "Required: approval_id" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  // This endpoint only streams the "approved" execution path. Other decisions
  // (reject / regenerate / accept) carry no live step progress, so they stay on
  // the plain /api/approve route.
  if (payload?.decision !== "approved") {
    return new Response(JSON.stringify({ error: "This endpoint only handles decision: 'approved'" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const supabase = await createServerClient();
  const ctx = { supabase, orgId: auth.ctx.orgId, actorId: auth.ctx.userId };
  const encoder = new TextEncoder();

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        // The gate is enforced inside decideApproval (it loads the approval by
        // id and records the human decision); onProgress only observes.
        await decideApproval(
          ctx,
          { approvalId, decision: "approved", note: payload?.note },
          (ev: ProgressEvent) => send(ev),
        );
      } catch {
        send({ type: "error" });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "application/x-ndjson; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
