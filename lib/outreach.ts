// lib/outreach.ts
// The Outreach engine for the Source hub — multi-touch outbound cadences
// (the Hypergen / CapTarget core). A SEQUENCE is an ordered set of STEPS
// (email / linkedin / call), each with a delay and a gated ActionKind
// (lib/gates.ts). A target is ENROLLED into a sequence and ADVANCED one due
// step at a time. Crucially, a send is never a new uncontrolled path: advancing
// routes the step's ActionKind through the EXISTING gate (queueSourceAction →
// gateDecision → lib/integrations dispatch), so Tier-1 touches go out
// immediately and Tier-2/3 touches land in approvals.
//
// The pure half (nextStep / renderTemplate / sequenceProgress / DEFAULT_SEQUENCES)
// is deterministic and DB-free, so it is unit-testable and behaves identically
// with or without an ANTHROPIC_API_KEY (this engine needs no model at all). The
// DB-aware half (createSequence / listSequences / enroll / advanceEnrollment) is
// best-effort, mirroring lib/source-intelligence: a failed read degrades rather
// than breaking the flow.
import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  Database,
  OutreachSequence,
  OutreachStep,
  OutreachEnrollment,
} from "@/lib/supabase/database.types";
import type { ActionKind } from "@/lib/gates";
import { tierForAction } from "@/lib/gates";

type Client = SupabaseClient<Database>;

const DAY = 24 * 60 * 60 * 1000;

// The channels a cadence can run on, and the outreach-relevant ActionKinds a
// step can map to. Both are intentionally a safe subset — sends are external
// (Tier 2) at most; the gate rejects anything capital-binding regardless.
export type OutreachChannel = "email" | "linkedin" | "call";
export const OUTREACH_CHANNELS: OutreachChannel[] = ["email", "linkedin", "call"];

export type SequenceStatus = "draft" | "active" | "paused" | "archived";
export type EnrollmentStatus = "active" | "completed" | "replied" | "stopped";

// ActionKinds a step may carry. Drafting is Tier 1 (free); the actual touches
// are Tier 2 (gated). Kept aligned with lib/gates.ts.
export const OUTREACH_STEP_ACTIONS: ActionKind[] = [
  "draft_message",
  "send_outreach",
  "send_intro_request",
  "share_materials",
];

export function coerceChannel(v: unknown): OutreachChannel {
  return OUTREACH_CHANNELS.includes(v as OutreachChannel) ? (v as OutreachChannel) : "email";
}

export function coerceStepAction(v: unknown): ActionKind {
  return OUTREACH_STEP_ACTIONS.includes(v as ActionKind) ? (v as ActionKind) : "send_outreach";
}

// ---------------------------------------------------------------------------
// Pure shapes the engine reasons over (a subset of the DB rows, DB-free).
// ---------------------------------------------------------------------------
export interface StepLike {
  step_order: number;
  delay_days: number;
  subject: string | null;
  body: string | null;
  action: string;
}

export interface EnrollmentLike {
  current_step: number;
  status: string;
  last_sent_at: string | null;
}

// Template variables a step body/subject can interpolate.
export interface TemplateVars {
  name?: string;
  email?: string;
  firm?: string;
  sender?: string;
  [key: string]: string | undefined;
}

// ---------------------------------------------------------------------------
// PURE — nextStep: which step is due for an enrollment, honoring delays.
// ---------------------------------------------------------------------------
// Steps are 1-based by step_order; `current_step` is how many have been sent.
// The next candidate is the step at position current_step + 1. It is DUE only
// once its delay_days have elapsed since the last send (the first step, with no
// prior send, is always immediately due). Returns null when the sequence is
// finished, the enrollment is not active, or the next step is still waiting.
export interface NextStepResult {
  step: StepLike;
  /** Whether the step's delay has elapsed (false ⇒ scheduled, not yet due). */
  due: boolean;
  /** When the step becomes due (ISO), for scheduled steps. */
  dueAt: string | null;
}

