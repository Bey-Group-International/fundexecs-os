"use server";

import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { activateBrain } from "@/lib/brains/runtime";
import { BRAIN_BY_KEY } from "@/lib/brains/catalog";
import { PRESET_BY_ID } from "@/lib/brains/diligence";
import { pathFromAnswers, PATHS } from "@/lib/brains/frontdoor";
import type { BrainContext, DiligenceResponse, ClassifyResponse } from "@/lib/brains/types";
import { getDocumentText } from "@/lib/document-text.server";
import type { Document } from "@/lib/supabase/database.types";

/**
 * The text of a library document, for Earn to read. PDFs, Word, Excel and
 * PowerPoint files are extracted server-side (and cached); written documents
 * return their content. The org-scoped read is the authorization.
 */
export async function readLibraryDocument(
  documentId: string,
): Promise<{ ok: true; name: string; text: string } | { ok: false; error: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = await createServerClient();
  const { data } = await supabase
    .from("documents")
    .select("id, name, storage_key, content")
    .eq("id", documentId)
    .eq("organization_id", auth.ctx.orgId)
    .maybeSingle();
  const doc = data as Pick<Document, "id" | "name" | "storage_key" | "content"> | null;
  if (!doc) return { ok: false, error: "That document no longer exists." };
  if (doc.content && !doc.storage_key) return { ok: true, name: doc.name, text: doc.content };
  const result = await getDocumentText({ orgId: auth.ctx.orgId, documentId: doc.id, storageKey: doc.storage_key });
  if (!result || result.status === "unsupported") {
    return { ok: false, error: "Earn can't read this file type. Use PDF, .docx, .xlsx, .pptx, or text." };
  }
  if (result.status === "empty") return { ok: false, error: "This looks like a scan with no text layer. OCR it and re-upload." };
  if (result.status === "failed") return { ok: false, error: "Earn couldn't open this file. It may be password-protected." };
  return { ok: true, name: doc.name, text: result.text };
}

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
