import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { embedQuery, toVectorLiteral } from '@/lib/ai/voyage';
import {
  ANALYST_AGENTS,
  ANALYST_SPECS,
  DILIGENCE_MODELS,
  RETRIEVAL_MATCH_COUNT,
  SYNTHESIS_AGENT,
  type AnalystAgent
} from './config';
import {
  SHARED_SYSTEM,
  analystSystem,
  analystUserTurn,
  synthesisSystem,
  synthesisUserTurn,
  type FindingForSynthesis,
  type RetrievedChunk
} from './prompts';

/**
 * Earn Diligence Intelligence Layer — the 7-agent orchestrator.
 *
 * All work here is trusted server-side work and uses the service-role client
 * for diligence reads/writes and the `match_diligence_chunks` RPC (which is
 * service_role-only). Callers MUST verify org membership before invoking
 * `runDiligence` — see `app/api/diligence/route.ts`.
 */

type Admin = ReturnType<typeof createAdminClient>;

export interface CreateRunInput {
  orgId: string;
  createdBy: string;
  dealId?: string | null;
  /**
   * Optional human title. `diligence_runs` has no `title` column, so this seeds
   * the `summary` field as a placeholder until the run completes.
   */
  title?: string | null;
}

export interface DiligenceRunRow {
  id: string;
  org_id: string;
  deal_id: string | null;
  status: string;
  conviction: number | null;
  summary: string | null;
  created_by: string;
  created_at: string;
  updated_at: string;
}

/** Insert a queued diligence run and return it. */
export async function createDiligenceRun(input: CreateRunInput): Promise<DiligenceRunRow> {
  const admin = createAdminClient();
  const { data, error } = await admin
    .from('diligence_runs')
    .insert({
      org_id: input.orgId,
      created_by: input.createdBy,
      deal_id: input.dealId ?? null,
      status: 'queued',
      summary: input.title ?? null
    })
    .select('*')
    .single();
  if (error || !data) {
    throw new Error(`Failed to create diligence run: ${error?.message ?? 'unknown error'}`);
  }
  return data as DiligenceRunRow;
}

interface AnalystResult {
  score: number | null;
  summary: string;
  detail: string | null;
  citations: unknown;
}

