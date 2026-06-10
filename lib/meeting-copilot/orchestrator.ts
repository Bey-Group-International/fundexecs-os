import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import {
  ANALYST_AGENTS,
  ANALYST_SPECS,
  MEETING_COPILOT_MODELS,
  SYNTHESIS_AGENT,
  clampCommitment,
  type AnalystAgent
} from './config';
import {
  SHARED_SYSTEM,
  analystSystem,
  analystUserTurn,
  synthesisSystem,
  synthesisUserTurn,
  type FindingForSynthesis
} from './prompts';
import { meterAction } from '@/lib/credits/meter';
import { emitLoopEvent } from '@/lib/loop-events.server';
import { LOOP_EVENT_TYPES } from '@/lib/loop-events';
import { log } from '@/lib/observability/log';

/**
 * Meeting Copilot Intelligence Layer — the 4-agent orchestrator.
 *
 * All work here is trusted server-side work and uses the service-role client
 * for meeting_runs / meeting_findings reads/writes. Callers MUST verify org
 * membership before invoking `runMeetingCopilot` — see
 * `app/api/meeting-copilot/route.ts`.
 *
 * Metering policy (mirrors ask-earn / diligence): infrastructure failures fail
 * OPEN (a misconfig must never block the product); a genuine insufficient
 * balance fails CLOSED with a typed result the route can surface as 402.
 */

type Admin = ReturnType<typeof createAdminClient>;

export interface RunMeetingCopilotInput {
  orgId: string;
  createdBy: string;
  transcript: string;
  contactName?: string | null;
  dealId?: string | null;
}

export interface RunMeetingCopilotResult {
  runId: string;
  status: 'complete' | 'error' | 'insufficient_credits';
  commitmentProbability: number | null;
  sentiment: string | null;
  /** Present on `insufficient_credits` — the plan tier that unlocks this action. */
  upgradeTo?: string | null;
  error?: string;
}

interface AnalystResult {
  score: number | null;
  summary: string;
  detail: string | null;
  citations: unknown;
}

interface SynthesisResult {
  commitment_probability: number | null;
  sentiment: string;
  summary: string;
  follow_up_draft: string;
  top_objections: string[];
  next_actions: string[];
}

/** Extract concatenated text from a Claude response. */
function responseText(response: Anthropic.Message): string {
  return response.content
    .filter((b): b is Anthropic.TextBlock => b.type === 'text')
    .map((b) => b.text)
    .join('\n')
    .trim();
}

/** Parse a JSON object out of a model response, tolerating stray fencing. */
function parseJsonObject(text: string): Record<string, unknown> {
  const trimmed = text.trim();
  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    throw new Error('Model response did not contain a JSON object');
  }
  return JSON.parse(trimmed.slice(start, end + 1)) as Record<string, unknown>;
}

/** Run a single analytical agent over the transcript. */
async function runAnalyst(
  anthropic: Anthropic,
  agent: AnalystAgent,
  transcript: string
): Promise<AnalystResult> {
  const response = await anthropic.messages.create({
    model: MEETING_COPILOT_MODELS.analyst,
    max_tokens: 2048,
    system: [
      // Stable shared framing first → cacheable across all three analysts.
      { type: 'text', text: SHARED_SYSTEM, cache_control: { type: 'ephemeral' } },
      // Per-agent persona + mandate (small, varies by agent).
      { type: 'text', text: analystSystem(agent) }
    ],
    messages: [{ role: 'user', content: analystUserTurn(agent, transcript) }]
  });

  const parsed = parseJsonObject(responseText(response));
  return {
    score: clampCommitment(parsed.score),
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    detail: typeof parsed.detail === 'string' ? parsed.detail : null,
    citations: Array.isArray(parsed.citations) ? parsed.citations : []
  };
}

/** Delete-then-insert a finding for (run, agent) so re-runs don't duplicate. */
async function upsertFinding(
  admin: Admin,
  runId: string,
  orgId: string,
  agent: string,
  result: { score: number | null; summary: string; detail: string | null; citations: unknown }
): Promise<void> {
  await admin.from('meeting_findings').delete().eq('run_id', runId).eq('agent', agent);
  const { error } = await admin.from('meeting_findings').insert({
    run_id: runId,
    org_id: orgId,
    agent,
    score: result.score,
    summary: result.summary || '(no summary produced)',
    detail: result.detail,
    citations: (result.citations ?? []) as never
  });
  if (error) {
    throw new Error(`Failed to write ${agent} finding: ${error.message}`);
  }
}

async function runSynthesis(
  anthropic: Anthropic,
  findings: FindingForSynthesis[]
): Promise<SynthesisResult> {
  const response = await anthropic.messages.create({
    model: MEETING_COPILOT_MODELS.synthesis,
    max_tokens: 2048,
    system: [{ type: 'text', text: synthesisSystem(), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: synthesisUserTurn(findings) }]
  });
  const parsed = parseJsonObject(responseText(response));

  const topObjections = Array.isArray(parsed.top_objections)
    ? parsed.top_objections.filter((q): q is string => typeof q === 'string')
    : [];
  const nextActions = Array.isArray(parsed.next_actions)
    ? parsed.next_actions.filter((a): a is string => typeof a === 'string')
    : [];

  return {
    commitment_probability: clampCommitment(parsed.commitment_probability),
    sentiment:
      typeof parsed.sentiment === 'string' &&
      ['positive', 'neutral', 'negative'].includes(parsed.sentiment)
        ? parsed.sentiment
        : 'neutral',
    summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    follow_up_draft: typeof parsed.follow_up_draft === 'string' ? parsed.follow_up_draft : '',
    top_objections: topObjections,
    next_actions: nextActions
  };
}