export function nextStep(
  steps: StepLike[],
  enrollment: EnrollmentLike,
  now: Date = new Date(),
): NextStepResult | null {
  if (enrollment.status !== "active") return null;
  const ordered = [...steps].sort((a, b) => a.step_order - b.step_order);
  const sent = Math.max(0, enrollment.current_step);
  if (sent >= ordered.length) return null;
  const step = ordered[sent];
  if (!step) return null;

  // No prior send → the first due step is immediate.
  if (!enrollment.last_sent_at) {
    return { step, due: true, dueAt: null };
  }
  const last = new Date(enrollment.last_sent_at).getTime();
  if (!Number.isFinite(last)) return { step, due: true, dueAt: null };
  const dueTime = last + Math.max(0, step.delay_days) * DAY;
  const due = now.getTime() >= dueTime;
  return { step, due, dueAt: new Date(dueTime).toISOString() };
}

// ---------------------------------------------------------------------------
// PURE — renderTemplate: personalize {{name}} / {{firm}} / … in subject + body.
// ---------------------------------------------------------------------------
// Unknown placeholders are left intact (so a typo is visible, not silently
// dropped) unless a value is explicitly provided. Deterministic.
export function renderString(template: string | null | undefined, vars: TemplateVars): string {
  if (!template) return "";
  return template.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (match, key: string) => {
    const v = vars[key];
    return typeof v === "string" && v.length ? v : match;
  });
}

export interface RenderedStep {
  subject: string;
  body: string;
  action: ActionKind;
}

export function renderTemplate(step: StepLike, vars: TemplateVars): RenderedStep {
  return {
    subject: renderString(step.subject, vars),
    body: renderString(step.body, vars),
    action: coerceStepAction(step.action),
  };
}

// ---------------------------------------------------------------------------
// PURE — sequenceProgress: how far an enrollment has moved through a sequence.
// ---------------------------------------------------------------------------
export interface SequenceProgress {
  total: number;
  /** Steps already sent (clamped to total). */
  sent: number;
  /** 0–100 completion. */
  pct: number;
  /** The next step's 1-based order, or null when nothing remains. */
  nextStepOrder: number | null;
  /** A short human label for the enrollment's position. */
  label: string;
}

export function sequenceProgress(enrollment: EnrollmentLike, steps: StepLike[]): SequenceProgress {
  const total = steps.length;
  const sent = Math.min(Math.max(0, enrollment.current_step), total);
  const pct = total === 0 ? 0 : Math.round((sent / total) * 100);
  const finished = sent >= total;
  const ordered = [...steps].sort((a, b) => a.step_order - b.step_order);
  const nextStepOrder = !finished && enrollment.status === "active" ? ordered[sent]?.step_order ?? null : null;

  let label: string;
  if (enrollment.status === "replied") label = "Replied";
  else if (enrollment.status === "stopped") label = "Stopped";
  else if (finished || enrollment.status === "completed") label = "Completed";
  else label = `Step ${sent} of ${total}`;

  return { total, sent, pct, nextStepOrder, label };
}

// ---------------------------------------------------------------------------
// DEFAULT_SEQUENCES — ready-to-use cadence templates the operator can build from.
// Deterministic; no model required. Bodies use {{name}} / {{firm}} / {{sender}}.
// ---------------------------------------------------------------------------
export interface SequenceTemplateStep {
  delay_days: number;
  subject: string;
  body: string;
  action: ActionKind;
}
export interface SequenceTemplate {
  key: string;
  name: string;
  channel: OutreachChannel;
  audience: string;
  description: string;
  steps: SequenceTemplateStep[];
}

