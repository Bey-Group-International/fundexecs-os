import 'server-only';
import Anthropic from '@anthropic-ai/sdk';
import { createAdminClient } from '@/lib/supabase/admin';
import { embedTexts, toVectorLiteral } from './voyage';
import { judgeMatch } from './match-judge';
import { refreshOrgProfileEmbedding } from './profile-embedding';
import { embedNetworkRecords } from './network-embeddings';
import { AI_MODELS } from './models';
import { fetchRecentFormD } from '@/lib/integrations/edgar';
import { fetchBotMemoPulse, pulseExternalId } from '@/lib/integrations/botmemo';
import {
  refreshComplianceTiers,
  type ComplianceRefreshSummary
} from '@/lib/strategy/compliance-refresh';

/* ============================================================================
 * lib/ai/intelligence-pipeline.ts — the live self-aware loop.
 *
 * One cycle, run on a schedule by /api/cron/intelligence:
 *   1. ingest    — pull EDGAR Form D filings, embed them, insert new signals
 *   2. embed     — backfill mandate embeddings for orgs that lack one
 *   3. network   — backfill embeddings for un-embedded LP/partner/contact rows
 *   4. score     — run generate_signal_matches for every active org
 *   5. judge     — Claude pre-judges the top few new high-score matches
 *   6. brief     — Earn writes each org a short daily briefing
 *   7. compliance — Adrian's standing compliance tier: ensure (never-empty),
 *                   age ignored items into High, draft follow-ups from the
 *                   Form ADV / Form D signals ingested in step 1
 *
 * Every step is never-block and independently wrapped: a failure in one (a
 * missing key, an EDGAR hiccup, a Claude timeout) is captured into the summary
 * and the cycle continues. The whole thing runs under the service role.
 * ========================================================================= */

const BRIEF_MODEL = AI_MODELS.chat;
const BRIEF_TIMEOUT_MS = 12_000;

export interface CycleSummary {
  ingest: { fetched: number; inserted: number };
  botmemo: { inserted: number };
  embed: { refreshed: number };
  network: { embedded: number; failed: number };
  score: { orgs: number; matchesCreated: number; failed: number };
  judge: { judged: number };
  brief: { written: number };
  compliance: ComplianceRefreshSummary;
  errors: string[];
}

type LooseDb = {
  from: (table: string) => {
    select: (cols: string) => Promise<{ data: Array<Record<string, unknown>> | null }>;
    upsert: (
      values: Record<string, unknown>,
      opts?: { onConflict?: string }
    ) => Promise<{ error: { message: string } | null }>;
  };
};

type Admin = ReturnType<typeof createAdminClient>;

/** Distinct org ids that have at least one active member. */
async function activeOrgIds(admin: Admin): Promise<string[]> {
  const { data } = await admin.from('org_members').select('org_id').eq('status', 'active');
  return [...new Set((data ?? []).map((r) => r.org_id))];
}

function embedText(issuer: string, formType: string): string {
  return `${issuer}. ${formType} private fundraising filing (SEC Form D, exempt offering).`;
}

/** 1. Ingest recent EDGAR Form D filings as embedded market signals. */
export async function ingestFormD(): Promise<{ fetched: number; inserted: number }> {
  const filings = await fetchRecentFormD(100);
  if (filings.length === 0) return { fetched: 0, inserted: 0 };

  const admin = createAdminClient();
  const accessions = filings.map((f) => f.accession);

  const { data: existing } = await admin
    .from('market_signals')
    .select('source_external_id')
    .eq('source', 'edgar-form-d')
    .in('source_external_id', accessions);

  const have = new Set((existing ?? []).map((r) => r.source_external_id));
  const fresh = filings.filter((f) => !have.has(f.accession));
  if (fresh.length === 0) return { fetched: filings.length, inserted: 0 };

  let embeddings: number[][] = [];
  if (process.env.VOYAGE_API_KEY) {
    try {
      embeddings = await embedTexts(
        fresh.map((f) => embedText(f.issuerName, f.formType)),
        'document'
      );
    } catch {
      embeddings = [];
    }
  }

  const rows = fresh.map((f, i) => ({
    source: 'edgar-form-d',
    source_external_id: f.accession,
    kind: 'private-fundraise',
    severity: 'info',
    routed_specialist: 'eleanor',
    occurred_at: f.occurredAt,
    normalized: {
      issuer_name: f.issuerName,
      form_type: f.formType,
      filing_href: f.filingHref
    },
    raw_payload: {
      accession: f.accession,
      form_type: f.formType,
      issuer_name: f.issuerName,
      filing_href: f.filingHref,
      occurred_at: f.occurredAt
    },
    embedding: embeddings[i] ? toVectorLiteral(embeddings[i]) : null
  }));

  const { error } = await admin
    .from('market_signals')
    .upsert(rows, { onConflict: 'source,source_external_id', ignoreDuplicates: true });

  return { fetched: filings.length, inserted: error ? 0 : rows.length };
}

