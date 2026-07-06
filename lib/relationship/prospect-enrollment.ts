// lib/relationship/prospect-enrollment.ts
// One-click enrollment: enroll a saved list's outreach-ready contacts into a
// sequence — the final "act on it" step. Every contact passes BOTH gates before
// enrollment: the compliance gate (suppression/consent, 1/4) and the review
// gate (low-confidence hold, 2/4), via checkBulkContactable. Nothing is sent
// here — enrollment schedules the sequence; sending stays a separate, gated
// step. sequenceStepsFromTemplate is pure (unit-tested).

import type { SupabaseClient } from "@supabase/supabase-js";
import type { Database } from "@/lib/supabase/database.types";
import { sequenceTemplate, type SequenceTemplate } from "@/lib/outreach";
import { createSequence, enrollTarget, type OutreachStep } from "@/lib/outreach-sequences";
import { checkBulkContactable } from "@/lib/compliance/contact-compliance";

// Map a display SequenceTemplate to the outreach_sequences step shape.
// outreach_sequences channels are email|slack|envelope, so LinkedIn/call
// templates land as email records (actual send is a separate, gated concern).
export function sequenceStepsFromTemplate(template: SequenceTemplate): OutreachStep[] {
  return template.steps.map((s, i) => ({
    step_index: i,
    channel: "email",
    delay_days: s.delay_days,
    subject: s.subject,
    body_template: s.body,
    stop_if_replied: true,
  }));
}

function loose(db: SupabaseClient<Database>): SupabaseClient {
  return db as unknown as SupabaseClient;
}

export interface EnrollResult {
  sequenceId: string | null;
  sequenceName: string | null;
  enrolled: number;
  held: number; // failed a gate (suppressed / unsubscribed / needs review)
  total: number;
}

// Enroll the eligible members of a saved list into a sequence built from the
// goal's template. RLS-scoped: the list must belong to the caller's org.
export async function enrollListReady(
  db: SupabaseClient<Database>,
  orgId: string,
  userId: string,
  args: { listId: string; templateKey: string; allowUnreviewed?: boolean },
): Promise<EnrollResult> {
  // Scope check: the list must be the caller's.
  const { data: list } = await loose(db)
    .from("contact_lists")
    .select("id")
    .eq("id", args.listId)
    .eq("organization_id", orgId)
    .maybeSingle();
  if (!list) return { sequenceId: null, sequenceName: null, enrolled: 0, held: 0, total: 0 };

  const { data: members } = await loose(db)
    .from("contact_list_members")
    .select("contact_id")
    .eq("list_id", args.listId);
  const contactIds = Array.from(
    new Set(((members ?? []) as { contact_id: string | null }[]).map((m) => m.contact_id).filter((x): x is string => Boolean(x))),
  );
  if (contactIds.length === 0) return { sequenceId: null, sequenceName: null, enrolled: 0, held: 0, total: 0 };

  // Both gates: compliance (suppression/consent) + review (low confidence).
  const gates = await Promise.all(
    contactIds.map((id) =>
      checkBulkContactable(db, orgId, id, { allowUnreviewed: args.allowUnreviewed }).then((g) => ({ id, eligible: g.eligible })),
    ),
  );
  const eligible = gates.filter((g) => g.eligible).map((g) => g.id);
  const held = contactIds.length - eligible.length;
  if (eligible.length === 0) {
    return { sequenceId: null, sequenceName: null, enrolled: 0, held, total: contactIds.length };
  }

  const template = sequenceTemplate(args.templateKey) ?? sequenceTemplate("linkedin_light")!;
  const sequence = await createSequence({
    org_id: orgId,
    name: template.name,
    steps: sequenceStepsFromTemplate(template),
    stop_on_reply: true,
    active: true,
    created_by: userId,
  });

  let enrolled = 0;
  for (const id of eligible) {
    try {
      // enrollTarget re-checks the compliance gate as a final backstop.
      await enrollTarget(sequence.id, "contact", id);
      enrolled += 1;
    } catch {
      // A contact blocked at the backstop just isn't enrolled.
    }
  }

  return { sequenceId: sequence.id, sequenceName: template.name, enrolled, held: contactIds.length - enrolled, total: contactIds.length };
}