interface SynthesisResult {
  conviction: number | null;
  memo: string;
  recommendation: string;
  followUpQuestions: string[];
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

function clampScore(value: unknown): number | null {
  const n = typeof value === 'number' ? value : Number(value);
  if (!Number.isFinite(n)) return null;
  return Math.max(0, Math.min(100, Math.round(n)));
}

/** Retrieve cited context for one agent via the service_role-only RPC. */
async function retrieveContext(
  admin: Admin,
  runId: string,
  agent: AnalystAgent
): Promise<RetrievedChunk[]> {
  const vector = await embedQuery(ANALYST_SPECS[agent].retrievalQuery);
  const { data, error } = await admin.rpc('match_diligence_chunks', {
    run_id: runId,
    query_embedding: toVectorLiteral(vector),
    match_count: RETRIEVAL_MATCH_COUNT
  });
  if (error) {
    throw new Error(`Retrieval failed for ${agent}: ${error.message}`);
  }
  return (data ?? []).map((d) => ({
    document_id: d.document_id,
    file_name: d.file_name,
    content: d.content
  }));
}

/** Run a single analytical agent: retrieve → call Claude → parse. */
async function runAnalyst(
  admin: Admin,
  anthropic: Anthropic,
  runId: string,
  agent: AnalystAgent
): Promise<AnalystResult> {
  const chunks = await retrieveContext(admin, runId, agent);

  const response = await anthropic.messages.create({
    model: DILIGENCE_MODELS.analyst,
    max_tokens: 2048,
    system: [
      // Stable shared framing first → cacheable across all six analysts.
      { type: 'text', text: SHARED_SYSTEM, cache_control: { type: 'ephemeral' } },
      // Per-agent persona + mandate (small, varies by agent).
      { type: 'text', text: analystSystem(agent) }
    ],
    messages: [{ role: 'user', content: analystUserTurn(agent, chunks) }]
  });

  const parsed = parseJsonObject(responseText(response));
  return {
    score: clampScore(parsed.score),
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
  await admin.from('diligence_findings').delete().eq('run_id', runId).eq('agent', agent);
  const { error } = await admin.from('diligence_findings').insert({
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
    model: DILIGENCE_MODELS.synthesis,
    max_tokens: 4096,
    system: [{ type: 'text', text: synthesisSystem(), cache_control: { type: 'ephemeral' } }],
    messages: [{ role: 'user', content: synthesisUserTurn(findings) }]
  });
  const parsed = parseJsonObject(responseText(response));
  const followUps = Array.isArray(parsed.followUpQuestions)
    ? parsed.followUpQuestions.filter((q): q is string => typeof q === 'string')
    : [];
  return {
    conviction: clampScore(parsed.conviction),
    memo: typeof parsed.memo === 'string' ? parsed.memo : '',
    recommendation: typeof parsed.recommendation === 'string' ? parsed.recommendation : '',
    followUpQuestions: followUps
  };
}

export interface RunDiligenceResult {
  runId: string;
  status: 'complete' | 'error';
  conviction: number | null;
  error?: string;
}

/**
 * Execute the full 7-agent diligence run for an existing `diligence_runs` row:
 *  1. status → running
 *  2. six analytical agents in parallel (retrieve → Claude → finding)
 *  3. Synthesis (Earn) over the six findings → synthesis finding + run update
 *
 * On any failure the run is marked `error` with the message stored in summary.
 */
export async function runDiligence(runId: string): Promise<RunDiligenceResult> {
  const admin = createAdminClient();

  // Load the run to resolve org_id and confirm it exists.
  const { data: run, error: loadErr } = await admin
    .from('diligence_runs')
    .select('id, org_id, status')
    .eq('id', runId)
    .single();
  if (loadErr || !run) {
    throw new Error(`Diligence run not found: ${runId}`);
  }
  const orgId = run.org_id;

  try {
    await admin.from('diligence_runs').update({ status: 'running' }).eq('id', runId);

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Missing ANTHROPIC_API_KEY');
    }
    const anthropic = new Anthropic();

    // Six analysts in parallel.
    const analystResults = await Promise.all(
      ANALYST_AGENTS.map(async (agent) => {
        const result = await runAnalyst(admin, anthropic, runId, agent);
        await upsertFinding(admin, runId, orgId, agent, result);
        return { agent, result };
      })
    );

    // Feed the six findings (not raw docs) into Synthesis.
    const findingsForSynthesis: FindingForSynthesis[] = analystResults.map(({ agent, result }) => ({
      agent,
      label: ANALYST_SPECS[agent].label,
      score: result.score,
      summary: result.summary,
      detail: result.detail
    }));

    const synthesis = await runSynthesis(anthropic, findingsForSynthesis);

    await upsertFinding(admin, runId, orgId, SYNTHESIS_AGENT, {
      score: synthesis.conviction,
      summary: synthesis.recommendation || synthesis.memo.slice(0, 280),
      detail: synthesis.memo,
      citations: synthesis.followUpQuestions.map((q) => ({ question: q }))
    });

    await admin
      .from('diligence_runs')
      .update({
        status: 'complete',
        conviction: synthesis.conviction,
        summary: synthesis.recommendation || synthesis.memo.slice(0, 280)
      })
      .eq('id', runId);

    return { runId, status: 'complete', conviction: synthesis.conviction };
  } catch (err) {
    const message = err instanceof Error ? err.message : 'Unknown diligence error';
    await admin
      .from('diligence_runs')
      .update({ status: 'error', summary: `Diligence failed: ${message}`.slice(0, 500) })
      .eq('id', runId);
    return { runId, status: 'error', conviction: null, error: message };
  }
}
