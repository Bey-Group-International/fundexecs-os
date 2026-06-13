'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { parseLpMeta } from '@/lib/pipeline/lp-meta';
import { normalizeLpStage } from '@/lib/pipeline/lp-stages';
import { generateOutreachWithEarn } from '@/lib/ai/outreach';
import type { OutreachResult, OutreachStage } from '@/lib/capital-formation/outreach';

/* ============================================================================
 * lib/actions/outreach.ts — draft personalized LP outreach with Earn.
 *
 * Reads the LP (capital_providers) + the org's fund profile, then asks Earn
 * (Sloane) for a first-touch/follow-up note matched to the LP's pipeline
 * stage. Returns the draft for the operator to review, edit, and send — it
 * does not persist or send anything (nothing leaves FundExecs OS).
 * ========================================================================= */

export type GenerateOutreachResult =
  | { ok: true; result: OutreachResult }
  | { ok: false; error: string };

export async function generateLpOutreach(lpId: string): Promise<GenerateOutreachResult> {
  if (!lpId?.trim()) return { ok: false, error: 'Missing LP.' };

  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active organization.' };

  const supabase = await createClient();
  const { data: lp, error } = await supabase
    .from('capital_providers')
    .select('id, name, status, capital_types, criteria')
    .eq('id', lpId)
    .eq('org_id', org.orgId)
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!lp) return { ok: false, error: 'LP not found on your map.' };

  const meta = parseLpMeta(lp.criteria);
  const stage = normalizeLpStage(lp.status);
  const profile = await getFundProfile(org.orgId).catch(() => null);

  const result = await generateOutreachWithEarn({
    lp: {
      name: lp.name,
      capitalTypes: lp.capital_types ?? [],
      stage: (stage === 'passed' ? 'prospect' : stage) as OutreachStage,
      fitRationale: meta.fitRationale ?? meta.description,
      warmth: meta.warmth
    },
    fund: {
      name: profile?.fundName ?? 'your fund',
      thesis: profile?.thesis ?? null,
      strategy: profile?.strategy ?? null,
      targetRaise: profile?.targetRaise ?? null
    },
    senderName: profile?.managerName ?? null
  });

  return { ok: true, result };
}