/** 2. Backfill mandate embeddings for active orgs that don't have one yet. */
export async function refreshStaleMandateEmbeddings(maxOrgs = 25): Promise<{ refreshed: number }> {
  if (!process.env.VOYAGE_API_KEY) return { refreshed: 0 };
  const admin = createAdminClient();
  const ids = await activeOrgIds(admin);

  const db = admin as unknown as LooseDb;
  const { data: have } = await db.from('org_profile_embeddings').select('org_id');
  const haveSet = new Set((have ?? []).map((r) => String(r.org_id)));

  const missing = ids.filter((id) => !haveSet.has(id)).slice(0, maxOrgs);
  let refreshed = 0;
  for (const id of missing) {
    const result = await refreshOrgProfileEmbedding(id);
    if (result.ok) refreshed++;
  }
  return { refreshed };
}

/** 3. Score every active org against the current signal pool. */
export async function scoreActiveOrgs(): Promise<{
  orgs: number;
  matchesCreated: number;
  failed: number;
}> {
  const admin = createAdminClient();
  const ids = await activeOrgIds(admin);
  // Call `.rpc` AS A METHOD on the client — do not detach it into a const, or
  // it loses its `this` binding and throws before issuing the request.
  const db = admin as unknown as {
    rpc: (
      fn: string,
      args: Record<string, unknown>
    ) => Promise<{ data: number | null; error: { message: string } | null }>;
  };

  let orgs = 0;
  let matchesCreated = 0;
  let failed = 0;
  for (const id of ids) {
    try {
      const { data, error } = await db.rpc('generate_signal_matches', { _org_id: id });
      if (error) {
        failed++;
        console.warn('[scoreActiveOrgs] generate_signal_matches failed:', id, error.message);
      } else {
        orgs++;
        if (typeof data === 'number') matchesCreated += data;
      }
    } catch (err) {
      failed++;
      console.warn('[scoreActiveOrgs] generate_signal_matches threw:', id, err);
    }
  }
  return { orgs, matchesCreated, failed };
}

function hasJudge(rationale: unknown): boolean {
  return (
    Array.isArray(rationale) &&
    rationale.some(
      (f) => f && typeof f === 'object' && (f as { factor?: string }).factor === 'ai_judge'
    )
  );
}

/** 4. Pre-judge the top new high-confidence matches (cost-capped). */
export async function proactiveJudge(maxPerRun = 5, minScore = 70): Promise<{ judged: number }> {
  if (!process.env.ANTHROPIC_API_KEY) return { judged: 0 };
  const admin = createAdminClient();

  const { data } = await admin
    .from('matches')
    .select('id, rationale, score')
    .eq('kind', 'signal')
    .eq('status', 'new')
    .gte('score', minScore)
    .order('score', { ascending: false })
    .limit(maxPerRun * 4);

  const candidates = (data ?? []).filter((m) => !hasJudge(m.rationale)).slice(0, maxPerRun);
  let judged = 0;
  for (const m of candidates) {
    const result = await judgeMatch(m.id);
    if (result.ok) judged++;
  }
  return { judged };
}

interface BriefSignalRow {
  score: number;
  rationale: unknown;
  subject_id: string;
}

