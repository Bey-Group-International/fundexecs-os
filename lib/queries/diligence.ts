import 'server-only';
import { createClient } from '@/lib/supabase/server';
import {
  ANALYST_AGENTS,
  ANALYST_SPECS,
  SYNTHESIS_AGENT,
  SYNTHESIS_SLUG,
  personaFor,
  type AnalystAgent
} from '@/lib/diligence/config';

/**
 * Read-side loaders for the Diligence Intelligence Layer. Everything here goes
 * through the RLS-bound server client, so member-read RLS on `diligence_runs` /
 * `diligence_findings` applies — callers only ever see runs for orgs they belong
 * to. (The orchestrator writes via the service-role client; reads are scoped.)
 */

/** A diligence run summarised for list rendering. */
export interface DiligenceRunSummary {
  id: string;
  status: string;
  conviction: number | null;
  summary: string | null;
  dealId: string | null;
  createdAt: string;
  findingCount: number;
}

/** One analytical agent's finding, with its display persona resolved. */
export interface DiligenceAnalystFinding {
  agent: AnalystAgent;
  /** Display persona name (Theodore / Marcus / Vivian / Dalia / Sterling / Adrian). */
  personaLabel: string;
  /** The analytical lane label (e.g. "Market Size"). */
  laneLabel: string;
  score: number | null;
  summary: string;
  detail: string | null;
  citations: unknown[];
}

/** The Synthesis (Earn) verdict over the six analysts. */
export interface DiligenceSynthesis {
  /** Display persona name (Earn). */
  personaLabel: string;
  conviction: number | null;
  /** The full investment memo (stored as the synthesis finding's `detail`). */
  memo: string;
  /** The headline recommendation (stored as the synthesis finding's `summary`). */
  recommendation: string;
  followUpQuestions: string[];
}

/** A fully loaded diligence run: meta + analysts + synthesis. */
export interface DiligenceRunDetail {
  id: string;
  status: string;
  conviction: number | null;
  summary: string | null;
  dealId: string | null;
  dealName: string | null;
  createdAt: string;
  analysts: DiligenceAnalystFinding[];
  synthesis: DiligenceSynthesis | null;
}

type FindingRow = {
  agent: string;
  score: number | null;
  summary: string;
  detail: string | null;
  citations: unknown;
};

const ANALYST_ORDER = new Map<string, number>(ANALYST_AGENTS.map((a, i) => [a, i]));

function isAnalystAgent(agent: string): agent is AnalystAgent {
  return ANALYST_ORDER.has(agent);
}

/** Parse `[{ question }]`-shaped jsonb citations into a list of question strings. */
function parseFollowUpQuestions(citations: unknown): string[] {
  if (!Array.isArray(citations)) return [];
  return citations
    .map((c) =>
      c && typeof c === 'object' && 'question' in c
        ? (c as { question?: unknown }).question
        : undefined
    )
    .filter((q): q is string => typeof q === 'string' && q.trim().length > 0);
}

function toCitationArray(citations: unknown): unknown[] {
  return Array.isArray(citations) ? citations : [];
}

/**
 * List an org's diligence runs newest-first. Optionally filter to a single deal
 * (used by the deal drawer). Degrades to an empty list on any query error so the
 * caller never throws at render time.
 */
export async function getDiligenceRuns(
  orgId: string,
  opts?: { dealId?: string }
): Promise<DiligenceRunSummary[]> {
  const supabase = await createClient();

  let query = supabase
    .from('diligence_runs')
    .select('id, status, conviction, summary, deal_id, created_at')
    .eq('org_id', orgId)
    .order('created_at', { ascending: false });

  if (opts?.dealId) {
    query = query.eq('deal_id', opts.dealId);
  }

  const { data: runs, error } = await query;
  if (error || !runs) return [];

  // Count findings per run in one pass so the list can show progress.
  const runIds = runs.map((r) => r.id);
  const countByRun = new Map<string, number>();
  if (runIds.length > 0) {
    const { data: findings } = await supabase
      .from('diligence_findings')
      .select('run_id')
      .in('run_id', runIds);
    for (const f of (findings ?? []) as Array<{ run_id: string }>) {
      countByRun.set(f.run_id, (countByRun.get(f.run_id) ?? 0) + 1);
    }
  }

  return runs.map((r) => ({
    id: r.id,
    status: r.status,
    conviction: r.conviction,
    summary: r.summary,
    dealId: r.deal_id,
    createdAt: r.created_at,
    findingCount: countByRun.get(r.id) ?? 0
  }));
}

