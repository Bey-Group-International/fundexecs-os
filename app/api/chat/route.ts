import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { earnChatStream, earnChatFallback } from "@/lib/claude";
import { EARN_MODELS, type EarnModelKey } from "@/lib/earn-conversation";
import { parseStoredEdgeContext, edgeContextToPromptLine } from "@/lib/edge-context";
import { CONVERSATIONAL_COST, gateConversationalSpend } from "@/lib/conversational-gate";

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

  // Pre-flight credit gate: this route calls Claude directly, outside the
  // task engine's per-step spendCredits gate, so without this a single
  // authenticated seat could drive unbounded Anthropic spend by scripting
  // requests against it. A no-op when Claude isn't configured (the fallback
  // path below costs nothing real).
  const gate = await gateConversationalSpend(orgId, CONVERSATIONAL_COST.chat, "chat");
  if (!gate.ok) {
    return new Response(JSON.stringify({ error: gate.error }), {
      status: gate.status,
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

  // --- Live DB context loading — parallel queries to minimize latency ---
  let liveContext = "";
  try {
    const supabase = await createServerClient();

    const [dealsResult, diligenceResult, tasksResult, contactsResult] = await Promise.allSettled([
      supabase
        .from("deals")
        .select("id, name, stage, asset_class, updated_at")
        .eq("organization_id", orgId)
        .not("stage", "in", '("closed","rejected")')
        .order("updated_at", { ascending: false })
        .limit(8),
      supabase
        .from("diligence_items")
        .select("deal_id, id")
        .eq("organization_id", orgId)
        .eq("status", "open"),
      supabase
        .from("tasks")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId)
        .eq("status", "in_progress"),
      supabase
        .from("contacts")
        .select("id", { count: "exact", head: true })
        .eq("organization_id", orgId),
    ]);

    // Active deals with open diligence counts
    if (dealsResult.status === "fulfilled" && dealsResult.value.data?.length) {
      const deals = dealsResult.value.data;
      const countMap: Record<string, number> = {};
      if (diligenceResult.status === "fulfilled" && diligenceResult.value.data) {
        for (const item of diligenceResult.value.data) {
          if (item.deal_id) countMap[item.deal_id] = (countMap[item.deal_id] ?? 0) + 1;
        }
      }
      const activeDealsLines = deals.map((deal) => {
        const openItems = deal.id && countMap[deal.id] ? ` · ${countMap[deal.id]} open items` : "";
        const daysAgo = deal.updated_at
          ? Math.round((Date.now() - new Date(deal.updated_at).getTime()) / 86400000)
          : null;
        const recency = daysAgo !== null ? ` · updated ${daysAgo}d ago` : "";
        return `${deal.name} [${deal.stage}${deal.asset_class ? ` · ${deal.asset_class}` : ""}${openItems}${recency}]`;
      });
      liveContext += `Active pipeline (${deals.length}):\n${activeDealsLines.map((l) => `  - ${l}`).join("\n")}\n`;
    }

    if (tasksResult.status === "fulfilled") {
      const count = (tasksResult.value as { count: number | null }).count;
      if (count !== null) liveContext += `Running workflows: ${count}\n`;
    }

    if (contactsResult.status === "fulfilled") {
      const count = (contactsResult.value as { count: number | null }).count;
      if (count !== null) liveContext += `LP pipeline: ${count} contacts\n`;
    }

    if (needsWebSearch) {
      liveContext += "\n[Web search recommended for this query — live data not fetched]\n";
    }
  } catch {
    // proceed without live context
  }

  // --- Prior artifact context: last 5 completed deliverables so Earn can
  //     reference prior work (memos, models, analyses) in its answers. ---
  let priorArtifacts: string | undefined;
  try {
    const supabase = await createServerClient();
    const { data: artifacts } = await supabase
      .from("artifacts")
      .select("title, artifact_type, content")
      .eq("organization_id", orgId)
      .order("created_at", { ascending: false })
      .limit(5);

    if (artifacts && artifacts.length > 0) {
      priorArtifacts = artifacts
        .map((a) => {
          const preview = typeof a.content === "string" ? a.content.slice(0, 300) : "";
          return `[${a.artifact_type}] ${a.title}${preview ? `: ${preview}…` : ""}`;
        })
        .join("\n");
    }
  } catch {
    // skip — best effort
  }

  const modelKey = (requestedModel as EarnModelKey) ?? undefined;
  const modelLabel = EARN_MODELS.find((m) => m.key === modelKey)?.label ?? "Earn";
  const priorContext = Array.isArray(prior)
    ? prior.filter((x: unknown) => x && typeof x === "object").slice(-30)
    : [];
  const sessionId = typeof session_id === "string" && session_id ? session_id : undefined;

  // Pull edge context from the session row and append to liveContext if present.
  // `edge_context` is added by migration 20260702000011; cast to bypass stale
  // generated types until the next type regeneration cycle.
  if (sessionId) {
    try {
      const supabase = await createServerClient();
      const { data: sessionRow } = await (supabase
        .from("sessions")
        .select("edge_context")
        .eq("id", sessionId)
        .single() as unknown as Promise<{ data: { edge_context: unknown } | null }>);
      const edgeResult = parseStoredEdgeContext(sessionRow?.edge_context);
      const edgeLine = edgeResult ? edgeContextToPromptLine(edgeResult) : "";
      if (edgeLine) liveContext = liveContext ? `${liveContext}\n${edgeLine}` : edgeLine;
    } catch {
      // Non-fatal — proceed without edge context.
    }
  }

  // Cross-session summary: if the client sent a prior_session_id, load its last
  // messages and summarize them as context for this reply.
  let sessionSummary: string | undefined;
  const priorSessId = typeof prior_session_id === "string" && prior_session_id ? prior_session_id : null;
  if (priorSessId) {
    try {
      const supabase = await createServerClient();
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
    const supabase = await createServerClient();
    await supabase
      .from("session_messages")
      .insert([
        { organization_id: orgId, session_id: sessionId, role: "user", content: body, created_by: userId },
        { organization_id: orgId, session_id: sessionId, role: "assistant", content: reply, model: modelKey ?? null, created_by: userId },
      ])
      .then(undefined, () => {});
  }

  const encoder = new TextEncoder();
  const stream = earnChatStream({ body, modelLabel, priorContext, liveContext: liveContext || undefined, sessionSummary, priorArtifacts, model });

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
        controller.enqueue(
          encoder.encode(
            "\n\n*Earn ran into an issue generating that reply — please try again in a moment. If the problem persists, check that your Investment Thesis and Org Profile are filled in, as Earn needs that context to respond.*",
          ),
        );
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
      "X-Earn-Model": model,
    },
  });
}