export const DEFAULT_SEQUENCES: SequenceTemplate[] = [
  {
    key: "lp_warm_intro",
    name: "LP warm intro — 3 touch",
    channel: "email",
    audience: "Allocators / LPs that fit the raise",
    description: "A classic three-touch allocator cadence: intro, value follow-up, soft close.",
    steps: [
      {
        delay_days: 0,
        subject: "Introducing {{firm}} — quick fit check",
        body:
          "Hi {{name}},\n\nI'm reaching out from {{firm}}. Based on your mandate I think there's a strong fit with what we're building. Open to a brief intro call?\n\n— {{sender}}",
        action: "send_intro_request",
      },
      {
        delay_days: 4,
        subject: "A bit more on {{firm}}",
        body:
          "Hi {{name}},\n\nFollowing up — here's a short overview of our thesis and track record. Happy to share the data room if useful.\n\n— {{sender}}",
        action: "share_materials",
      },
      {
        delay_days: 6,
        subject: "Worth a 20-min call?",
        body:
          "Hi {{name}},\n\nLast note from me for now — if the timing's better later, just say the word. Otherwise, would a 20-minute call this or next week work?\n\n— {{sender}}",
        action: "send_outreach",
      },
    ],
  },
  {
    key: "deal_owner_outreach",
    name: "Deal owner outreach — 4 touch",
    channel: "email",
    audience: "Founders / owners of on-thesis targets",
    description: "Off-market acquisition outreach to founder-owned businesses.",
    steps: [
      {
        delay_days: 0,
        subject: "Reaching out about {{firm}}",
        body:
          "Hi {{name}},\n\nWe invest in businesses like yours and admire what you've built. Would you be open to a confidential conversation?\n\n— {{sender}}",
        action: "send_outreach",
      },
      {
        delay_days: 5,
        subject: "Following up",
        body: "Hi {{name}},\n\nJust making sure this reached you. No agenda beyond getting to know the business.\n\n— {{sender}}",
        action: "send_outreach",
      },
      {
        delay_days: 7,
        subject: "How we work with owners",
        body:
          "Hi {{name}},\n\nA quick note on how we partner with owners through a transition — happy to send a one-pager.\n\n— {{sender}}",
        action: "share_materials",
      },
      {
        delay_days: 10,
        subject: "Closing the loop",
        body: "Hi {{name}},\n\nClosing the loop for now. If the timing changes, I'd welcome the conversation.\n\n— {{sender}}",
        action: "send_outreach",
      },
    ],
  },
  {
    key: "linkedin_light",
    name: "LinkedIn light touch — 2 step",
    channel: "linkedin",
    audience: "Partners / advisors / introducers",
    description: "A low-friction two-step LinkedIn connect-and-follow-up.",
    steps: [
      {
        delay_days: 0,
        subject: "Connect",
        body: "Hi {{name}} — following your work and would value connecting. — {{sender}}",
        action: "send_intro_request",
      },
      {
        delay_days: 3,
        subject: "Quick follow-up",
        body: "Thanks for connecting, {{name}}. Would a short call make sense to explore where we might help each other? — {{sender}}",
        action: "send_outreach",
      },
    ],
  },
];

export function sequenceTemplate(key: string): SequenceTemplate | null {
  return DEFAULT_SEQUENCES.find((t) => t.key === key) ?? null;
}

// ---------------------------------------------------------------------------
// DB-aware — all best-effort. These read/write the org-scoped tables under RLS.
// ---------------------------------------------------------------------------

export interface SequenceWithSteps extends OutreachSequence {
  steps: OutreachStep[];
}

/** List the org's sequences (newest first) with their ordered steps. */
export async function listSequences(supabase: Client, orgId: string): Promise<SequenceWithSteps[]> {
  try {
    const { data: seqs } = await supabase
      .from("outreach_sequences")
      .select("*")
      .eq("organization_id", orgId)
      .neq("status", "archived")
      .order("created_at", { ascending: false })
      .limit(100);
    const sequences = (seqs ?? []) as OutreachSequence[];
    if (!sequences.length) return [];
    const ids = sequences.map((s) => s.id);
    const { data: steps } = await supabase
      .from("outreach_steps")
      .select("*")
      .eq("organization_id", orgId)
      .in("sequence_id", ids)
      .order("step_order", { ascending: true });
    const bySeq = new Map<string, OutreachStep[]>();
    for (const st of (steps ?? []) as OutreachStep[]) {
      const arr = bySeq.get(st.sequence_id) ?? [];
      arr.push(st);
      bySeq.set(st.sequence_id, arr);
    }
    return sequences.map((s) => ({ ...s, steps: bySeq.get(s.id) ?? [] }));
  } catch {
    return [];
  }
}