/**
 * Load a single diligence run with its findings split into the six ordered
 * analysts and the Synthesis verdict. Returns `null` when the run is not found
 * (or not visible under RLS).
 */
export async function getDiligenceRun(runId: string): Promise<DiligenceRunDetail | null> {
  const supabase = await createClient();

  const { data: run, error } = await supabase
    .from('diligence_runs')
    .select('id, status, conviction, summary, deal_id, created_at')
    .eq('id', runId)
    .maybeSingle();
  if (error || !run) return null;

  const { data: findingRows } = await supabase
    .from('diligence_findings')
    .select('agent, score, summary, detail, citations')
    .eq('run_id', runId);
  const findings = (findingRows ?? []) as FindingRow[];

  const analysts: DiligenceAnalystFinding[] = findings
    .filter((f) => isAnalystAgent(f.agent))
    .map((f) => {
      const agent = f.agent as AnalystAgent;
      const spec = ANALYST_SPECS[agent];
      return {
        agent,
        personaLabel: personaFor(spec.slug).name,
        laneLabel: spec.label,
        score: f.score,
        summary: f.summary,
        detail: f.detail,
        citations: toCitationArray(f.citations)
      };
    })
    .sort((a, b) => (ANALYST_ORDER.get(a.agent) ?? 0) - (ANALYST_ORDER.get(b.agent) ?? 0));

  const synthesisRow = findings.find((f) => f.agent === SYNTHESIS_AGENT);
  const synthesis: DiligenceSynthesis | null = synthesisRow
    ? {
        personaLabel: personaFor(SYNTHESIS_SLUG).name,
        conviction: synthesisRow.score ?? run.conviction,
        memo: synthesisRow.detail ?? '',
        recommendation: synthesisRow.summary ?? '',
        followUpQuestions: parseFollowUpQuestions(synthesisRow.citations)
      }
    : null;

  // Resolve the deal name (best-effort; RLS-scoped).
  let dealName: string | null = null;
  if (run.deal_id) {
    const { data: deal } = await supabase
      .from('deals')
      .select('name')
      .eq('id', run.deal_id)
      .maybeSingle();
    dealName = deal?.name ?? null;
  }

  return {
    id: run.id,
    status: run.status,
    conviction: run.conviction,
    summary: run.summary,
    dealId: run.deal_id,
    dealName,
    createdAt: run.created_at,
    analysts,
    synthesis
  };
}

/** One uploaded diligence document, with how much of it is indexed. */
export interface DiligenceDocumentView {
  id: string;
  fileName: string;
  kind: string;
  createdAt: string;
  /** Embedded passages — 0 means uploaded but not (yet) indexed. */
  chunkCount: number;
}

/**
 * List a run's uploaded documents with their indexed-chunk counts. RLS-scoped
 * (members read their org's documents/chunks); degrades to empty on failure.
 */
export async function getDiligenceDocuments(runId: string): Promise<DiligenceDocumentView[]> {
  const supabase = await createClient();
  const { data, error } = await supabase
    .from('diligence_documents')
    .select('id, file_name, kind, created_at, diligence_chunks(count)')
    .eq('run_id', runId)
    .order('created_at', { ascending: true });
  if (error || !data) return [];

  return data.map((d) => {
    const counts = d.diligence_chunks as unknown as { count: number }[] | null;
    return {
      id: d.id,
      fileName: d.file_name,
      kind: d.kind,
      createdAt: d.created_at,
      chunkCount: counts?.[0]?.count ?? 0
    };
  });
}
