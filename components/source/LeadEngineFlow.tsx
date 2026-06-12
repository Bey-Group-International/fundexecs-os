'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import { Building2, CalendarCheck, Megaphone, ShieldCheck, Sparkles, X } from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { advanceLead, spinUpLeadEngine } from '@/lib/leads/actions';
import {
  LEAD_NEXT,
  LEAD_STAGES,
  lastActivityLabel,
  leadRunSteps,
  nextLeadStage,
  summarizeLeads,
  type LeadStageKey
} from '@/lib/leads/engine';
import { compactMoney } from '@/lib/format';
import type { LeadEngineView, LeadView } from '@/lib/queries/leads';
import { cn } from '@/lib/utils';

/* ── stage vocabulary — the prototype's LEAD_TONE over the live stage keys ── */

const STAGE_TONE: Record<LeadStageKey, BadgeTone> = {
  new: 'neutral',
  qualified: 'azure',
  contacted: 'gold',
  meeting: 'success'
};

const STAGE_BAR: Record<LeadStageKey, string> = {
  new: 'var(--fg-4)',
  qualified: 'var(--azure-1)',
  contacted: 'var(--gold-1)',
  meeting: 'var(--success)'
};

function fitColor(v: number | null): string {
  if (v == null) return 'var(--fg-3)';
  return v >= 85 ? 'var(--success)' : v >= 75 ? 'var(--gold-1)' : 'var(--fg-3)';
}

function stageLabel(key: LeadStageKey): string {
  return LEAD_STAGES.find((s) => s.key === key)?.label ?? key;
}

/* ── modal focus management (drawer) ─────────────────────────────────────── */

const FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

/**
 * Trap focus inside a modal panel: focus the first focusable on mount, cycle
 * Tab/Shift+Tab, close on Escape, lock body scroll, and restore focus to the
 * opener on unmount.
 */
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

/* ── the lead detail drawer ──────────────────────────────────────────────── */

