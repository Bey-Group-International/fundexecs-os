import { requireOrgContext } from "@/lib/auth";
import { createServerClient } from "@/lib/supabase/server";
import { earnChatStream, earnChatFallback } from "@/lib/claude";
import { EARN_MODELS, type EarnModelKey } from "@/lib/earn-conversation";
import { parseStoredEdgeContext, edgeContextToPromptLine } from "@/lib/edge-context";
import { getRelationshipContext } from "@/lib/copilot/context/relationship-context-provider";
import { CONVERSATIONAL_COST, gateConversationalSpend } from "@/lib/conversational-gate";
import { checkRateLimit, rateLimitHeaders } from "@/lib/rate-limit";
import { buildContactAppendix, detectSourcingIntent } from "@/lib/chat-enrichment";
import { StreamingContactRedactor, redactContacts } from "@/lib/contact-sanitize";
import { loadMeetingPrepContext, loadMeetingFollowupContext } from "@/lib/meetings/meeting-context";
import { getActiveMandateRow, mandateContextBlock } from "@/lib/mandates";

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
  const rateLimit = checkRateLimit({
    key: `org:${orgId}:chat`,
    limit: 60,
    windowMs: 60_000,
  });
  if (!rateLimit.ok) {
    return new Response(JSON.stringify({ error: "Rate limit exceeded" }), {
      status: 429,
      headers: {
        "Content-Type": "application/json",
        ...rateLimitHeaders(rateLimit, 60),
      },
    });
  }

  const { body, model: requestedModel, prior, session_id, meeting_context } = await request.json().catch(() => ({ body: "" }));
  if (!body || typeof body !== "string") {
    return new Response(JSON.stringify({ error: "Missing 'body'" }), {
      status: 400,
      headers: { "Content-Type": "application/json" },
    });
  }

  // A fresh open (the /workspace composer) sends no session_id and must start
  // clean — no workspace state from other areas folded into the reply. Detail
  // only appears once the operator is inside an existing session or an
  // automation run (both carry a session_id). This flag gates the always-on
  // org-state injections below; prompt-triggered enrichments (relationship,
  // sourcing, meeting) still respond to the current question regardless.
  const sessionId = typeof session_id === "string" && session_id ? session_id : undefined;
  const inSession = Boolean(sessionId);

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

  // A meeting prep/follow-up request: the client sends only a clean one-liner and
  // this reference; the rich, sensitive context is gathered server-side below and
  // injected into the model call — it is never returned to the browser.
  const meetingCtx =
    meeting_context && typeof meeting_context === "object" &&
    typeof (meeting_context as { id?: unknown }).id === "string" &&
    ((meeting_context as { mode?: unknown }).mode === "prep" || (meeting_context as { mode?: unknown }).mode === "followup")
      ? (meeting_context as { id: string; mode: "prep" | "followup" })
      : null;

  // --- Model routing: route simple queries to a faster/cheaper model ---
  const wordCount = body.trim().split(/\s+/).length;
  // A meeting prep/follow-up briefing is substantive work — keep it off the fast
  // path even though the visible one-liner is short.
  const isSimple = !meetingCtx && wordCount < 15 && !body.match(/draft|memo|analysis|report|summarize|compare/i);
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

    // Always-on workspace snapshot (active pipeline, running workflows, LP
    // count). This is state carried in from OTHER areas of the product, so it
    // only loads inside an existing session or automation — a fresh open must
    // not be preloaded with the org's book before the operator has asked
    // anything. Prompt-triggered enrichments below still run either way.
    if (inSession) {
      const [dealsResult, diligenceResult, tasksResult, contactsResult] = await Promise.allSettled([
        supabase
          .from("deals")
          .select("id, name, stage, asset_class, updated_at")
          .eq("organization_id", orgId)
          // Exclude terminal deals. Values must be real deal_stage enum members —
          // "closed"/"rejected" aren't, and Postgres rejects them ("invalid input
          // value for enum deal_stage"). Matches home/page.tsx's filter.
          .not("stage", "in", "(exited,passed,dead)")
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
    }

    // Relationship-aware context: when the ask is about people/network/intros,
    // pull a SCOPED slice of the Capital Network (never the whole book) so
    // Earn can recommend contacts with evidence — scores, source, confidence —
    // and the standing Tier-2 outreach approval rule.
    const isRelationshipAsk =
      /\b(network|contact|intro|introduction|warm|outreach|lp|lps|investor|lender|broker|operator|advisor|relationship|who (should|can|in my))\b/i.test(
        body,
      );
    if (isRelationshipAsk) {
      try {
        const keywords = body
          .toLowerCase()
          .split(/[^a-z0-9-]+/)
          .filter((w) => w.length > 3)
          .slice(0, 12);
        const { promptBlock } = await getRelationshipContext(supabase, { keywords, limit: 8 });
        if (promptBlock) liveContext += `\n${promptBlock}\n`;
      } catch {
        // Relationship context is an enhancement — never block the reply.
      }
    }

    if (needsWebSearch) {
      liveContext += "\n[Web search recommended for this query — live data not fetched]\n";
    }

    // Standing mandate: fold the operator's scope, guardrails, and blast-radius
    // limits into Earn's context so every reply respects the delegation's
    // constraints — not just in-session, since guardrails apply to all advice.
    // Best-effort; a miss or empty mandate simply adds nothing.
    try {
      const mandateBlock = mandateContextBlock(await getActiveMandateRow(supabase, orgId));
      if (mandateBlock) liveContext += `\n${mandateBlock}\n`;
    } catch {
      // Mandate context is an enhancement — never block the reply.
    }
  } catch {
    // proceed without live context
  }

  // --- Meeting prep / follow-up context (server-side injection) ---
  // Gather the meeting + its linked deal/fund/lead (and, for follow-up, any saved
  // report) and fold the composed institutional context into liveContext. This is
  // the whole point of the no-leak design: the sensitive material reaches the
  // model here but never the client. Org-scoped and best-effort.
  if (meetingCtx) {
    try {
      const supabase = await createServerClient();
      const block =
        meetingCtx.mode === "prep"
          ? await loadMeetingPrepContext(supabase, orgId, meetingCtx.id)
          : await loadMeetingFollowupContext(supabase, orgId, meetingCtx.id);
      if (block) liveContext = liveContext ? `${liveContext}\n\n${block}` : block;
    } catch {
      // Non-fatal — Earn still answers the one-liner without the enriched context.
    }
  }

  // --- Prior artifact context: last 5 completed deliverables so Earn can
  //     reference prior work (memos, models, analyses) in its answers. This is
  //     work produced elsewhere in the org, so it only loads inside a session or
  //     automation — a fresh open must not be seeded with prior deliverables. ---
  let priorArtifacts: string | undefined;
  if (inSession) {
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
  }

  // For sourcing/discovery asks ("source family offices near me"), load the
  // org's active mandate geographies so "near me" resolves to the regions the
  // firm actually invests in. Only runs for sourcing queries — no DB hit on
  // ordinary chat.
  let mandateGeographies: string[] = [];
  if (detectSourcingIntent(body)) {
    try {
      const supabase = await createServerClient();
      const { data: theses } = await supabase
        .from("investment_theses")
        .select("geographies, is_active")
        .eq("organization_id", orgId);
      if (theses?.length) {
        const active = theses.find((t) => t.is_active) ?? theses[0];
        mandateGeographies = Array.isArray(active?.geographies) ? active.geographies : [];
      }
    } catch {
      // Best effort — sourcing still works nationwide without geographies.
    }
  }

  const modelKey = (requestedModel as EarnModelKey) ?? undefined;
  const modelLabel = EARN_MODELS.find((m) => m.key === modelKey)?.label ?? "Earn";
  const priorContext = Array.isArray(prior)
    ? prior.filter((x: unknown) => x && typeof x === "object").slice(-30)
    : [];

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
  const stream = earnChatStream({ body, modelLabel, priorContext, liveContext: liveContext || undefined, priorArtifacts, model });

  // No API key — stream the deterministic fallback as a single chunk (still
  // redacted, so no contact-like text can ever slip through).
  if (!stream) {
    return new Response(encoder.encode(redactContacts(earnChatFallback(body))), {
      headers: { "Content-Type": "text/plain; charset=utf-8", "Cache-Control": "no-store" },
    });
  }

  const readable = new ReadableStream<Uint8Array>({
    async start(controller) {
      let reply = "";
      // Redact any email/phone/LinkedIn the MODEL writes in its prose — the
      // verified block below is the ONLY sanctioned source of contact details.
      // Streaming-safe: only complete, clause-bounded text is emitted.
      const redactor = new StreamingContactRedactor();
      try {
        stream.on("text", (delta: string) => {
          const safe = redactor.push(delta);
          if (safe) {
            reply += safe;
            controller.enqueue(encoder.encode(safe));
          }
        });
        await stream.finalMessage();
        const tail = redactor.flush();
        if (tail) {
          reply += tail;
          controller.enqueue(encoder.encode(tail));
        }
        // Verified contacts: if the reply named a real company/person, look up
        // real, Apollo-sourced phone/email and stream a contact block into the
        // SAME response. Never fabricated (Apollo-only) and never fatal — a
        // failure or no-hit simply appends nothing.
        try {
          const appendix = await buildContactAppendix(body, reply, { geographies: mandateGeographies });
          if (appendix) {
            reply += appendix;
            controller.enqueue(encoder.encode(appendix));
          }
        } catch {
          // Enrichment is additive — never let it break the reply.
        }
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
