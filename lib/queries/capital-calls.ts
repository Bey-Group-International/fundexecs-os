import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import {
  callDistStatus,
  callPosture,
  callProgress,
  capitalSummary,
  isCallKind,
  ledgerDistStatus,
  lpLineState,
  lpShare,
  type CallKind,
  type CallPosture,
  type CallProgress,
  type CapitalSummary,
  type DistStatusKey,
  type LpLineState
} from '@/lib/capital-calls/vocabulary';

/**
 * Read side of the Capital calls room. RLS-scoped; degrades to empty.
 *
 * Three real sources feed the surface: `capital_calls` + `call_lp_status`
 * (the drawdown funnel), `capital_commitments` (the committed total behind
 * the summary strip and per-line share fallbacks), and the LP Room's
 * `distributions` ledger (paid history on the Distributions view).
 */
export interface CallLpView {
  id: string;
  lpRef: string;
  status: string;
  /** The line's own share — stored pro-rata at issue; even-split fallback for legacy lines. */
  amount: number | null;
  /** Derived posture: resolved / pending / overdue (from the call's due date). */
  state: LpLineState;
  chasedAt: string | null;
}

export interface CapitalCallView {
  id: string;
  kind: CallKind;
  label: string;
  total: number | null;
  pct: number | null;
  dueAt: string | null;
  status: string;
  createdAt: string;
  lines: CallLpView[];
  progress: CallProgress;
  /** Funded so far, summed from resolved line amounts. */
  fundedAmount: number;
  overdueCount: number;
  posture: CallPosture;
}

export interface DistributionView {
  id: string;
  name: string;
  /** Where it came from — LP / memo (ledger) or the funnel readout (call). */
  detail: string;
  amount: number | null;
  status: DistStatusKey;
  /** ISO date used for ordering; display-formatted in the UI. */
  date: string | null;
  source: 'ledger' | 'call';
  /** Set for call-sourced rows so the UI can open their LP funnel. */
  callId: string | null;
}

export interface CapitalCallsData {
  calls: CapitalCallView[];
  /** Committed LPs on the Capital Map — the roster a new call draws against. */
  committedLps: string[];
  /** Committed / called / dry powder, from real commitments and issued calls. */
  summary: CapitalSummary;
  /** Merged: LP Room `distributions` ledger + in-flight call-sourced distributions. */
  distributions: DistributionView[];
  distributedTotal: number;
}

const COMMITTED_RE = /(commit|won|closed|funded)/;

export const getCapitalCallsData = cache(async (orgId: string): Promise<CapitalCallsData> => {
  const supabase = await createClient();
  const now = new Date();
  const [{ data: calls }, { data: lines }, { data: lps }, { data: commitments }, { data: ledger }] =
    await Promise.all([
      supabase
        .from('capital_calls')
        .select('id, kind, label, total, pct, due_at, status, created_at')
        .eq('org_id', orgId)
        .order('created_at', { ascending: false }),
      supabase
        .from('call_lp_status')
        .select('id, call_id, lp_ref, status, amount, chased_at')
        .eq('org_id', orgId)
        .order('lp_ref', { ascending: true }),
      supabase.from('capital_providers').select('id, name, status').eq('org_id', orgId),
      supabase.from('capital_commitments').select('lp_id, amount, stage').eq('org_id', orgId),
      supabase
        .from('distributions')
        .select('id, lp_id, amount, distribution_date, kind, status, memo')
        .eq('org_id', orgId)
        .order('distribution_date', { ascending: false })
    ]);

  const lineRows = lines ?? [];
  const linesByCall = new Map<string, typeof lineRows>();
  for (const l of lineRows) {
    if (!linesByCall.has(l.call_id)) linesByCall.set(l.call_id, []);
    linesByCall.get(l.call_id)!.push(l);
  }

  const views: CapitalCallView[] = (calls ?? [])
    .filter((c) => isCallKind(c.kind))
    .map((c) => {
      const kind = c.kind as CallKind;
      const raw = linesByCall.get(c.id) ?? [];
      const total = c.total != null ? Number(c.total) : null;
      const evenShare = lpShare(total, raw.length);
      const callLines: CallLpView[] = raw.map((l) => ({
        id: l.id,
        lpRef: l.lp_ref,
        status: l.status,
        amount: l.amount != null ? Number(l.amount) : evenShare,
        state: lpLineState(kind, l.status, c.status, c.due_at, now),
        chasedAt: l.chased_at
      }));
      const overdueCount = callLines.filter((l) => l.state === 'overdue').length;
      return {
        id: c.id,
        kind,
        label: c.label ?? (kind === 'call' ? 'Capital call' : 'Distribution'),
        total,
        pct: c.pct != null ? Number(c.pct) : null,
        dueAt: c.due_at,
        status: c.status,
        createdAt: c.created_at,
        lines: callLines,
        progress: callProgress(kind, callLines),
        fundedAmount: callLines
          .filter((l) => l.state === 'resolved')
          .reduce((s, l) => s + (l.amount ?? 0), 0),
        overdueCount,
        posture: callPosture(c.status, overdueCount)
      };
    });

  const committedLps = (lps ?? [])
    .filter((lp) => COMMITTED_RE.test((lp.status || '').toLowerCase()))
    .map((lp) => lp.name);

  const committedTotal = (commitments ?? [])
    .filter((c) => COMMITTED_RE.test((c.stage || '').toLowerCase()))
    .reduce((s, c) => {
      const amt = Number(c.amount);
      return s + (Number.isFinite(amt) && amt > 0 ? amt : 0);
    }, 0);

  const lpNameById = new Map((lps ?? []).map((lp) => [lp.id, lp.name]));
  const ledgerDists: DistributionView[] = (ledger ?? []).map((d) => {
    const amt = Number(d.amount);
    return {
      id: `ledger-${d.id}`,
      name: d.memo?.trim() || `Distribution — ${(d.kind || 'other').replace(/_/g, ' ')}`,
      detail: d.lp_id
        ? (lpNameById.get(d.lp_id) ?? 'LP')
        : `All LPs · ${(d.kind || 'other').replace(/_/g, ' ')}`,
      amount: Number.isFinite(amt) && amt > 0 ? amt : null,
      status: ledgerDistStatus(d.status, d.distribution_date, now),
      date: d.distribution_date,
      source: 'ledger',
      callId: null
    };
  });
  const callDists: DistributionView[] = views
    .filter((v) => v.kind === 'distribution')
    .map((v) => ({
      id: `call-${v.id}`,
      name: v.label,
      detail: `${v.progress.resolved} of ${v.progress.total} LP line${v.progress.total === 1 ? '' : 's'} paid`,
      amount: v.total,
      status: callDistStatus(v.status),
      date: v.dueAt ?? v.createdAt,
      source: 'call',
      callId: v.id
    }));
  const distributions = [...ledgerDists, ...callDists].sort((a, b) =>
    (b.date ?? '').localeCompare(a.date ?? '')
  );
  const distributedTotal = distributions
    .filter((d) => d.status === 'paid')
    .reduce((s, d) => s + (d.amount ?? 0), 0);

  return {
    calls: views,
    committedLps,
    summary: capitalSummary(committedTotal, views),
    distributions,
    distributedTotal
  };
});