export interface CreateSequenceInput {
  orgId: string;
  createdBy: string;
  name: string;
  channel: OutreachChannel;
  audience?: string | null;
  status?: SequenceStatus;
  steps: { delay_days: number; subject?: string | null; body?: string | null; action: ActionKind }[];
}

export interface CreateSequenceResult {
  ok: boolean;
  sequence?: SequenceWithSteps;
  error?: string;
}

/** Create a sequence and its ordered steps in one best-effort transaction-ish flow. */
export async function createSequence(supabase: Client, input: CreateSequenceInput): Promise<CreateSequenceResult> {
  const name = input.name.trim().slice(0, 160);
  if (!name) return { ok: false, error: "Name is required." };
  try {
    const { data: seq, error } = await supabase
      .from("outreach_sequences")
      .insert({
        organization_id: input.orgId,
        name,
        channel: coerceChannel(input.channel),
        audience: input.audience?.trim().slice(0, 240) ?? null,
        status: input.status ?? "active",
        created_by: input.createdBy,
      })
      .select("*")
      .single();
    if (error || !seq) return { ok: false, error: error?.message ?? "Could not create sequence." };

    const stepRows = input.steps.map((s, i) => ({
      organization_id: input.orgId,
      sequence_id: (seq as OutreachSequence).id,
      step_order: i + 1,
      delay_days: Math.max(0, Math.round(s.delay_days)),
      subject: s.subject?.slice(0, 240) ?? null,
      body: s.body?.slice(0, 4000) ?? null,
      action: coerceStepAction(s.action),
    }));
    let steps: OutreachStep[] = [];
    if (stepRows.length) {
      const { data: ins } = await supabase.from("outreach_steps").insert(stepRows).select("*");
      steps = ((ins ?? []) as OutreachStep[]).sort((a, b) => a.step_order - b.step_order);
    }
    return { ok: true, sequence: { ...(seq as OutreachSequence), steps } };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not create sequence." };
  }
}

export interface EnrollInput {
  orgId: string;
  createdBy: string;
  sequenceId: string;
  subjectName: string;
  subjectEmail?: string | null;
  entityId?: string | null;
}

export interface EnrollResult {
  ok: boolean;
  enrollment?: OutreachEnrollment;
  error?: string;
}

/** Enroll a target into a sequence (status 'active', current_step 0). */
export async function enroll(supabase: Client, input: EnrollInput): Promise<EnrollResult> {
  const subjectName = input.subjectName.trim().slice(0, 160);
  if (!subjectName) return { ok: false, error: "A target name is required." };
  try {
    const { data, error } = await supabase
      .from("outreach_enrollments")
      .insert({
        organization_id: input.orgId,
        sequence_id: input.sequenceId,
        subject_name: subjectName,
        subject_email: input.subjectEmail?.trim().slice(0, 240) ?? null,
        entity_id: input.entityId ?? null,
        current_step: 0,
        status: "active",
        created_by: input.createdBy,
      })
      .select("*")
      .single();
    if (error || !data) return { ok: false, error: error?.message ?? "Could not enroll target." };
    return { ok: true, enrollment: data as OutreachEnrollment };
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Could not enroll target." };
  }
}

export interface EnrollmentWithProgress {
  enrollment: OutreachEnrollment;
  progress: SequenceProgress;
}

/** List enrollments for a sequence with computed progress (newest first). */
export async function listEnrollments(
  supabase: Client,
  orgId: string,
  sequenceId: string,
  steps: StepLike[],
): Promise<EnrollmentWithProgress[]> {
  try {
    const { data } = await supabase
      .from("outreach_enrollments")
      .select("*")
      .eq("organization_id", orgId)
      .eq("sequence_id", sequenceId)
      .order("updated_at", { ascending: false })
      .limit(200);
    const rows = (data ?? []) as OutreachEnrollment[];
    return rows.map((enrollment) => ({ enrollment, progress: sequenceProgress(enrollment, steps) }));
  } catch {
    return [];
  }
}