function LeadDrawer({
  lead,
  portco,
  onClose,
  onRun
}: {
  lead: LeadView;
  portco: string;
  onClose: () => void;
  onRun: (lead: LeadView) => void;
}) {
  const panelRef = useModalFocus(onClose);
  const act = lead.stage !== 'meeting' ? LEAD_NEXT[lead.stage] : null;
  const signalLine = lead.signal ? `${lead.signal}. ` : '';
  const intentRead =
    lead.intent != null
      ? `${signalLine}Scored ${lead.intent} on buying intent and fit to ${portco}'s ICP.`
      : `${signalLine}Awaiting an intent score from Vivian.`;

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
        aria-label={lead.name}
        className="fixed bottom-0 right-0 top-0 z-[61] w-[420px] max-w-[94vw] overflow-y-auto border-l border-[var(--border-strong)] bg-bg-2 shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
          <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border border-hairline bg-surface-2 text-fg-2">
            <Building2 size={20} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15.5px] font-semibold text-fg-1">{lead.name}</div>
            <div className="text-[11.5px] text-fg-4">{lead.segment ?? 'Lead'}</div>
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
              <div className="text-[10px] text-fg-5">Intent</div>
              <div
                className="mt-1 text-[18px] font-semibold [font-feature-settings:'tnum']"
                style={{ color: fitColor(lead.intent) }}
              >
                {lead.intent ?? '—'}
              </div>
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <div className="text-[10px] text-fg-5">Value</div>
              <div className="mt-1 text-[15px] font-semibold text-gold-1 [font-feature-settings:'tnum']">
                {lead.estValue ? compactMoney(lead.estValue) : '—'}
              </div>
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <div className="text-[10px] text-fg-5">Stage</div>
              <Badge tone={STAGE_TONE[lead.stage]} className="mt-1.5 px-2 py-0.5 text-[9.5px]">
                {stageLabel(lead.stage)}
              </Badge>
            </div>
          </div>

          {/* the prototype's "Intent signal" card, from the real score */}
          <div>
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Intent signal
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-2">
              {intentRead}
            </div>
          </div>

          <div className="text-[11.5px] text-fg-4">
            <b className="text-fg-2">Last activity</b>
            <br />
            {lastActivityLabel(lead.lastActivity)}
          </div>

          {act ? (
            <div className="rounded-[13px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3.5">
              <div className="mb-2 flex items-center gap-2">
                <EarnCoin size={24} />
                <span className="text-[12.5px] font-semibold text-gold-1">
                  Earn&apos;s next move
                </span>
              </div>
              <div className="mb-3 text-[12px] leading-relaxed text-fg-2">
                {act} — I&apos;ll personalize the outreach to their segment and signal, then queue
                it for approval.
              </div>
              <Button
                variant="gold"
                size="sm"
                icon={Sparkles}
                className="w-full"
                onClick={() => onRun(lead)}
              >
                {act} with Earn
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-[13px] border border-[var(--success-line)] bg-[var(--success-soft)] px-4 py-3.5 text-[13px] font-semibold text-success">
              <CalendarCheck size={17} aria-hidden />
              Meeting booked · sales-ready
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── the lead engine panel ───────────────────────────────────────────────── */

type RunnerState =
  | { type: 'spinup'; engine: LeadEngineView }
  | { type: 'advance'; engine: LeadEngineView; lead: LeadView; act: string; to: LeadStageKey };

export function LeadEngineFlow({ engines }: { engines: LeadEngineView[] }) {
  const router = useRouter();
  const [selectedId, setSelectedId] = useState<string | null>(engines[0]?.dealId ?? null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const engine = engines.find((e) => e.dealId === selectedId) ?? engines[0] ?? null;
  const summary = summarizeLeads(engine?.leads ?? []);
  const stageKeys = LEAD_STAGES.map((s) => s.key);
  const openLead = openId ? (engine?.leads.find((l) => l.id === openId) ?? null) : null;

  function runLead(lead: LeadView) {
    if (!engine || lead.stage === 'meeting') return;
    const to = nextLeadStage(lead.stage);
    if (!to) return;
    setOpenId(null);
    setRunner({ type: 'advance', engine, lead, act: LEAD_NEXT[lead.stage], to });
  }

  return (
    <div className="flex flex-col gap-4">
      {/* the prototype's LeadEngine panel — banner, tiles, funnel and cards */}
      <Card className="p-[18px]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
              <Megaphone size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <div>
              <div className="mb-px text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Demand generation by Vivian &amp; Camille · tap a lead to open
              </div>
              <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                Lead Engine
              </h2>
            </div>
          </div>
          {engine && (
            <Button
              variant="ghost"
              size="sm"
              icon={Sparkles}
              onClick={() => setRunner({ type: 'spinup', engine })}
            >
              Generate leads
            </Button>
          )}
        </div>

        {/* one engine per closed acquisition — switch when there are several */}
        {engines.length > 1 && (
          <div className="mb-3 flex flex-wrap gap-1.5">
            {engines.map((e) => (
              <button
                key={e.dealId}
                type="button"
                onClick={() => {
                  setSelectedId(e.dealId);
                  setOpenId(null);
                }}
                className={cn(
                  'rounded-full border px-3 py-1 text-[11px] font-medium transition',
                  e.dealId === engine?.dealId
                    ? 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1'
                    : 'border-hairline bg-surface-1 text-fg-3 hover:bg-surface-2'
                )}
              >
                {e.portco}
              </button>
            ))}
          </div>
        )}

        {/* WHOSE customers — the portfolio-company banner */}
        <div className="mb-3.5 flex items-center gap-2.5 rounded-[11px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3.5 py-2.5">
          <Building2 size={15} className="flex-none text-gold-1" aria-hidden />
          {engine ? (
            <span className="text-[12px] text-fg-2">
              Sourcing customers for <b className="text-fg-1">{engine.portco}</b>
              {engine === engines[0] ? ' — your newest portfolio company' : ''}. Earn spins up a
              Lead Engine for every acquisition you close.
            </span>
          ) : (
            <span className="text-[12px] text-fg-2">
              Earn spins up a Lead Engine for every acquisition you close — sourcing customers for
              that portfolio company, scored by intent.
            </span>
          )}
        </div>

        {engine ? (
          <>
            {/* funnel summary */}
            <div className="mb-3.5 grid grid-cols-3 gap-2.5">
              <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3">
                <div className="text-[11px] text-fg-4">Live leads</div>
                <div className="mt-1.5 text-[21px] font-semibold text-azure-1 [font-feature-settings:'tnum']">
                  {summary.live}
                </div>
                <div className="mt-0.5 text-[10.5px] text-fg-5">intent-scored</div>
              </div>
              <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3">
                <div className="text-[11px] text-fg-4">Pipeline value</div>
                <div className="mt-1.5 text-[21px] font-semibold text-gold-1 [font-feature-settings:'tnum']">
                  {compactMoney(summary.pipelineValue)}
                </div>
                <div className="mt-0.5 text-[10.5px] text-fg-5">est. pipeline value</div>
              </div>
              <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3">
                <div className="text-[11px] text-fg-4">Meetings booked</div>
                <div className="mt-1.5 text-[21px] font-semibold text-success [font-feature-settings:'tnum']">
                  {summary.meetings}
                </div>
                <div className="mt-0.5 text-[10.5px] text-fg-5">sales-ready</div>
              </div>
            </div>

            {/* stage funnel */}
            <div className="mb-4 grid grid-cols-4 gap-2">
              {LEAD_STAGES.map((s) => (
                <div
                  key={s.key}
                  className="rounded-xl border border-hairline bg-surface-1 px-2.5 py-2"
                  style={{ borderTopWidth: 2, borderTopColor: STAGE_BAR[s.key] }}
                >
                  <div className="truncate text-[10px] text-fg-4">{s.label}</div>
                  <div className="mt-0.5 text-[16px] font-semibold [font-feature-settings:'tnum']">
                    {engine.leads.filter((l) => l.stage === s.key).length}
                  </div>
                </div>
              ))}
            </div>

            {/* lead cards */}
            {engine.leads.length === 0 ? (
              <div className="px-4 py-8 text-center">
                <Megaphone size={22} className="mx-auto text-fg-4" aria-hidden />
                <h3 className="mt-3 text-[15px] font-semibold text-fg-1">No leads yet</h3>
                <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
                  Vivian profiles {engine.portco}&apos;s market and proposes the first scored batch
                  — segment, buying signal, intent and estimated value on each — for your approval.
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  icon={Sparkles}
                  className="mt-4"
                  onClick={() => setRunner({ type: 'spinup', engine })}
                >
                  Generate the first batch
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-3">
                {engine.leads
                  .slice()
                  .sort(
                    (a, b) =>
                      stageKeys.indexOf(b.stage) - stageKeys.indexOf(a.stage) ||
                      (b.intent ?? -1) - (a.intent ?? -1)
                  )
                  .map((l) => (
                    <button
                      key={l.id}
                      type="button"
                      onClick={() => setOpenId(l.id)}
                      className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-left transition hover:bg-surface-2"
                    >
                      <div className="flex items-center gap-2.5">
                        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
                          <Building2 size={16} aria-hidden />
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-semibold text-fg-1">
                            {l.name}
                          </div>
                          <div className="truncate text-[10.5px] text-fg-5">
                            {l.segment ?? 'Lead'}
                          </div>
                        </div>
                        <Badge tone={STAGE_TONE[l.stage]} className="px-2 py-0.5 text-[9.5px]">
                          {stageLabel(l.stage)}
                        </Badge>
                      </div>
                      <div className="mt-2.5 flex items-center gap-3.5 text-[11px] text-fg-4">
                        <span>
                          Intent <b style={{ color: fitColor(l.intent) }}>{l.intent ?? '—'}</b>
                        </span>
                        <span>
                          Value{' '}
                          <b className="font-mono text-fg-2 [font-feature-settings:'tnum']">
                            {l.estValue ? compactMoney(l.estValue) : '—'}
                          </b>
                        </span>
                      </div>
                    </button>
                  ))}
              </div>
            )}
          </>
        ) : (
          <div className="px-4 py-8 text-center">
            <Megaphone size={22} className="mx-auto text-fg-4" aria-hidden />
            <h3 className="mt-3 text-[15px] font-semibold text-fg-1">No closed acquisitions yet</h3>
            <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
              The Lead Engine spins up per closed acquisition. Drive a deal through its closing room
              in Execute — the moment it&apos;s closed and recorded, Vivian stands up its demand
              funnel here.
            </p>
          </div>
        )}
      </Card>

      {openLead && engine && (
        <LeadDrawer
          lead={openLead}
          portco={engine.portco}
          onClose={() => setOpenId(null)}
          onRun={runLead}
        />
      )}

      {runner?.type === 'spinup' && (
        <ActionRunner
          title={`Generate leads — ${runner.engine.portco}`}
          steps={[
            'Profile the portfolio company’s market',
            'Define the ideal customer profile',
            'Generate the scored lead batch',
            'Prepare for your approval'
          ]}
          draftTitle={`Lead batch · ${runner.engine.portco}`}
          draft={`Vivian profiles ${runner.engine.portco}'s market and generates the next scored batch of customer leads — segment, buying signal, intent and estimated value on each. Approving runs the real generator and lands the batch on this engine for you to work.`}
          approveLabel="Approve & generate"
          onApprove={async () => {
            const res = await spinUpLeadEngine(runner.engine.dealId);
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`Lead batch generated — ${runner.engine.portco}`);
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'advance' && (
        <ActionRunner
          title={`${runner.act} — ${runner.lead.name}`}
          steps={leadRunSteps(runner.act)}
          draftTitle={`${runner.act} — ${runner.lead.name}`}
          draft={`Earn prepared the ${runner.act.toLowerCase()} for ${runner.lead.name} (${
            runner.lead.segment ?? 'lead'
          }${
            runner.lead.intent != null ? `, intent ${runner.lead.intent}` : ''
          }) to drive revenue for your portfolio company. Approve to send and advance the lead to ${stageLabel(
            runner.to
          )}.`}
          onApprove={async () => {
            const res = await advanceLead({ leadId: runner.lead.id, to: runner.to });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`${runner.lead.name} advanced to ${stageLabel(runner.to)}`);
            router.refresh();
          }}
        />
      )}

      {toast && (
        <div className="fixed bottom-6 left-1/2 z-[70] flex -translate-x-1/2 items-center gap-2.5 rounded-[14px] border border-[var(--success-line)] bg-bg-2 px-4 py-3 shadow-[var(--shadow-lg)]">
          <ShieldCheck size={17} className="text-success" aria-hidden />
          <div>
            <div className="text-[13px] font-semibold text-fg-1">Earn completed an action</div>
            <div className="text-[11.5px] text-fg-4">{toast}</div>
          </div>
        </div>
      )}
    </div>
  );
}
