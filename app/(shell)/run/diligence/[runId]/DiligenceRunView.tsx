'use client';

import { useEffect, useRef, useState } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import {
  AlertTriangle,
  Building2,
  CheckCircle2,
  CircleCheckBig,
  FileSearch,
  Gauge,
  Info,
  ListChecks,
  Loader,
  Sparkles,
  X
} from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { resolveDiligenceFinding } from '@/lib/actions/diligence';
import {
  SEVERITY_TONE,
  WORKSTREAM_STATUS,
  runVerdict,
  scoreColor,
  statusLabel,
  statusTone,
  workstreamSeverity,
  workstreamStatus,
  type WorkstreamStatus as WsStatus
} from '@/lib/diligence-ui';
import type {
  DiligenceAnalystFinding,
  DiligenceRunDetail,
  DiligenceRunSummary
} from '@/lib/queries/diligence';
import { cn } from '@/lib/utils';

/* ── helpers ─────────────────────────────────────────────────────────────── */

const STATUS_ICON: Record<WsStatus, typeof CheckCircle2> = {
  clear: CheckCircle2,
  caution: Info,
  flag: AlertTriangle,
  pending: Loader
};

const VERDICT_TONE_VARS: Record<string, { c: string; bg: string; b: string }> = {
  danger: { c: 'var(--danger)', bg: 'var(--danger-soft)', b: 'var(--danger-line)' },
  warning: { c: 'var(--warning)', bg: 'var(--warning-soft)', b: 'var(--warning-line)' },
  info: { c: 'var(--info)', bg: 'var(--info-soft)', b: 'var(--info-line)' },
  success: { c: 'var(--success)', bg: 'var(--success-soft)', b: 'var(--success-line)' }
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return iso;
  }
}

function wsOf(f: DiligenceAnalystFinding) {
  const status = workstreamStatus(f.score, f.resolvedAt != null);
  return { status, severity: workstreamSeverity(f.score) };
}

/* ── modal focus management (mirrors the house drawer pattern) ───────────── */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function useModalFocus(onClose: () => void) {
  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(FOCUSABLE)?.focus();
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(FOCUSABLE));
      if (focusable.length === 0) return;
      const first = focusable[0];
      const last = focusable[focusable.length - 1];
      const active = document.activeElement;
      if (e.shiftKey && (active === first || !panel.contains(active))) {
        e.preventDefault();
        last.focus();
      } else if (!e.shiftKey && (active === last || !panel.contains(active))) {
        e.preventDefault();
        first.focus();
      }
    }
    document.addEventListener('keydown', onKey, true);
    return () => {
      document.removeEventListener('keydown', onKey, true);
      document.body.style.overflow = prevOverflow;
      openerRef.current?.focus?.();
    };
  }, [onClose]);

  return panelRef;
}

/* ── the workstream resolution drawer ────────────────────────────────────── */