// The send seam: advanceEnrollment must route through the gate, but lib/outreach
// stays free of the server-action layer. The caller (outreach-actions.ts) passes
// a dispatcher that wraps queueSourceAction; here we only compute the due step,
// call it, and record the result. This keeps the engine DB-aware but free of
// "use server" / next/cache imports.
export interface SendOutcome {
  ok: boolean;
  gated?: boolean;
  tier?: 1 | 2 | 3;
  taskId?: string | null;
  message?: string;
}
export type StepDispatcher = (args: {
  name: string;
  email?: string;
  action: ActionKind;
  label: string;
  subject: string;
  body: string;
}) => Promise<SendOutcome>;

export interface AdvanceResult {
  ok: boolean;
  /** null when nothing was due / sequence finished. */
  outcome?: SendOutcome | null;
  status?: EnrollmentStatus;
  error?: string;
  /** The step order that was sent, when one was. */
  sentStepOrder?: number;
}

/**
 * Advance one enrollment by its next DUE step: render the template, dispatch the
 * step's ActionKind THROUGH THE GATE (via the injected dispatcher), then record
 * task_id + last_sent_at and bump current_step. Best-effort and idempotent-ish:
 * if no step is due (or the sequence is finished) it returns ok with a null
 * outcome and does not mutate. The vars used for personalization are passed in.
 */
export async function advanceEnrollment(
  supabase: Client,
  args: {
    orgId: string;
    enrollment: OutreachEnrollment;
    steps: StepLike[];
    vars: TemplateVars;
    dispatch: StepDispatcher;
    now?: Date;
  },
): Promise<AdvanceResult> {
  const { enrollment, steps, vars, dispatch } = args;
  const now = args.now ?? new Date();

  const due = nextStep(steps, enrollment, now);
  if (!due) {
    // Either finished, not active, or the next step is still scheduled.
    const finished = enrollment.current_step >= steps.length;
    if (finished && enrollment.status === "active") {
      try {
        await supabase
          .from("outreach_enrollments")
          .update({ status: "completed" })
          .eq("id", enrollment.id)
          .eq("organization_id", args.orgId);
      } catch {
        /* best-effort */
      }
      return { ok: true, outcome: null, status: "completed" };
    }
    return { ok: true, outcome: null };
  }
  if (!due.due) {
    // Next step exists but its delay hasn't elapsed — nothing to send yet.
    return { ok: true, outcome: null };
  }

  const rendered = renderTemplate(due.step, vars);
  const tier = tierForAction(rendered.action);
  const label = `Outreach step ${due.step.step_order}`;

  let outcome: SendOutcome;
  try {
    outcome = await dispatch({
      name: enrollment.subject_name,
      email: enrollment.subject_email ?? undefined,
      action: rendered.action,
      label,
      subject: rendered.subject,
      body: rendered.body,
    });
  } catch (err) {
    return { ok: false, error: err instanceof Error ? err.message : "Dispatch failed." };
  }
  if (!outcome.ok) {
    return { ok: false, outcome, error: outcome.message ?? "Send failed." };
  }

  // Record the gate task + advance the cursor. We count the step as sent whether
  // it dispatched (Tier 1) or is awaiting approval (Tier 2/3): the touch has been
  // initiated and the gate now owns its completion.
  const nextCursor = enrollment.current_step + 1;
  const completed = nextCursor >= steps.length;
  try {
    await supabase
      .from("outreach_enrollments")
      .update({
        current_step: nextCursor,
        last_sent_at: now.toISOString(),
        task_id: outcome.taskId ?? null,
        status: completed ? "completed" : "active",
      })
      .eq("id", enrollment.id)
      .eq("organization_id", args.orgId);
  } catch {
    /* best-effort — the gate task already exists */
  }

  return {
    ok: true,
    outcome: { ...outcome, tier: outcome.tier ?? tier },
    status: completed ? "completed" : "active",
    sentStepOrder: due.step.step_order,
  };
}

// Pure helpers exposed for unit tests (mirrors the __test convention used across
// the codebase, e.g. lib/source-ai.ts).
export const __test = {
  nextStep,
  renderString,
  renderTemplate,
  sequenceProgress,
  coerceChannel,
  coerceStepAction,
  sequenceTemplate,
  DEFAULT_SEQUENCES,
  tierForAction,
};
