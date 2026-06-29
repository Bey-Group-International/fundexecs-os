"use server";

// Server actions for Outbound Outreach Sequences. These are the thin auth +
// persistence wrappers around lib/outreach (the engine). The one rule that
// matters: a SEND never opens a new dispatch path — advanceSequenceStep routes
// the due step's ActionKind through the EXISTING gate via queueSourceAction
// (gateDecision → lib/integrations dispatch), so Tier-1 touches go out now and
// Tier-2/3 touches land in the operator's approvals.
//
// "use server" files export ONLY async functions; all types/consts live in the
// engine (lib/outreach.ts) so client bundles can `import type` them.
import { revalidatePath } from "next/cache";
import { createServerClient } from "@/lib/supabase/server";
import { requireOrgContext } from "@/lib/auth";
import { queueSourceAction } from "@/app/(app)/[hub]/[module]/source-ai-actions";
import {
  listSequences as listSequencesEngine,
  createSequence as createSequenceEngine,
  enroll as enrollEngine,
  listEnrollments as listEnrollmentsEngine,
  advanceEnrollment as advanceEnrollmentEngine,
  sequenceTemplate,
  coerceChannel,
  coerceStepAction,
  type OutreachChannel,
  type SequenceWithSteps,
  type EnrollmentWithProgress,
  type StepLike,
  type TemplateVars,
} from "@/lib/outreach";
import type { OutreachEnrollment, OutreachStep } from "@/lib/supabase/database.types";

// --- LIST -------------------------------------------------------------------
export interface ListSequencesResult {
  ok: boolean;
  sequences?: SequenceWithSteps[];
  error?: string;
}

export async function listOutreachSequences(): Promise<ListSequencesResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();
  const sequences = await listSequencesEngine(supabase, auth.ctx.orgId);
  return { ok: true, sequences };
}

// --- CREATE -----------------------------------------------------------------
export interface CreateSequenceActionResult {
  ok: boolean;
  sequence?: SequenceWithSteps;
  error?: string;
}

// Build a sequence from a built-in template, or from explicit steps.
export async function createOutreachSequence(input: {
  name: string;
  channel?: string;
  audience?: string | null;
  templateKey?: string | null;
  steps?: { delay_days: number; subject?: string | null; body?: string | null; action: string }[];
}): Promise<CreateSequenceActionResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };

  // Steps come from an explicit list or a named template (deterministic).
  const tpl = input.templateKey ? sequenceTemplate(input.templateKey) : null;
  const rawSteps = input.steps?.length ? input.steps : tpl?.steps ?? [];
  if (!rawSteps.length) return { ok: false, error: "A sequence needs at least one step." };

  const channel: OutreachChannel = coerceChannel(input.channel ?? tpl?.channel ?? "email");
  const supabase = createServerClient();
  const res = await createSequenceEngine(supabase, {
    orgId: auth.ctx.orgId,
    createdBy: auth.ctx.userId,
    name: input.name?.trim() || tpl?.name || "Untitled sequence",
    channel,
    audience: input.audience ?? tpl?.audience ?? null,
    status: "active",
    steps: rawSteps.map((s) => ({
      delay_days: Number(s.delay_days) || 0,
      subject: s.subject ?? null,
      body: s.body ?? null,
      action: coerceStepAction(s.action),
    })),
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/source/outreach");
  return { ok: true, sequence: res.sequence };
}

// --- ENROLL -----------------------------------------------------------------
export interface EnrollActionResult {
  ok: boolean;
  enrollment?: OutreachEnrollment;
  error?: string;
}

export async function enrollOutreachTarget(input: {
  sequenceId: string;
  subjectName: string;
  subjectEmail?: string | null;
  entityId?: string | null;
}): Promise<EnrollActionResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();
  const res = await enrollEngine(supabase, {
    orgId: auth.ctx.orgId,
    createdBy: auth.ctx.userId,
    sequenceId: input.sequenceId,
    subjectName: input.subjectName,
    subjectEmail: input.subjectEmail ?? null,
    entityId: input.entityId ?? null,
  });
  if (!res.ok) return { ok: false, error: res.error };
  revalidatePath("/source/outreach");
  return { ok: true, enrollment: res.enrollment };
}

// --- LIST ENROLLMENTS (with progress) ---------------------------------------
export interface ListEnrollmentsResult {
  ok: boolean;
  enrollments?: EnrollmentWithProgress[];
  error?: string;
}

