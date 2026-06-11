'use client';

import { useState } from 'react';
import Link from 'next/link';
import { ArrowUpRight, Check, Loader2, ShieldCheck, Sparkles, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { executeEarnAction } from '@/lib/actions/earn-actions';

export interface EarnAction {
  id: string;
  name: string;
  input: Record<string, unknown>;
  mode: 'auto' | 'confirm';
}

const NAV_LABELS: Record<string, string> = {
  '/command-center': 'Command Center',
  '/pipeline': 'Pipeline',
  '/capital-stack': 'Capital Stack',
  '/profile': 'Profile',
  '/trust': 'Trust Center',
  '/materials': 'Materials',
  '/partners': 'Partners',
  '/match-inbox': 'Match Inbox',
  '/diligence': 'Diligence',
  '/audit': 'Audit',
  '/integrations': 'Integrations',
  '/settings': 'Settings'
};

/** Human-readable label for an in-app destination path (falls back to the raw path). */
function navLabel(dest: string): string {
  return NAV_LABELS[dest] ?? dest;
}

/** Human-readable description of what an action will do, for the confirm card. */
function describe(action: EarnAction): string {
  const i = action.input;
  if (action.name === 'create_deal') {
    const name = typeof i.name === 'string' ? i.name : 'a new deal';
    const amt = typeof i.amount === 'number' ? ` · $${i.amount.toLocaleString()}` : '';
    return `Create the deal “${name}”${amt} in your pipeline`;
  }
  if (action.name === 'run_diligence') {
    const on = typeof i.dealName === 'string' ? ` on ${i.dealName}` : '';
    return `Run the AI diligence committee${on}`;
  }
  if (action.name === 'navigate') {
    return `Open ${navLabel(String(i.destination ?? ''))}`;
  }
  return action.name;
}

/**
 * EarnActionCard — an interactive proposal Earn streamed alongside its reply.
 *
 * `navigate` (auto-mode) is already executed by the chat (client-side router);
 * this renders as a quiet "opened" chip with a re-open link. Mutating tools
 * (`create_deal`, `run_diligence`) render a Confirm / Dismiss card — nothing is
 * written until the operator approves — then show the result inline.
 */
export function EarnActionCard({
  action,
  navigatedTo
}: {
  action: EarnAction;
  /** For navigate actions, the destination the chat already pushed to. */
  navigatedTo?: string;
}) {
  const [state, setState] = useState<'idle' | 'running' | 'done' | 'error' | 'dismissed'>('idle');
  const [result, setResult] = useState<{ message?: string; href?: string; error?: string }>({});

  // Auto navigate — already handled by the chat; show a confirmation chip.
  if (action.name === 'navigate') {
    const dest = navigatedTo ?? String(action.input.destination ?? '');
    if (!dest) return null;
    return (
      <Link
        href={dest}
        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--azure-line)] bg-[var(--azure-soft)] px-2.5 py-1 text-[11px] font-semibold text-azure-1 transition hover:brightness-105"
      >
        <ArrowUpRight size={12} strokeWidth={2} aria-hidden />
        Opened {navLabel(dest)}
      </Link>
    );
  }

  if (state === 'dismissed') return null;

  async function confirm() {
    setState('running');
    try {
      const res = await executeEarnAction(action.name, action.input);
      if (res.ok) {
        setState('done');
        setResult({ message: res.message, href: res.href });
      } else {
        setState('error');
        setResult({ error: res.error });
      }
    } catch {
      setState('error');
      setResult({ error: 'That action could not be completed. Please try again.' });
    }
  }

  // Status line mirrors the onboarding prototype's ActionRunner staging:
  // draft ready → Earn is working… → applied.
  const status =
    state === 'running'
      ? 'Earn is working…'
      : state === 'done'
        ? 'Applied'
        : state === 'error'
          ? 'Couldn’t complete'
          : 'Draft ready for your review';

  return (
    <div
      className="overflow-hidden rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)]"
      data-testid={`earn-action-${action.name}`}
    >
      {/* Header — Earn + staged status */}
      <div className="flex items-center gap-2 px-3 py-2">
        <Sparkles size={14} strokeWidth={2} className="flex-none text-gold-1" aria-hidden />
        <p className="flex-1 text-[10px] font-semibold uppercase tracking-[0.11em] text-gold-1">
          Earn drafted an action
        </p>
        <span
          className={cn(
            'inline-flex items-center gap-1 text-[10.5px] font-medium',
            state === 'done' ? 'text-success' : state === 'error' ? 'text-danger' : 'text-gold-1'
          )}
        >
          {state === 'running' ? (
            <Loader2 size={11} strokeWidth={2.2} className="animate-spin" aria-hidden />
          ) : state === 'done' ? (
            <Check size={11} strokeWidth={2.4} aria-hidden />
          ) : null}
          {status}
        </span>
      </div>

      {/* Draft — what Earn will do, framed as a reviewable draft */}
      <div className="border-t border-[var(--gold-line)] bg-bg-1 px-3 py-2.5">
        <p className="text-[12.5px] text-fg-1">{describe(action)}</p>

        {state === 'done' ? (
          <>
            <p className="mt-1.5 flex items-center gap-1.5 text-[12px] text-success">
              <Check size={13} strokeWidth={2.2} aria-hidden />
              {result.message ?? 'Done.'}
              {result.href ? (
                <Link
                  href={result.href}
                  className="ml-1 inline-flex items-center gap-1 font-semibold text-azure-1 hover:underline"
                >
                  View
                  <ArrowUpRight size={11} strokeWidth={2} aria-hidden />
                </Link>
              ) : null}
            </p>
            <p className="mt-1 flex items-center gap-1.5 text-[10.5px] text-fg-4">
              <ShieldCheck size={11} strokeWidth={2} className="flex-none" aria-hidden />
              Logged to your record.
            </p>
          </>
        ) : state === 'error' ? (
          <p className="mt-1.5 text-[12px] text-danger">{result.error}</p>
        ) : (
          <>
            <p className="mt-2 flex items-center gap-1.5 text-[10.5px] text-fg-4">
              <Check size={11} strokeWidth={2} className="flex-none text-fg-4" aria-hidden />
              Nothing runs until you approve.
            </p>
            <div className="mt-2 flex items-center gap-2">
              <button
                type="button"
                onClick={confirm}
                disabled={state === 'running'}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-lg bg-[var(--cta-gradient,var(--gold-1))] px-2.5 py-1 text-[11.5px] font-semibold text-[#070b14] transition hover:brightness-110 disabled:opacity-60'
                )}
              >
                {state === 'running' ? (
                  <Loader2 size={12} strokeWidth={2.2} className="animate-spin" aria-hidden />
                ) : (
                  <Check size={12} strokeWidth={2.4} aria-hidden />
                )}
                {state === 'running' ? 'Working…' : 'Approve & run'}
              </button>
              <button
                type="button"
                onClick={() => setState('dismissed')}
                disabled={state === 'running'}
                className="inline-flex items-center gap-1 rounded-lg border border-hairline bg-surface-1 px-2.5 py-1 text-[11.5px] font-medium text-fg-3 transition hover:bg-surface-2 disabled:opacity-60"
              >
                <X size={12} strokeWidth={2.2} aria-hidden />
                Dismiss
              </button>
            </div>
          </>
        )}
      </div>
    </div>
  );
}

export default EarnActionCard;
