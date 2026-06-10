import 'server-only';
import type { DashboardData, DashboardAction } from '@/lib/queries/dashboard';
import type { LoopChain } from '@/lib/loop-chain';
import type { HubHeadline, HubPanel } from '@/lib/loop-hub';
import type { VerbPulse } from '@/lib/loop-pulse';
import { loadVerbHubCommon } from '@/lib/loop-hub.server';
import { createClient } from '@/lib/supabase/server';
import { deriveRunPanels, rankRunFocus, runHeadline } from './workspace';

/**
 * lib/run/index.ts — the RUN verb's domain module (IO composition).
 *
 * One aggregate loader for the `/run` hub, on the same base every verb hub
 * uses (`loadVerbHubCommon`). The pure derivations live in `./workspace`.
 * The Meeting Copilot panel is populated from the latest `meeting_runs` row
 * for the org — a single lightweight query so hub load time stays fast.
 */

export interface RunWorkspace {
  panels: HubPanel[];
  headline: HubHeadline;
  /** The panel needing the operator first (stale stake, else today's plan). */
  focusKey: string | null;
  /** The verb's recent outcomes from loop_events (null = calm zero-state). */
  pulse: VerbPulse | null;
  chain: LoopChain;
  nextBestAction: DashboardAction | null;
  dashboard: DashboardData;
}

/**
 * Fetch the latest completed meeting_runs.commitment_probability for the org.
 * Best-effort: returns null on any error so a missing row never breaks the hub.
 */
async function loadLatestCommitmentProbability(orgId: string): Promise<number | null> {
  try {
    const supabase = await createClient();
    const { data } = await supabase
      .from('meeting_runs')
      .select('commitment_probability')
      .eq('org_id', orgId)
      .eq('status', 'complete')
      .order('created_at', { ascending: false })
      .limit(1)
      .maybeSingle();
    return data?.commitment_probability ?? null;
  } catch {
    return null;
  }
}

/** Load everything the `/run` hub renders, in one composed call. */
export async function loadRunWorkspace(orgId: string): Promise<RunWorkspace> {
  // Run the common hub load and the meeting-copilot query in parallel so
  // the extra query adds no serial latency to the hub.
  const [{ dashboard, chain, pulse }, latestCommitmentProbability] = await Promise.all([
    loadVerbHubCommon(orgId, 'run'),
    loadLatestCommitmentProbability(orgId)
  ]);

  const inputs = {
    diligence: dashboard.valueAtStake.diligence,
    dailyDone: dashboard.executionScore.dailyDone,
    dailyTotal: dashboard.executionScore.dailyTotal,
    latestCommitmentProbability
  };
  const panels = deriveRunPanels(inputs);

  return {
    panels,
    headline: runHeadline(inputs),
    focusKey: rankRunFocus(panels, inputs),
    pulse,
    chain,
    nextBestAction: dashboard.nextBestAction,
    dashboard
  };
}
