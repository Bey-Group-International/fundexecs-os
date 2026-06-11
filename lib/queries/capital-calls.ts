import 'server-only';
import { cache } from 'react';
import { createClient } from '@/lib/supabase/server';
import {
  callProgress,
  isCallKind,
  lpShare,
  type CallKind,
  type CallProgress
} from '@/lib/capital-calls/vocabulary';

/**
 * Read side of the Capital calls room. RLS-scoped; degrades to empty.
 */
export interface CallLpView {
  id: string;
  lpRef: string;
  status: string;
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
  /** Even per-LP share of the total, when a total is set. */
  share: number | null;
}

export interface CapitalCallsData {
  calls: CapitalCallView[];
  /** Committed LPs on the Capital Map — the roster a new call draws against. */
  committedLps: string[];
}

const COMMITTED_RE = /(commit|won|closed|funded)/;

export const getCapitalCallsData = cache(async (orgId: string): Promise<CapitalCallsData> => {
  const supabase = await createClient();
  const [{ data: calls }, { data: lines }, { data: lps }] = await Promise.all([
    supabase
      .from('capital_calls')
      .select('id, kind, label, total, pct, due_at, status, created_at')
      .eq('org_id', orgId)
      .order('created_at', { ascending: false }),
    supabase
      .from('call_lp_status')
      .select('id, call_id, lp_ref, status')
      .eq('org_id', orgId)
      .order('lp_ref', { ascending: true }),
    supabase.from('capital_providers').select('name, status').eq('org_id', orgId)
  ]);

  const linesByCall = new Map<string, CallLpView[]>();
  for (const l of lines ?? []) {
    if (!linesByCall.has(l.call_id)) linesByCall.set(l.call_id, []);
    linesByCall.get(l.call_id)!.push({ id: l.id, lpRef: l.lp_ref, status: l.status });
  }

  const views: CapitalCallView[] = (calls ?? [])
    .filter((c) => isCallKind(c.kind))
    .map((c) => {
      const kind = c.kind as CallKind;
      const callLines = linesByCall.get(c.id) ?? [];
      const total = c.total != null ? Number(c.total) : null;
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
        share: lpShare(total, callLines.length)
      };
    });

  const committedLps = (lps ?? [])
    .filter((lp) => COMMITTED_RE.test((lp.status || '').toLowerCase()))
    .map((lp) => lp.name);

  return { calls: views, committedLps };
});
