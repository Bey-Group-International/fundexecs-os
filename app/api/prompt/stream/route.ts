import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { planPrompt, materializePrompt } from "@/lib/engine";

// Plan generation calls Claude; give it room beyond the default.
export const maxDuration = 60;

// POST /api/prompt/stream — the live-canvas variant of /api/prompt. It streams
// newline-delimited JSON events so the work canvas can reveal the plan as Earn
// drafts it, then hand off to the live (gated) workflow:
//   {"type":"planning"}
//   {"type":"plan","plan":{...}}
//   {"type":"ready","session_id":"...","workflow_id":"..."}
// On any failure it emits {"type":"error"} and the client falls back to the
// non-streaming /api/prompt path.
export async function POST(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { body, session_id } = await request.json().catch(() => ({ body: "" }));
  if (!body || typeof body !== "string") {
    return new Response(JSON.stringify({ error: "Missing 'body'" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }
  const sessionId = typeof session_id === "string" && session_id ? session_id : undefined;

  const supabase = createServerClient();
  const ctx = { supabase, orgId: auth.ctx.orgId, actorId: auth.ctx.userId };
  const encoder = new TextEncoder();

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      const send = (obj: unknown) => controller.enqueue(encoder.encode(JSON.stringify(obj) + "\n"));
      try {
        send({ type: "planning" });
        const plan = await planPrompt(ctx, body, sessionId);
        send({ type: "plan", plan });
        const { session_id: sid, workflow } = await materializePrompt(ctx, body, plan, sessionId);
        send({ type: "ready", session_id: sid, workflow_id: workflow.id });
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
