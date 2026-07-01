import { createServiceClient } from "@/lib/supabase/server";

// ---------------------------------------------------------------------------
// Interfaces
// ---------------------------------------------------------------------------

export interface OutreachStep {
  step_index: number;
  channel: "email" | "slack" | "envelope";
  delay_days: number;
  subject?: string;
  body_template: string;
  stop_if_replied?: boolean;
}

export interface OutreachSequence {
  id: string;
  org_id: string;
  name: string;
  steps: OutreachStep[];
  stop_on_reply: boolean;
  active: boolean;
  created_by?: string;
  created_at: string;
  updated_at: string;
}

export interface SequenceEnrollment {
  id: string;
  sequence_id: string;
  target_type: "investor" | "deal" | "contact";
  target_id: string;
  current_step: number;
  enrolled_at: string;
  next_step_at?: string;
  completed_at?: string;
  stopped_at?: string;
  stopped_reason?: string;
}

// ---------------------------------------------------------------------------
// createSequence
// ---------------------------------------------------------------------------

export async function createSequence(
  args: Omit<OutreachSequence, "id" | "created_at" | "updated_at">,
): Promise<OutreachSequence> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("outreach_sequences")
    .insert({
      org_id: args.org_id,
      name: args.name,
      steps: (args.steps as unknown) as import("@/lib/supabase/database.types").Json,
      stop_on_reply: args.stop_on_reply,
      active: args.active,
      created_by: args.created_by ?? null,
    })
    .select()
    .single();

  if (error) throw new Error(`createSequence: ${error.message}`);
  return (data as unknown) as OutreachSequence;
}

// ---------------------------------------------------------------------------
// enrollTarget
// ---------------------------------------------------------------------------

export async function enrollTarget(
  sequenceId: string,
  targetType: SequenceEnrollment["target_type"],
  targetId: string,
): Promise<SequenceEnrollment> {
  const db = createServiceClient();

  // Resolve first step delay to set next_step_at
  const { data: seq, error: seqErr } = await db
    .from("outreach_sequences")
    .select("steps")
    .eq("id", sequenceId)
    .single();

  if (seqErr) throw new Error(`enrollTarget: sequence lookup: ${seqErr.message}`);

  const steps: OutreachStep[] = ((seq?.steps as unknown) as OutreachStep[]) ?? [];
  const firstStep = steps.find((s) => s.step_index === 0) ?? steps[0];
  const delayDays = firstStep?.delay_days ?? 0;

  const nextStepAt = new Date();
  nextStepAt.setDate(nextStepAt.getDate() + delayDays);

  const { data, error } = await db
    .from("sequence_enrollments")
    .insert({
      sequence_id: sequenceId,
      target_type: targetType,
      target_id: targetId,
      current_step: 0,
      next_step_at: nextStepAt.toISOString(),
    })
    .select()
    .single();

  if (error) throw new Error(`enrollTarget: ${error.message}`);
  return data as SequenceEnrollment;
}

// ---------------------------------------------------------------------------
// listSequences
// ---------------------------------------------------------------------------

export async function listSequences(orgId: string): Promise<OutreachSequence[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("outreach_sequences")
    .select("*")
    .eq("org_id", orgId)
    .order("created_at", { ascending: false });

  if (error) throw new Error(`listSequences: ${error.message}`);
  return ((data ?? []) as unknown) as OutreachSequence[];
}

// ---------------------------------------------------------------------------
// listEnrollments
// ---------------------------------------------------------------------------

export async function listEnrollments(
  sequenceId: string,
): Promise<SequenceEnrollment[]> {
  const db = createServiceClient();
  const { data, error } = await db
    .from("sequence_enrollments")
    .select("*")
    .eq("sequence_id", sequenceId)
    .order("enrolled_at", { ascending: false });

  if (error) throw new Error(`listEnrollments: ${error.message}`);
  return (data ?? []) as SequenceEnrollment[];
}

// ---------------------------------------------------------------------------
// stopEnrollment
// ---------------------------------------------------------------------------

export async function stopEnrollment(
  enrollmentId: string,
  reason: string,
): Promise<void> {
  const db = createServiceClient();
  const { error } = await db
    .from("sequence_enrollments")
    .update({
      stopped_at: new Date().toISOString(),
      stopped_reason: reason,
    })
    .eq("id", enrollmentId);

  if (error) throw new Error(`stopEnrollment: ${error.message}`);
}

// ---------------------------------------------------------------------------
// processDueSteps
// ---------------------------------------------------------------------------

export async function processDueSteps(): Promise<number> {
  const db = createServiceClient();
  const now = new Date().toISOString();

  const { data: enrollments, error } = await db
    .from("sequence_enrollments")
    .select("*, outreach_sequences(steps, stop_on_reply)")
    .lte("next_step_at", now)
    .is("stopped_at", null)
    .is("completed_at", null);

  if (error) throw new Error(`processDueSteps: ${error.message}`);
  if (!enrollments || enrollments.length === 0) return 0;

  let processed = 0;

  for (const enrollment of enrollments) {
    const seq = (enrollment.outreach_sequences as unknown) as
      | { steps: OutreachStep[]; stop_on_reply: boolean }
      | null;
    if (!seq) continue;

    const steps: OutreachStep[] = seq.steps ?? [];
    const currentStep = enrollment.current_step as number;
    const currentStepDef = steps.find((s) => s.step_index === currentStep);

    if (!currentStepDef) {
      // No matching step definition — mark complete
      await db
        .from("sequence_enrollments")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", enrollment.id);
      processed++;
      continue;
    }

    // Future work: dispatch via channel gateway (email, slack, envelope)
    console.log(
      `[outreach-sequences] Processing enrollment ${enrollment.id} ` +
        `step ${currentStep} via ${currentStepDef.channel}`,
    );

    // Advance to next step or mark complete
    const nextStepDef = steps.find((s) => s.step_index === currentStep + 1);
    if (nextStepDef) {
      const nextStepAt = new Date();
      nextStepAt.setDate(nextStepAt.getDate() + nextStepDef.delay_days);

      await db
        .from("sequence_enrollments")
        .update({
          current_step: nextStepDef.step_index,
          next_step_at: nextStepAt.toISOString(),
        })
        .eq("id", enrollment.id);
    } else {
      await db
        .from("sequence_enrollments")
        .update({ completed_at: new Date().toISOString() })
        .eq("id", enrollment.id);
    }

    processed++;
  }

  return processed;
}
