"use server";

import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { activateBrain } from "@/lib/brains/runtime";
import { BRAIN_BY_KEY } from "@/lib/brains/catalog";
import { PRESET_BY_ID } from "@/lib/brains/diligence";
import { pathFromAnswers, PATHS } from "@/lib/brains/frontdoor";
import type { BrainContext, DiligenceResponse, ClassifyResponse } from "@/lib/brains/types";

// Earn Diligence Brain — run a preset query against pasted/uploaded document
// text. Persists the source as a brain_document, activates the routed Brain, and
// returns the deliverable + audit (tools used, reasoning) for inline render.
export async function askDiligence(input: {
  presetId: string;
  docName: string;
  docText: string;
  sessionId?: string | null;
}): Promise<DiligenceResponse> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };

  const preset = PRESET_BY_ID[input.presetId];
  if (!preset) return { ok: false, error: "Unknown query." };

  const docText = (input.docText ?? "").trim();
  if (!docText) return { ok: false, error: "Paste or upload a document first." };

  const supabase = await createServerClient();
  const orgId = auth.ctx.orgId;
  const name = (input.docName ?? "").trim() || "Untitled document";

  // Persist the source so the Brain's work is grounded in a stored document.
  await supabase.from("brain_documents").insert({
    organization_id: orgId,
    session_id: input.sessionId ?? null,
    name,
    content: docText.slice(0, 100_000),
    created_by: auth.ctx.userId,
  });

  const ctx: BrainContext = {
    supabase,
    orgId,
    userId: auth.ctx.userId,
    sessionId: input.sessionId ?? null,
  };

  const result = await activateBrain(ctx, preset.brain, {
    objective: preset.goal,
    documents: [{ name, content: docText }],
    autonomy: "manual",
  });

  return {
    ok: true,
    brainName: BRAIN_BY_KEY[preset.brain].name,
    output: result.output,
    toolsUsed: result.toolsUsed,
    reasoning: result.reasoning,
  };
}

// Front Door — Earnest classifies the visitor's answers into a routed path and
// returns a short tailored note. Routing itself is deterministic; the note is
// the Brain's voice (stubbed when no model key).
export async function classifyVisitor(answers: Record<string, string>): Promise<ClassifyResponse> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false };

  const pathKey = pathFromAnswers(answers);
  const path = PATHS[pathKey];

  const supabase = await createServerClient();
  const ctx: BrainContext = {
    supabase,
    orgId: auth.ctx.orgId,
    userId: auth.ctx.userId,
  };

  const result = await activateBrain(ctx, "earnest_fundmaker", {
    objective:
      `Classify this visitor and write a two-sentence welcome that moves them toward their next action. ` +
      `Routed path: ${path.label} — ${path.blurb}`,
    context: Object.entries(answers)
      .map(([k, v]) => `${k}: ${v}`)
      .join("\n"),
    autonomy: "auto",
  });

  return { ok: true, note: result.output };
}
