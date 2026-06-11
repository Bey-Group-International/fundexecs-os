'use client';

import { useEffect, useState } from 'react';
import { ArrowRight, Briefcase, Check, CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';
import Link from 'next/link';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { requestPartnerIntro } from '@/lib/actions/partners';
import type { ServiceProvider } from '@/lib/queries/partners';
import { cn } from '@/lib/utils';

/* ── bench vocabulary over the real provider data ────────────────────────── */

type BenchStage = 'suggested' | 'requested' | 'engaged';

const STAGE_META: Record<BenchStage, { label: string; tone: BadgeTone }> = {
  suggested: { label: 'Suggested', tone: 'neutral' },
  requested: { label: 'Intro requested', tone: 'azure' },
  engaged: { label: 'Engaged', tone: 'success' }
};

/** Derive a provider's bench stage from its real status + intro requests. */
function benchStage(p: ServiceProvider, introStatus: Record<string, string>): BenchStage {
  const s = (p.status || '').toLowerCase();
  if (/(active|engaged|retained)/.test(s)) return 'engaged';
  if (introStatus[p.id]) return 'requested';
  return 'suggested';
}

/**
 * The essential bench roles an emerging manager needs, matched against the
 * free-form provider categories by keyword — coverage is derived from real
 * rows, never assumed.
 */
const ESSENTIALS: { label: string; match: RegExp }[] = [
  { label: 'Fund counsel', match: /legal|counsel|law/i },
  { label: 'Fund administration', match: /admin/i },
  { label: 'Audit & tax', match: /audit|tax|account/i },
  { label: 'Placement', match: /placement|broker/i }
];

const STAGE_ORDER: BenchStage[] = ['engaged', 'requested', 'suggested'];

export interface PartnerNetworkFlowProps {
  providers: ServiceProvider[];
  /** partner id → intro request status, from `getPartnersData`. */
  introStatus: Record<string, string>;
}

export function PartnerNetworkFlow({
  providers,
  introStatus: initialIntroStatus
}: PartnerNetworkFlowProps) {
  const [introStatus, setIntroStatus] = useState(initialIntroStatus);
  const [running, setRunning] = useState<ServiceProvider | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const staged = providers.map((p) => ({ p, stage: benchStage(p, introStatus) }));
  const engagedCount = staged.filter((x) => x.stage === 'engaged').length;
  const essentials = ESSENTIALS.map((e) => {
    const hit = staged.find(
      (x) => e.match.test(x.p.category ?? '') && (x.stage === 'engaged' || x.stage === 'requested')
    );
    return { ...e, covered: !!hit, engaged: hit?.stage === 'engaged' };
  });

  return (
    <div className="flex flex-col gap-4">
      {/* hero */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Briefcase size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
              Partner network
            </h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Your vetted bench — counsel, admin, audit and placement. Earn requests every intro;
              you approve.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">
              {engagedCount}/{providers.length}
            </div>
            <div className="text-[10.5px] text-fg-5">engaged</div>
          </div>
        </div>

        {/* essentials coverage */}
        <div className="mt-4 grid grid-cols-2 gap-2.5 sm:grid-cols-4">
          {essentials.map((e) => (
            <div
              key={e.label}
              className={cn(
                'flex items-center gap-2 rounded-xl border px-3 py-2.5',
                e.covered
                  ? 'border-[var(--success-line)] bg-[var(--success-soft)]'
                  : 'border-hairline bg-surface-1'
              )}
            >
              <span
                className={cn(
                  'flex h-6 w-6 flex-none items-center justify-center rounded-full border',
                  e.covered
                    ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                    : 'border-[var(--border-strong)] text-fg-5'
                )}
              >
                {e.covered ? (
                  <Check size={12} strokeWidth={2.4} aria-hidden />
                ) : (
                  <span className="h-1.5 w-1.5 rounded-full bg-fg-5" aria-hidden />
                )}
              </span>
              <div className="min-w-0">
                <div className="truncate text-[11.5px] font-semibold text-fg-1">{e.label}</div>
                <div className="text-[9.5px] text-fg-5">
                  {e.engaged ? 'Engaged' : e.covered ? 'In motion' : 'Not covered yet'}
                </div>
              </div>
            </div>
          ))}
        </div>
      </Card>

      {/* the bench */}
      {providers.length === 0 ? (
        <Card className="p-8 text-center">
          <Briefcase size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">
            No providers on the bench yet
          </h2>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            The team maps counsel, fund admin, audit and placement against your mandate — providers
            land here vetted, and every introduction routes through your approval.
          </p>
        </Card>
      ) : (
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {staged
            .slice()
            .sort(
              (a, b) =>
                STAGE_ORDER.indexOf(a.stage) - STAGE_ORDER.indexOf(b.stage) ||
                a.p.name.localeCompare(b.p.name)
            )
            .map(({ p, stage }) => {
              const meta = STAGE_META[stage];
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-3 rounded-xl border border-hairline bg-surface-1 px-3.5 py-3"
                >
                  <Avatar name={p.name} size={34} tone={stage === 'engaged' ? 'gold' : 'azure'} />
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-fg-1">{p.name}</div>
                    <div className="truncate text-[10.5px] capitalize text-fg-5">
                      {p.category ?? 'Provider'}
                    </div>
                  </div>
                  <Badge tone={meta.tone} className="px-2 py-0.5 text-[9.5px]">
                    {meta.label}
                  </Badge>
                  {stage === 'suggested' && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Sparkles}
                      onClick={() => setRunning(p)}
                    >
                      Request intro
                    </Button>
                  )}
                  {stage === 'engaged' && (
                    <CheckCircle2 size={16} className="flex-none text-success" aria-hidden />
                  )}
                </div>
              );
            })}
        </div>
      )}

      {/* capital partners live on the Capital Map */}
      <Link
        href="/source/capital-map"
        className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface-1 px-4 py-3.5 transition hover:bg-surface-2"
      >
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
          <Briefcase size={15} aria-hidden />
        </span>
        <span className="min-w-0 flex-1 text-[12.5px] text-fg-2">
          <b className="text-fg-1">Capital partners</b> — LPs, lenders and co-investors are worked
          on your LP Capital Map.
        </span>
        <span className="inline-flex flex-none items-center gap-1 text-[11px] font-semibold text-azure-1">
          Open
          <ArrowRight size={12} strokeWidth={2} aria-hidden />
        </span>
      </Link>

      {/* Earn's standing note */}
      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> A thin bench slows every close. Ask for an intro and
          I&apos;ll draft it with your mandate attached — the request is tracked until they&apos;re
          engaged.
        </p>
      </Card>

      {running && (
        <ActionRunner
          title={`Request the intro — ${running.name}`}
          steps={[
            'Pull their practice profile',
            'Draft the introduction with your mandate attached',
            'Set the follow-up reminder',
            'Prepare for your approval'
          ]}
          draftTitle={`Introduction request · ${running.name}`}
          draft={`An introduction request to ${running.name} (${running.category ?? 'provider'}) with your mandate and stage attached, so the first call starts from context. Approving submits the tracked request — it shows as "Intro requested" until they engage.`}
          approveLabel="Approve & request"
          onApprove={async () => {
            const res = await requestPartnerIntro({
              partnerId: running.id,
              partnerName: running.name,
              partnerType: 'service_provider',
              rationale: 'Requested from the Source hub partner network.'
            });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunning(null)}
          onApplied={() => {
            setIntroStatus((p) => ({ ...p, [running.id]: 'requested' }));
            setToast(`Intro requested — ${running.name}`);
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