/** 5. Write each active org a short Earn briefing over its newest matches. */
export async function generateBriefings(maxOrgs = 25): Promise<{ written: number }> {
  if (!process.env.ANTHROPIC_API_KEY) return { written: 0 };
  const admin = createAdminClient();
  const ids = await activeOrgIds(admin);
  const db = admin as unknown as LooseDb;
  const client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });

  let written = 0;
  for (const orgId of ids.slice(0, maxOrgs)) {
    try {
      const { data: matches } = await admin
        .from('matches')
        .select('score, rationale, subject_id')
        .eq('org_id', orgId)
        .eq('kind', 'signal')
        .eq('status', 'new')
        .order('score', { ascending: false })
        .limit(5);

      const rows = (matches ?? []) as BriefSignalRow[];
      if (rows.length === 0) continue;

      const subjectIds = rows.map((r) => r.subject_id);
      const { data: signals } = await admin
        .from('market_signals')
        .select('id, normalized')
        .in('id', subjectIds);
      const nameById = new Map(
        (signals ?? []).map((s) => {
          const n = (s.normalized ?? {}) as Record<string, unknown>;
          return [s.id, String(n.issuer_name ?? 'a new filer')] as const;
        })
      );

      const lines = rows
        .map((r) => `- ${nameById.get(r.subject_id) ?? 'a new filer'} (score ${r.score}/100)`)
        .join('\n');

      const prompt = `Today's top new market-signal matches for this org:\n${lines}\n\nWrite a 2-3 sentence morning briefing as Eleanor, Head of Investor Relations, surfacing why these are worth attention and the single best next move. Sentence case, operator-grade, no greeting, no sign-off.`;

      let body = '';
      try {
        const response = await client.messages.create(
          {
            model: BRIEF_MODEL,
            max_tokens: 220,
            system:
              'You are Eleanor, Head of Investor Relations on the FundExecs OS executive team. Brief the operator on fresh capital-market signals. Decisive, concise, no fluff.',
            messages: [{ role: 'user', content: prompt }]
          },
          { signal: AbortSignal.timeout(BRIEF_TIMEOUT_MS) }
        );
        body = response.content
          .filter((b): b is Anthropic.TextBlock => b.type === 'text')
          .map((b) => b.text)
          .join('\n')
          .trim();
      } catch {
        continue;
      }
      if (!body) continue;

      const { error } = await db.from('intelligence_briefings').upsert(
        {
          org_id: orgId,
          body,
          match_count: rows.length,
          top_score: rows[0]?.score ?? null,
          generated_at: new Date().toISOString()
        },
        { onConflict: 'org_id' }
      );
      if (!error) written++;
    } catch {
      // never-block per org
    }
  }
  return { written };
}

/** Ingest the latest BotMemo market-pulse as a market signal. */
export async function ingestBotMemo(): Promise<{ inserted: number }> {
  const pulse = await fetchBotMemoPulse();
  const externalId = pulseExternalId(pulse);

  const admin = createAdminClient();
  const { data: existing } = await admin
    .from('market_signals')
    .select('id')
    .eq('source', 'botmemo')
    .eq('source_external_id', externalId)
    .limit(1);

  if ((existing ?? []).length > 0) return { inserted: 0 };

  const { error } = await admin.from('market_signals').insert({
    source: 'botmemo',
    source_external_id: externalId,
    kind: 'market-pulse',
    severity: 'info',
    occurred_at: pulse.fetchedAt,
    normalized: {
      total_capital_usd: pulse.totalCapitalUsd,
      deal_count: pulse.dealCount,
      period: pulse.period,
      startup_count: pulse.startupCount,
      top_verticals: pulse.topVerticals,
      source_url: pulse.sourceUrl,
    },
    raw_payload: JSON.parse(JSON.stringify(pulse)),
  });

  return { inserted: error ? 0 : 1 };
}

/** Run the full cycle. Each phase is isolated; errors are collected, not thrown. */
export async function runIntelligenceCycle(): Promise<CycleSummary> {
  const errors: string[] = [];
  const safe = async <T>(label: string, fn: () => Promise<T>, fallback: T): Promise<T> => {
    try {
      return await fn();
    } catch (err) {
      errors.push(`${label}: ${err instanceof Error ? err.message : 'unknown'}`);
      return fallback;
    }
  };

  const ingest = await safe('ingest', ingestFormD, { fetched: 0, inserted: 0 });
  const botmemo = await safe('botmemo', ingestBotMemo, { inserted: 0 });
  const embed = await safe('embed', () => refreshStaleMandateEmbeddings(), { refreshed: 0 });
  const network = await safe('network', () => embedNetworkRecords(), { embedded: 0, failed: 0 });
  const score = await safe('score', scoreActiveOrgs, { orgs: 0, matchesCreated: 0, failed: 0 });
  const judge = await safe('judge', () => proactiveJudge(), { judged: 0 });
  const brief = await safe('brief', () => generateBriefings(), { written: 0 });
  const compliance = await safe('compliance', refreshComplianceTiers, {
    orgs: 0,
    touched: 0,
    failed: 0
  });

  return { ingest, botmemo, embed, network, score, judge, brief, compliance, errors };
}
