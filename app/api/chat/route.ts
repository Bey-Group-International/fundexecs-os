import { requireOrgContext } from "@/lib/auth";
import { earnChatStream, earnChatFallback } from "@/lib/claude";
import { EARN_MODELS, type EarnModelKey } from "@/lib/earn-conversation";

// Conversational replies stream token-by-token; give Claude room beyond the
// default request window.
export const maxDuration = 60;

// POST /api/chat — Earn's conversational answer path. Ungated: a chat reply is
// advisory information, so it streams straight back without the approval gate
// (only tasks/actions that reach the outside world are gated, via /api/prompt).
export async function POST(request: Request) {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return new Response(JSON.stringify({ error: auth.error }), {
      status: auth.status,
      headers: { "Content-Type": "application/json" },
    });
  }

  const { body, model, prior } = await request.json().catch(() => ({ body: "" }));
  if (!body || typeof body !== "string") {
    return new Response(JSON.stringify({ error: "Missing 'body'" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  const modelLabel = EARN_MODELS.find((m) => m.key === (model as EarnModelKey))?.label ?? "Earn";
  const priorContext = Array.isArray(prior)
    ? prior.filter((x): x is string => typeof x === "string").slice(-6)
    : [];

  const encoder = new TextEncoder();
  const stream = earnChatStream({ body, modelLabel, priorContext });

  // No API key — stream the deterministic fallback as a single chunk.
  if (!stream) {
    return new Response(encoder.encode(earnChatFallback(body)), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        stream.on("text", (delta: string) => controller.enqueue(encoder.encode(delta)));
        await stream.finalMessage();
      } catch {
        controller.enqueue(encoder.encode("\n\n[Earn hit an error generating that reply.]"));
      } finally {
        controller.close();
      }
    },
  });

  return new Response(readable, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Cache-Control": "no-store",
      "X-Accel-Buffering": "no",
    },
  });
}
