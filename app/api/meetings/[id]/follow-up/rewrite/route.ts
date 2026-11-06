// app/api/meetings/[id]/follow-up/rewrite/route.ts
// Reworking the follow-up before it goes: in a different tone, to an
// instruction ("shorter", "lead with the term sheet"), or from one of the
// firm's templates filled in from this meeting's report.
//
// Nothing is sent or saved here — the result goes back into the editor, where
// the host reads it before anything leaves.
import { NextRequest, NextResponse } from "next/server";
import { anthropicClient, INTERACTIVE_TIMEOUT_MS } from "@/lib/anthropic-client";
import { checkRateLimit } from "@/lib/rate-limit";
import { FIRST_NAME_TOKEN } from "@/lib/meetings/follow-up-greeting";
import { followUpBody } from "@/lib/meetings/follow-up";
import { FOLLOW_UP_TONES, cleanInstruction, fillTemplate, isTone } from "@/lib/meetings/follow-up-loop";
import { templateContext } from "@/lib/meetings/follow-up-sends.server";
import { loadHost } from "@/lib/meetings/report-roles.server";
import { createServerClient } from "@/lib/supabase/server";
import { requireMeetingHost } from "../host.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MODEL = process.env.CLAUDE_MODEL ?? "claude-sonnet-4-6";

const SYSTEM = [
  "You edit a follow-up email a fund manager is about to send after a meeting.",
  "Keep every fact, name, number, date, decision and action item exactly as given; never add any.",
  `Keep the token ${FIRST_NAME_TOKEN} wherever the greeting uses it.`,
  "Use plain text with the same light markdown the draft uses (**bold**, _italic_, - and 1. lists).",
  "Return only the email body: no subject line, no commentary.",
].join(" ");

export async function POST(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const access = await requireMeetingHost(id);
  if (!access.ok) return access.response;
  const payload = (await req.json().catch(() => ({}))) as { body?: unknown; tone?: unknown; instruction?: unknown; templateId?: unknown };

  // From a template: filled in, no model involved.
  if (typeof payload.templateId === "string") {
    const { data: template } = await access.db
      .from("followup_templates")
      .select("body")
      .eq("id", payload.templateId)
      .eq("organization_id", access.orgId)
      .maybeSingle();
    if (!template) return NextResponse.json({ error: "That template isn't available." }, { status: 404 });
    const host = await loadHost(await createServerClient(), access.userId);
    const ctx = await templateContext(access.db, id, access.meeting.title, host?.full_name ?? null);
    return NextResponse.json({ body: fillTemplate(String((template as { body: string }).body), ctx) });
  }

  const body = followUpBody(typeof payload.body === "string" ? payload.body : "");
  if (!body) return NextResponse.json({ error: "There's nothing to rework yet." }, { status: 400 });
  const tone = isTone(payload.tone) ? FOLLOW_UP_TONES.find((t) => t.value === payload.tone)! : null;
  const instruction = cleanInstruction(payload.instruction);
  if (!tone && !instruction) return NextResponse.json({ error: "Pick a tone or say what to change." }, { status: 400 });

  const apiKey = process.env.ANTHROPIC_API_KEY;
  if (!apiKey) return NextResponse.json({ error: "Rewriting isn't available here." }, { status: 503 });
  const limit = checkRateLimit({ key: `follow-up-rewrite:${access.userId}`, limit: 20, windowMs: 10 * 60_000 });
  if (!limit.ok) return NextResponse.json({ error: "That's a lot of rewrites — try again in a few minutes." }, { status: 429 });

  const ask = [tone?.instruction, instruction ? `Also: ${instruction}` : null].filter(Boolean).join(" ");
  try {
    const msg = await anthropicClient(apiKey, INTERACTIVE_TIMEOUT_MS).messages.create({
      model: MODEL,
      max_tokens: 2000,
      system: SYSTEM,
      messages: [{ role: "user", content: `${ask}\n\nThe draft:\n${body}` }],
    });
    const text = msg.content
      .filter((b) => b.type === "text")
      .map((b) => (b as { text: string }).text)
      .join("")
      .trim();
    const rewritten = followUpBody(text);
    if (!rewritten || msg.stop_reason === "max_tokens") {
      return NextResponse.json({ error: "The rewrite came back incomplete. Try again." }, { status: 502 });
    }
    return NextResponse.json({ body: rewritten });
  } catch (err) {
    console.warn("[follow-up/rewrite] failed", err);
    return NextResponse.json({ error: "Couldn't rework the email just now. Try again." }, { status: 502 });
  }
}
