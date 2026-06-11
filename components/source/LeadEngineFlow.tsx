'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { Factory, Filter, ShieldCheck, Sparkles } from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { advanceLead, spinUpLeadEngine } from '@/lib/leads/actions';
import { LEAD_MOVE, LEAD_STAGES, nextLeadStage, type LeadStageKey } from '@/lib/leads/engine';
import { compactMoney } from '@/lib/format';
import type { LeadEngineView, LeadView } from '@/lib/queries/leads';

const STAGE_TONE: Record<LeadStageKey, BadgeTone> = {
  new: 'neutral',
  qualified: 'azure',
  contacted: 'gold',
  meeting: 'success'
};

function intentColor(v: number | null): string {
  if (v == null) return 'var(--fg-3)';
  return v >= 85 ? 'var(--success)' : v >= 75 ? 'var(--gold-1)' : 'var(--fg-3)';
}

type RunnerState =
  | { type: 'spinup'; engine: LeadEngineView }
  | {
      type: 'advance';
      engine: LeadEngineView;
      lead: LeadView;
      to: LeadStageKey;
      label: string;
      steps: string[];
    };

export function LeadEngineFlow({ engines }: { engines: LeadEngineView[] }) {
  const router = useRouter();
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const totalLeads = engines.reduce((s, e) => s + e.leads.length, 0);

  return (
    <div className="flex flex-col gap-4">
      {/* hero */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Filter size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">Lead engine</h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Post-acquisition demand — Vivian seeds the funnel for every closed company; each move
              runs on your approval.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">{totalLeads}</div>
            <div className="text-[10.5px] text-fg-5">leads in motion</div>
          </div>
        </div>
      </Card>

      {engines.length === 0 ? (
        <Card className="p-8 text-center">
          <Factory size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">No closed acquisitions yet</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            The lead engine spins up per closed acquisition. Drive a deal through its closing room
            in Execute — the moment it&apos;s closed and recorded, Vivian stands up its demand
            funnel here.
          </p>
        </Card>
      ) : (
        engines.map((engine) => {
          const byStage = (key: LeadStageKey) => engine.leads.filter((l) => l.stage === key);
          return (
            <Card key={engine.dealId} className="p-[18px]">
              <div className="mb-3 flex items-center justify-between gap-3">
                <div className="flex items-center gap-2.5">
                  <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
                    <Factory size={16} strokeWidth={1.9} aria-hidden />
                  </span>
                  <div>
                    <div className="text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                      Portfolio company
                    </div>
                    <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                      {engine.portco}
                    </div>
                  </div>
                </div>
                <Button
                  variant={engine.leads.length === 0 ? 'gold' : 'secondary'}
                  size="sm"
                  icon={Sparkles}
                  onClick={() => setRunner({ type: 'spinup', engine })}
                >
                  {engine.leads.length === 0 ? 'Spin up the engine' : 'Source more leads'}
                </Button>
              </div>

              {/* stage strip */}
              <div className="mb-3 grid grid-cols-4 gap-2">
                {LEAD_STAGES.map((s) => (
                  <div
                    key={s.key}
                    className="rounded-xl border border-hairline bg-surface-1 px-2.5 py-2"
                  >
                    <div className="truncate text-[10px] text-fg-4">{s.label}</div>
                    <div className="mt-0.5 text-[16px] font-semibold [font-feature-settings:'tnum']">
                      {byStage(s.key).length}
                    </div>
                  </div>
                ))}
              </div>

              {engine.leads.length === 0 ? (
                <p className="px-0.5 py-1.5 text-[12px] leading-relaxed text-fg-5">
                  No leads yet — spin up the engine and Vivian proposes the first batch, scored by
                  intent, for your approval.
                </p>
              ) : (
                <div className="flex flex-col gap-1.5">
                  {engine.leads.map((l) => {
                    const to = nextLeadStage(l.stage);
                    const move = l.stage !== 'meeting' ? LEAD_MOVE[l.stage] : null;
                    return (
                      <div
                        key={l.id}
                        className="flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3"
                      >
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[13px] font-semibold text-fg-1">
                            {l.name}
                          </div>
                          <div className="truncate text-[10.5px] text-fg-5">
                            {[l.segment, l.signal].filter(Boolean).join(' · ') || 'Lead'}
                          </div>
                        </div>
                        <span className="flex-none text-[11px] text-fg-4">
                          Intent <b style={{ color: intentColor(l.intent) }}>{l.intent ?? '—'}</b>
                        </span>
                        {l.estValue ? (
                          <span className="hidden flex-none text-[11px] text-fg-4 sm:inline">
                            ACV{' '}
                            <b className="font-mono text-fg-2 [font-feature-settings:'tnum']">
                              {compactMoney(l.estValue)}
                            </b>
                          </span>
                        ) : null}
                        <Badge tone={STAGE_TONE[l.stage]} className="px-2 py-0.5 text-[9.5px]">
                          {LEAD_STAGES.find((s) => s.key === l.stage)?.label}
                        </Badge>
                        {move && to ? (
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={Sparkles}
                            onClick={() =>
                              setRunner({
                                type: 'advance',
                                engine,
                                lead: l,
                                to,
                                label: move.label,
                                steps: move.steps
                              })
                            }
                          >
                            {move.label}
                          </Button>
                        ) : (
                          <span className="text-[10px] font-semibold uppercase tracking-[0.06em] text-success">
                            Meeting
                          </span>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </Card>
          );
        })
      )}

      {/* Earn's standing note */}
      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> A close is the start of the next funnel. Vivian keeps
          each portfolio company&apos;s engine warm — every qualification, outreach and meeting runs
          through your approval.
        </p>
      </Card>

      {runner?.type === 'spinup' && (
        <ActionRunner
          title={`Spin up the engine — ${runner.engine.portco}`}
          steps={[
            'Profile the portfolio company’s market',
            'Define the ideal customer profile',
            'Generate the scored lead batch',
            'Prepare for your approval'
          ]}
          draftTitle={`Lead batch · ${runner.engine.portco}`}
          draft={`Vivian profiles ${runner.engine.portco}'s market and generates the first scored batch of customer leads — segment, buying signal, intent and estimated value on each. Approving runs the real generator and lands the batch on this engine for you to work.`}
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
          title={`${runner.label} — ${runner.lead.name}`}
          steps={runner.steps}
          draftTitle={`${runner.label} · ${runner.lead.name}`}
          draft={`${runner.label} for ${runner.lead.name}${runner.lead.signal ? ` — built on the signal: ${runner.lead.signal.toLowerCase()}` : ''}. Approving advances the lead to ${
            LEAD_STAGES.find((s) => s.key === runner.to)?.label ?? runner.to
          } on ${runner.engine.portco}'s engine.`}
          onApprove={async () => {
            const res = await advanceLead({ leadId: runner.lead.id, to: runner.to });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(
              `${runner.lead.name} advanced to ${
                LEAD_STAGES.find((s) => s.key === runner.to)?.label ?? runner.to
              }`
            );
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
