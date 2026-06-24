import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
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
  const { orgId, userId } = auth.ctx;

  const { body, model: requestedModel, prior, session_id, prior_session_id } = await request.json().catch(() => ({ body: "" }));
  if (!body || typeof body !== "string") {
    return new Response(JSON.stringify({ error: "Missing 'body'" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // --- Model routing: route simple queries to a faster/cheaper model ---
  const wordCount = body.trim().split(/\s+/).length;
  const isSimple = wordCount < 15 && !body.match(/draft|memo|analysis|report|summarize|compare/i);
  const model = isSimple
    ? "claude-haiku-4-5-20251001"
    : (requestedModel ?? process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6");

  // --- Web search detection ---
  const needsWebSearch =
    /\b(news|recent|latest|current|market|rate|price|comps|comparable|filing|SEC|EDGAR)\b/i.test(body) ||
    /\b[A-Z][a-z]+ (Capital|Partners|Group|Fund|REIT|Inc|LLC|Corp)\b/.test(body);

  // --- Live DB context loading ---
  let liveContext = "";
  try {
    const supabase = createServerClient();

    // Active deals
    const activeDealsLines: string[] = [];
    try {
      const { data: deals } = await supabase
        .from("deals")
        .select("name, stage, asset_class")
        .eq("organization_id", orgId)
        .not("stage", "in", '("closed","rejected")')
        .order("updated_at", { ascending: false })
        .limit(5);

      if (deals && deals.length > 0) {
        // Open diligence counts per deal
        const { data: diligenceCounts } = await supabase
          .from("diligence_items")
          .select("deal_id, id")
          .eq("organization_id", orgId)
          .eq("status", "open");

        const countMap: Record<string, number> = {};
        if (diligenceCounts) {
          for (const item of diligenceCounts) {
            if (item.deal_id) countMap[item.deal_id] = (countMap[item.deal_id] ?? 0) + 1;
          }
        }

        for (const deal of deals) {
          const openItems = deal.name && countMap[deal.name] ? ` (${countMap[deal.name]} open items)` : "";
          activeDealsLines.push(`${deal.name} (${deal.stage}${openItems})`);
        }
        liveContext += `Active deals: ${activeDealsLines.join(", ")}\n`;
      }
    } catch {
      // skip — table may not exist or RLS blocks access
    }

    // Running tasks count
    try {
      const { count: runningTasks } = await supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("status", "in_progress");

      if (runningTasks !== null) {
        liveContext += `Running workflows: ${runningTasks}\n`;
      }
    } catch {
      // skip
    }

    // LP pipeline count
    try {
      const { count: lpCount } = await supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId);

      if (lpCount !== null) {
        liveContext += `LP pipeline: ${lpCount} contacts\n`;
      }
    } catch {
      // skip — contacts table may not exist
    }

    if (needsWebSearch) {
      liveContext += "\n[Web search recommended for this query — live data not fetched]\n";
    }
  } catch {
    // If any outer error occurs, proceed without live context
  }

  const modelKey = (requestedModel as EarnModelKey) ?? undefined;
  const modelLabel = EARN_MODELS.find((m) => m.key === modelKey)?.label ?? "Earn";
  const priorContext = Array.isArray(prior)
    ? prior.filter((x: unknown) => x && typeof x === "object").slice(-30)
    : [];
  const sessionId = typeof session_id === "string" && session_id ? session_id : undefined;

  // Cross-session summary: if the client sent a prior_session_id, load its last
  // messages and summarize them as context for this reply.
  let sessionSummary: string | undefined;
  const priorSessId = typeof prior_session_id === "string" && prior_session_id ? prior_session_id : null;
  if (priorSessId) {
    try {
      const supabase = createServerClient();
      const { data: prevMsgs } = await supabase
        .from("session_messages")
        .select("role, content")
        .eq("session_id", priorSessId)
        .eq("organization_id", orgId)
        .order("created_at", { ascending: false })
        .limit(20);
      if (prevMsgs && prevMsgs.length > 0) {
        const { summarizeSessionMessages } = await import("@/lib/claude");
        sessionSummary = await summarizeSessionMessages(
          prevMsgs.reverse().map((m) => ({ role: m.role as string, content: m.content as string }))
        );
      }
    } catch {
      // skip — best effort
    }
  }

  // Persist the turn pair when the chat happens inside a session, so it survives
  // a reload. Best-effort (RLS-gated insert); a failure never breaks the reply.
  async function persist(reply: string) {
    if (!sessionId || !reply.trim()) return;
    const supabase = createServerClient();
    await supabase
      .from("session_messages")
      .insert([
        { organization_id: orgId, session_id: sessionId, role: "user", content: body, created_by: userId },
        { organization_id: orgId, session_id: sessionId, role: "assistant", content: reply, model: modelKey ?? null, created_by: userId },
      ])
      .then(undefined, () => {});
  }

  const encoder = new TextEncoder();
  const stream = earnChatStream({ body, modelLabel, priorContext, liveContext: liveContext || undefined, sessionSummary, model });

  // No API key — stream the deterministic fallback as a single chunk.
  if (!stream) {
    return new Response(encoder.encode(earnChatFallback(body)), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let reply = "";
      try {
        stream.on("text", (delta: string) => {
          reply += delta;
          controller.enqueue(encoder.encode(delta));
        });
        await stream.finalMessage();
      } catch {
        controller.enqueue(encoder.encode("\n\n[Earn hit an error generating that reply.]"));
      } finally {
        controller.close();
        await persist(reply);
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