/**
 * Execute the full 4-agent meeting analysis for a given transcript:
 *  1. Create a `meeting_runs` row (status queued).
 *  2. Meter the action — fail open on infra / fail closed on insufficient.
 *  3. Run three analyst agents in parallel over the transcript.
 *  4. Synthesis (Earn) over the three findings → run update + emit loop event.
 *
 * Never throws to the caller — all errors produce a typed result.
 */
export async function runMeetingCopilot(
  input: RunMeetingCopilotInput
): Promise<RunMeetingCopilotResult> {
  const admin = createAdminClient();
  let runId: string | null = null;

  try {
    // Insert the run row so we have an id for metering and findings.
    const { data: run, error: insertErr } = await admin
      .from('meeting_runs')
      .insert({
        org_id: input.orgId,
        created_by: input.createdBy,
        status: 'queued',
        contact_name: input.contactName ?? null,
        deal_id: input.dealId ?? null
      })
      .select('id')
      .single();

    if (insertErr || !run) {
      throw new Error(`Failed to create meeting run: ${insertErr?.message ?? 'unknown error'}`);
    }
    runId = run.id;

    // Meter the action up-front. Infra failures fail open so a misconfig can't
    // take the product offline; a genuine insufficient balance fails closed.
    const meter = await meterAction(input.orgId, 'meeting_copilot', runId);
    if (!meter.ok) {
      // Mark the run error so the row doesn't linger as queued.
      await admin
        .from('meeting_runs')
        .update({
          status: 'error',
          summary:
            'Insufficient credits — Meeting Copilot costs 10 credits. Top up or upgrade to continue.'
        })
        .eq('id', runId);
      return {
        runId,
        status: 'insufficient_credits',
        commitmentProbability: null,
        sentiment: null,
        upgradeTo: meter.upgradeTo ?? null
      };
    }

    // Ensure ANTHROPIC_API_KEY is present before doing any AI work.
    if (!process.env.ANTHROPIC_API_KEY) {
      log.warn('meeting_copilot_no_api_key', { orgId: input.orgId, runId });
      await admin
        .from('meeting_runs')
        .update({
          status: 'error',
          summary: 'AI service temporarily unavailable — no API key configured.'
        })
        .eq('id', runId);
      return {
        runId,
        status: 'error',
        commitmentProbability: null,
        sentiment: null,
        error: 'missing_api_key'
      };
    }

    await admin.from('meeting_runs').update({ status: 'running' }).eq('id', runId);
    const anthropic = new Anthropic();

    // Three analysts in parallel — each reads the transcript independently.
    const analystResults = await Promise.all(
      ANALYST_AGENTS.map(async (agent) => {
        const result = await runAnalyst(anthropic, agent, input.transcript);
        await upsertFinding(admin, runId!, input.orgId, agent, result);
        return { agent, result };
      })
    );

    // Feed the three findings (not the raw transcript) into Synthesis.
    const findingsForSynthesis: FindingForSynthesis[] = analystResults.map(({ agent, result }) => ({
      agent,
      label: ANALYST_SPECS[agent].label,
      score: result.score,
      summary: result.summary,
      detail: result.detail
    }));

    const synthesis = await runSynthesis(anthropic, findingsForSynthesis);

    // Persist synthesis finding alongside the analyst findings.
    await upsertFinding(admin, runId, input.orgId, SYNTHESIS_AGENT, {
      score: synthesis.commitment_probability,
      summary: synthesis.summary.slice(0, 280),
      detail: [
        synthesis.follow_up_draft,
        synthesis.top_objections.length
          ? `Top objections: ${synthesis.top_objections.join('; ')}`
          : '',
        synthesis.next_actions.length ? `Next actions: ${synthesis.next_actions.join('; ')}` : ''
      ]
        .filter(Boolean)
        .join('\n\n'),
      citations: synthesis.top_objections.map((o) => ({ objection: o }))
    });

    // Update the run row with the final outputs.
    await admin
      .from('meeting_runs')
      .update({
        status: 'complete',
        sentiment: synthesis.sentiment,
        commitment_probability: synthesis.commitment_probability,
        summary: synthesis.summary.slice(0, 500)
      })
      .eq('id', runId);

    // Best-effort loop event — never let telemetry block the return.
    void emitLoopEvent({
      orgId: input.orgId,
      verb: 'run',
      eventType: LOOP_EVENT_TYPES.meetingAnalyzed,
      entityType: 'meeting',
      entityId: runId,
      metadata: {
        commitment_probability: synthesis.commitment_probability,
        sentiment: synthesis.sentiment,
        contact_name: input.contactName ?? null,
        deal_id: input.dealId ?? null
      }
    });

    return {
      runId,
      status: 'complete',
      commitmentProbability: synthesis.commitment_probability,
      sentiment: synthesis.sentiment
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown meeting copilot error';
    log.error('meeting_copilot_run_failed', { runId, orgId: input.orgId, error: err });

    // Mark the run as error if we have a row id.
    if (runId) {
      await admin
        .from('meeting_runs')
        .update({ status: 'error', summary: `Meeting analysis failed: ${message}`.slice(0, 500) })
        .eq('id', runId)
        .then(undefined, () => {});
    }

    return {
      runId: runId ?? 'unknown',
      status: 'error',
      commitmentProbability: null,
      sentiment: null,
      error: message
    };
  }
}