function WorkstreamDrawer({
  finding,
  onClose,
  onResolve
}: {
  finding: DiligenceAnalystFinding;
  onClose: () => void;
  onResolve: (finding: DiligenceAnalystFinding) => void;
}) {
  const panelRef = useModalFocus(onClose);
  const { status, severity } = wsOf(finding);
  const chip = WORKSTREAM_STATUS[status];

  return (
    <>
      <div
        onClick={onClose}
        className="fixed inset-0 z-[60] bg-[rgba(3,6,12,0.64)] backdrop-blur-[3px]"
        aria-hidden
      />
      <div
        ref={panelRef}
        role="dialog"
        aria-modal="true"
        aria-label={finding.laneLabel}
        className="fixed bottom-0 right-0 top-0 z-[61] w-[440px] max-w-[94vw] overflow-y-auto border-l border-[var(--border-strong)] bg-bg-2 shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
          <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border border-hairline bg-surface-2 text-fg-2">
            <FileSearch size={20} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15.5px] font-semibold text-fg-1">{finding.laneLabel}</div>
            <div className="text-[11.5px] text-fg-4">Workstream · {finding.personaLabel}</div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex h-[30px] w-[30px] items-center justify-center rounded-lg text-fg-4 hover:bg-surface-1"
          >
            <X size={17} aria-hidden />
          </button>
        </div>

        <div className="flex flex-col gap-4 p-5">
          <div className="grid grid-cols-3 gap-2.5">
            <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <div className="text-[10px] text-fg-5">Status</div>
              <Badge tone={chip.tone} className="mt-1.5 px-2 py-0.5 text-[9.5px]">
                {chip.label}
              </Badge>
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <div className="text-[10px] text-fg-5">Severity</div>
              {status === 'flag' || status === 'caution' ? (
                <Badge
                  tone={SEVERITY_TONE[severity].tone}
                  className="mt-1.5 px-2 py-0.5 text-[9.5px]"
                >
                  {severity}
                </Badge>
              ) : (
                <div className="mt-1 text-[12px] text-fg-4">—</div>
              )}
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <div className="text-[10px] text-fg-5">Confidence</div>
              <div
                className="mt-1 text-[16px] font-semibold [font-feature-settings:'tnum']"
                style={{ color: finding.score != null ? scoreColor(finding.score) : 'var(--fg-4)' }}
              >
                {finding.score != null ? `${finding.score}%` : '—'}
              </div>
            </div>
          </div>

          <div>
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Finding
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-2">
              {finding.summary}
            </div>
          </div>

          {finding.detail ? (
            <div>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Detail
              </div>
              <p className="whitespace-pre-wrap text-[12px] leading-relaxed text-fg-2">
                {finding.detail}
              </p>
            </div>
          ) : null}

          {finding.citations.length > 0 ? (
            <div>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Evidence · {finding.citations.length}
              </div>
              <ul className="flex flex-col gap-1">
                {finding.citations.map((c, i) => (
                  <li
                    key={i}
                    className="rounded-md border border-hairline bg-surface-1 px-2.5 py-1.5 text-[11.5px] text-fg-3"
                  >
                    {typeof c === 'string' ? c : JSON.stringify(c)}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}

          {status === 'flag' || status === 'caution' ? (
            <div className="rounded-[13px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3.5">
              <div className="mb-2 flex items-center gap-2">
                <EarnCoin size={24} />
                <span className="text-[12.5px] font-semibold text-gold-1">
                  Earn&apos;s resolution
                </span>
              </div>
              <div className="mb-3 text-[12px] leading-relaxed text-fg-2">
                Resolve the open item — I&apos;ll prepare it with {finding.personaLabel} and bring
                it back for your sign-off.
              </div>
              <Button
                variant="gold"
                size="sm"
                icon={Sparkles}
                className="w-full"
                onClick={() => onResolve(finding)}
              >
                Resolve with Earn
              </Button>
            </div>
          ) : (
            <div className="flex flex-col gap-2 rounded-[13px] border border-[var(--success-line)] bg-[var(--success-soft)] px-4 py-3.5">
              <div className="flex items-center gap-2.5 text-[13px] font-semibold text-success">
                <CheckCircle2 size={17} aria-hidden />
                {finding.resolvedAt
                  ? 'Cleared · logged to Chain of Trust'
                  : 'Clear · no action needed'}
              </div>
              {finding.resolution ? (
                <p className="text-[11.5px] leading-relaxed text-fg-3">{finding.resolution}</p>
              ) : null}
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── the diligence center ────────────────────────────────────────────────── */

export function DiligenceRunView({
  run,
  runs
}: {
  run: DiligenceRunDetail;
  runs: DiligenceRunSummary[];
}) {
  const router = useRouter();
  const [openAgent, setOpenAgent] = useState<string | null>(null);
  const [resolving, setResolving] = useState<DiligenceAnalystFinding | null>(null);

  const { synthesis, analysts } = run;
  const workstreams = analysts.map(wsOf);
  const total = analysts.length;
  const cleared = workstreams.filter((w) => w.status === 'clear').length;
  const openItems = analysts.filter((f) => {
    const s = wsOf(f).status;
    return s === 'flag' || s === 'caution';
  });
  const verdict = runVerdict(workstreams);
  const icReady = openItems.length === 0 && total > 0;
  const scored = analysts.filter((f) => f.score != null);
  const avgConf =
    scored.length > 0
      ? Math.round(scored.reduce((s, f) => s + (f.score ?? 0), 0) / scored.length)
      : 0;
  const totalCitations = analysts.reduce((s, f) => s + f.citations.length, 0);
  const vt = VERDICT_TONE_VARS[verdict.tone] ?? VERDICT_TONE_VARS.success;
  const openFinding = openAgent ? (analysts.find((f) => f.agent === openAgent) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* the prototype's Diligence panel — switcher, verdict, register in one frame */}
      <Card className="p-[18px]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
              <FileSearch size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <div>
              <div className="mb-px text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                {run.dealName ?? 'Committee review'} · {formatDate(run.createdAt)}
              </div>
              <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                Diligence
              </h2>
            </div>
          </div>
          <div className="flex flex-none items-center gap-2">
            <Badge tone={statusTone(run.status)} className="text-[10px]">
              {statusLabel(run.status)}
            </Badge>
            <Button
              variant="ghost"
              size="sm"
              icon={Sparkles}
              onClick={() =>
                document.getElementById('new-review')?.scrollIntoView({ behavior: 'smooth' })
              }
            >
              New review
            </Button>
          </div>
        </div>

        {/* deal/run switcher — every run keeps its deep link */}
        {runs.length > 1 ? (
          <div className="mb-4 flex flex-wrap gap-2">
            {runs.map((r) => {
              const on = r.id === run.id;
              return (
                <Link
                  key={r.id}
                  href={`/run/diligence/${r.id}`}
                  className={cn(
                    'flex items-center gap-2.5 rounded-[11px] border px-3 py-2 text-left transition',
                    on
                      ? 'border-[var(--accent-line)] bg-[var(--accent-soft)]'
                      : 'border-hairline bg-surface-1 hover:bg-surface-2'
                  )}
                >
                  <span
                    className={cn(
                      'flex h-7 w-7 flex-none items-center justify-center rounded-lg',
                      on
                        ? 'bg-[var(--accent)] text-white'
                        : 'border border-hairline bg-surface-2 text-fg-3'
                    )}
                  >
                    <Building2 size={15} aria-hidden />
                  </span>
                  <span>
                    <span
                      className={cn(
                        'block text-[12.5px] font-semibold',
                        on ? 'text-fg-1' : 'text-fg-2'
                      )}
                    >
                      {r.dealName ?? r.summary ?? 'Review'}
                    </span>
                    <span className="block text-[10px] text-fg-5">
                      {formatDate(r.createdAt)}
                      {r.conviction != null ? ` · conviction ${r.conviction}` : ''}
                    </span>
                  </span>
                </Link>
              );
            })}
          </div>
        ) : null}

        {/* verdict + readiness */}
        <div className="mb-4 flex flex-wrap gap-3">
          <div
            className="min-w-[280px] flex-[2] rounded-xl border border-hairline bg-surface-1 px-4 py-3.5"
            style={{ borderLeft: `3px solid ${vt.c}` }}
          >
            <div className="mb-2 flex flex-wrap items-center gap-2.5">
              <span
                className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-[12.5px] font-bold"
                style={{ color: vt.c, background: vt.bg, border: `1px solid ${vt.b}` }}
              >
                {icReady ? (
                  <CircleCheckBig size={14} aria-hidden />
                ) : (
                  <Gauge size={14} aria-hidden />
                )}
                {verdict.label}
              </span>
              <span className="text-[11.5px] text-fg-4">{verdict.note}</span>
            </div>
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <span className="text-[11.5px] text-fg-3">
                <b className="text-fg-1">
                  {cleared}/{total}
                </b>{' '}
                workstreams clear
                {totalCitations > 0 ? ` · ${totalCitations} citations reviewed` : ''}
              </span>
              <span className="text-[11px] text-fg-4">
                avg confidence <b className="text-gold-1">{avgConf}%</b>
              </span>
            </div>
          </div>
          <div className="flex flex-col justify-center gap-2">
            {icReady ? (
              <Link href="/source/pipeline">
                <Button variant="gold" size="sm" icon={CircleCheckBig} className="w-full">
                  Send to IC
                </Button>
              </Link>
            ) : (
              <Button variant="secondary" size="sm" icon={ListChecks} disabled>
                {openItems.length} open
              </Button>
            )}
          </div>
        </div>

        {/* risk register */}
        <div>
          <div className="mb-2.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            <AlertTriangle size={12} className="text-warning" aria-hidden />
            Risk register · {openItems.length} open
          </div>
          {analysts.length === 0 ? (
            <p className="rounded-xl border border-hairline bg-surface-1 px-4 py-6 text-center text-[12.5px] text-fg-4">
              No findings on this run yet — the committee may still be working.
            </p>
          ) : (
            <div className="flex flex-col gap-1.5">
              {analysts.map((f) => {
                const { status, severity } = wsOf(f);
                const chip = WORKSTREAM_STATUS[status];
                const StatusIcon = STATUS_ICON[status];
                return (
                  <button
                    key={f.agent}
                    type="button"
                    onClick={() => setOpenAgent(f.agent)}
                    className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-left transition hover:bg-surface-2"
                  >
                    <span
                      className={cn(
                        'flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border',
                        status === 'clear'
                          ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                          : 'border-hairline bg-surface-2 text-fg-3'
                      )}
                    >
                      <StatusIcon size={15} aria-hidden />
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex items-center gap-2">
                        <span className="truncate text-[13px] font-semibold text-fg-1">
                          {f.laneLabel}
                        </span>
                        <Badge tone={chip.tone} className="flex-none px-2 py-0.5 text-[9px]">
                          {chip.label}
                        </Badge>
                        {status === 'flag' ? (
                          <Badge
                            tone={SEVERITY_TONE[severity].tone}
                            className="flex-none px-2 py-0.5 text-[9px]"
                          >
                            {severity}
                          </Badge>
                        ) : null}
                      </span>
                      <span className="mt-0.5 block truncate text-[10.5px] text-fg-5">
                        {f.personaLabel}
                        {f.citations.length > 0 ? ` · ${f.citations.length} citations` : ''} ·{' '}
                        {f.summary}
                      </span>
                    </span>
                    <span className="flex w-[120px] flex-none items-center gap-2">
                      <span className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                        <span
                          className="block h-full rounded-full"
                          style={{
                            width: `${f.score ?? 0}%`,
                            background: f.score != null ? scoreColor(f.score) : 'var(--fg-4)'
                          }}
                        />
                      </span>
                      <span className="text-[10px] tabular-nums text-fg-5">
                        {f.score != null ? `${f.score}%` : '—'}
                      </span>
                    </span>
                  </button>
                );
              })}
            </div>
          )}
        </div>

        {/* Earn's verdict strip */}
        {total > 0 ? (
          <div className="mt-4 flex items-center gap-3 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3">
            <EarnCoin size={24} className="flex-none" />
            <p className="flex-1 text-[12px] leading-relaxed text-fg-2">
              <b className="text-gold-1">Earn:</b>{' '}
              {openItems.length > 0
                ? `${verdict.label} — ${openItems.length} of ${total} workstreams need your call. Open the risk register and I'll resolve each with you.`
                : `All ${total} workstreams clear at ${avgConf}% avg confidence. This deal is IC-ready.`}
            </p>
          </div>
        ) : null}
      </Card>

      {/* Synthesis — Earn's IC memo, the real depth beyond the prototype */}
      {synthesis ? (
        <Card className="bg-[linear-gradient(100deg,rgba(247,201,72,0.08),transparent_58%)] p-5">
          <div className="flex items-start justify-between gap-4">
            <div>
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Synthesis · {synthesis.personaLabel}
              </div>
              <div className="mt-1 text-[15px] font-semibold text-fg-1">
                {synthesis.recommendation || 'Recommendation pending'}
              </div>
            </div>
            {synthesis.conviction != null ? (
              <div className="flex-none text-right">
                <div className="text-[28px] font-semibold tabular-nums tracking-[-0.02em] text-fg-1">
                  {synthesis.conviction}
                </div>
                <div className="text-[10px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                  Conviction
                </div>
              </div>
            ) : null}
          </div>
          {synthesis.memo ? (
            <p className="mt-4 whitespace-pre-wrap text-[12.5px] leading-relaxed text-fg-2">
              {synthesis.memo}
            </p>
          ) : null}
          {synthesis.followUpQuestions.length > 0 ? (
            <div className="mt-4 border-t border-hairline pt-4">
              <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Follow-up questions
              </div>
              <ul className="mt-2 flex flex-col gap-1.5">
                {synthesis.followUpQuestions.map((q, i) => (
                  <li key={i} className="flex gap-2 text-[12.5px] text-fg-2">
                    <span className="font-mono text-[11px] tabular-nums text-fg-4">{i + 1}.</span>
                    <span>{q}</span>
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
        </Card>
      ) : run.status === 'error' ? (
        <Card className="p-5">
          <div className="text-[13px] font-semibold text-danger">Diligence run failed</div>
          <p className="mt-1.5 text-[12.5px] text-fg-3">
            {run.summary || 'The run did not complete. Try running diligence again.'}
          </p>
        </Card>
      ) : null}

      {openFinding && (
        <WorkstreamDrawer
          finding={openFinding}
          onClose={() => setOpenAgent(null)}
          onResolve={(f) => {
            setOpenAgent(null);
            setResolving(f);
          }}
        />
      )}

      {resolving && (
        <ActionRunner
          title={`Resolve — ${resolving.laneLabel}`}
          steps={[
            `Pull ${resolving.personaLabel}'s findings`,
            'Confirm the open item',
            'Update the diligence record',
            'Log evidence to Chain of Trust'
          ]}
          draftTitle={`${resolving.laneLabel} — resolution`}
          draft={`${resolving.personaLabel} prepared the resolution for "${resolving.summary}". Approve to clear this workstream and log it to the Chain of Trust.`}
          onApprove={async () => {
            const res = await resolveDiligenceFinding({ runId: run.id, agent: resolving.agent });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setResolving(null)}
          onApplied={() => router.refresh()}
        />
      )}
    </div>
  );
}