export async function listOutreachEnrollments(sequenceId: string): Promise<ListEnrollmentsResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();
  const { data } = await supabase
    .from("outreach_steps")
    .select("step_order, delay_days, subject, body, action")
    .eq("organization_id", auth.ctx.orgId)
    .eq("sequence_id", sequenceId)
    .order("step_order", { ascending: true });
  const steps = ((data ?? []) as Pick<OutreachStep, "step_order" | "delay_days" | "subject" | "body" | "action">[]).map(
    (s): StepLike => ({
      step_order: s.step_order,
      delay_days: s.delay_days,
      subject: s.subject,
      body: s.body,
      action: s.action,
    }),
  );
  const enrollments = await listEnrollmentsEngine(supabase, auth.ctx.orgId, sequenceId, steps);
  return { ok: true, enrollments };
}

// --- ADVANCE / SEND (THROUGH THE GATE) --------------------------------------
export interface AdvanceActionResult {
  ok: boolean;
  /** True when the step was gated (Tier 2/3) and is awaiting approval. */
  gated?: boolean;
  tier?: 1 | 2 | 3;
  /** True when there was nothing due to send. */
  noop?: boolean;
  status?: string;
  sentStepOrder?: number;
  message?: string;
  error?: string;
}

// Advance one enrollment by its next due step. The send is dispatched through
// queueSourceAction — the SAME gate path used everywhere in Source — so this
// never bypasses operator control.
export async function advanceOutreachEnrollment(enrollmentId: string): Promise<AdvanceActionResult> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Not authorized." };
  const supabase = createServerClient();
  const orgId = auth.ctx.orgId;

  const { data: enrollment } = await supabase
    .from("outreach_enrollments")
    .select("*")
    .eq("organization_id", orgId)
    .eq("id", enrollmentId)
    .maybeSingle();
  if (!enrollment) return { ok: false, error: "Enrollment not found." };

  const { data: stepRows } = await supabase
    .from("outreach_steps")
    .select("step_order, delay_days, subject, body, action")
    .eq("organization_id", orgId)
    .eq("sequence_id", (enrollment as OutreachEnrollment).sequence_id)
    .order("step_order", { ascending: true });
  const steps = ((stepRows ?? []) as Pick<OutreachStep, "step_order" | "delay_days" | "subject" | "body" | "action">[]).map(
    (s): StepLike => ({
      step_order: s.step_order,
      delay_days: s.delay_days,
      subject: s.subject,
      body: s.body,
      action: s.action,
    }),
  );

  // Personalization vars for the template. The sender/firm fall back to the
  // org/operator identity (best-effort, never blocking).
  const vars: TemplateVars = {
    name: (enrollment as OutreachEnrollment).subject_name,
    email: (enrollment as OutreachEnrollment).subject_email ?? undefined,
    sender: auth.ctx.email,
  };

  const res = await advanceEnrollmentEngine(supabase, {
    orgId,
    enrollment: enrollment as OutreachEnrollment,
    steps,
    vars,
    // The dispatcher IS the gate: queueSourceAction classifies the action and
    // either dispatches (Tier 1) or opens an approval (Tier 2/3).
    dispatch: async (a) => {
      const r = await queueSourceAction({
        hub: "source",
        module: "outreach",
        name: a.name,
        email: a.email,
        action: a.action,
        label: a.label,
      });
      return {
        ok: r.ok,
        gated: r.gated,
        tier: r.tier,
        taskId: null,
        message: r.message ?? r.error,
      };
    },
  });

  revalidatePath("/source/outreach");
  if (!res.ok) return { ok: false, error: res.error };
  if (!res.outcome) {
    return { ok: true, noop: true, status: res.status, message: "Nothing is due to send yet." };
  }
  return {
    ok: true,
    gated: res.outcome.gated,
    tier: res.outcome.tier,
    status: res.status,
    sentStepOrder: res.sentStepOrder,
    message: res.outcome.message,
  };
}

// --- Delete & clear ---------------------------------------------------------

export async function deleteOutreachSequenceAction(
  sequenceId: string,
): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Unauthorized" };
  try {
    const supabase = createServerClient();
    const { error } = await supabase
      .from("outreach_sequences")
      .delete()
      .eq("id", sequenceId)
      .eq("organization_id", auth.ctx.orgId);
    if (error) throw error;
    revalidatePath("/source/outreach");
    return { ok: true };
  } catch (e) {
    console.error("[deleteOutreachSequenceAction] failed", e);
    return { ok: false, error: "Failed to delete sequence" };
  }
}

export async function clearOutreachSequencesAction(): Promise<{ ok: boolean; error?: string }> {
  const auth = await requireOrgContext();
  if (!auth.ok) return { ok: false, error: "Unauthorized" };
  try {
    const supabase = createServerClient();
    const { error } = await supabase
      .from("outreach_sequences")
      .delete()
      .eq("organization_id", auth.ctx.orgId);
    if (error) throw error;
    revalidatePath("/source/outreach");
    return { ok: true };
  } catch (e) {
    console.error("[clearOutreachSequencesAction] failed", e);
    return { ok: false, error: "Failed to clear sequences" };
  }
}
