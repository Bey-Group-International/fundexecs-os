'use client';

import { useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { CheckCircle2, ShieldCheck, Sparkles } from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { resolveComplianceItem, seedCompliance } from '@/lib/run-ops/actions';
import { COMPLIANCE_BASELINE } from '@/lib/run-ops/vocabulary';
import type { ComplianceItemView } from '@/lib/queries/run-ops';

const SEVERITY_TONE: Record<string, BadgeTone> = { high: 'danger', medium: 'warning', low: 'info' };
const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };

type RunnerState = { type: 'seed' } | { type: 'resolve'; item: ComplianceItemView };

export function ComplianceFlow({ items }: { items: ComplianceItemView[] }) {
  const router = useRouter();
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const open = items.filter((i) => i.status === 'open');
  const baselineNote = (category: string) =>
    COMPLIANCE_BASELINE.find((b) => b.category === category)?.note ?? null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <ShieldCheck size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">Compliance</h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Adrian&apos;s posture board — counsel in the loop on every resolution. Illustrative
              until counsel signs off.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">{open.length}</div>
            <div className="text-[10.5px] text-fg-5">open items</div>
          </div>
        </div>
      </Card>

      {items.length === 0 ? (
        <Card className="p-8 text-center">
          <ShieldCheck size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">No compliance baseline yet</h2>
          <p className="mx-auto mb-4 mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            Adrian sets the posture every emerging manager owes — Reg D, accreditation records,
            solicitation, books &amp; records, privacy — severity-ranked and worked to resolution.
          </p>
          <Button variant="gold" icon={Sparkles} onClick={() => setRunner({ type: 'seed' })}>
            Set the baseline with Adrian
          </Button>
        </Card>
      ) : (
        <Card className="p-[18px]">
          <div className="flex flex-col gap-1.5">
            {items
              .slice()
              .sort(
                (a, b) =>
                  (a.status === 'open' ? 0 : 1) - (b.status === 'open' ? 0 : 1) ||
                  (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
              )
              .map((i) => (
                <div
                  key={i.id}
                  className="flex items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3"
                >
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[13px] font-semibold text-fg-1">{i.category}</div>
                    {baselineNote(i.category) && (
                      <div className="mt-0.5 truncate text-[10.5px] text-fg-5">
                        {baselineNote(i.category)}
                      </div>
                    )}
                  </div>
                  <Badge
                    tone={SEVERITY_TONE[i.severity] ?? 'neutral'}
                    className="px-2 py-0.5 text-[9.5px]"
                  >
                    {i.severity}
                  </Badge>
                  {i.status === 'open' ? (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Sparkles}
                      onClick={() => setRunner({ type: 'resolve', item: i })}
                    >
                      Resolve
                    </Button>
                  ) : (
                    <span className="inline-flex items-center gap-1 text-[10px] font-semibold uppercase tracking-[0.06em] text-success">
                      <CheckCircle2 size={12} aria-hidden />
                      Resolved
                    </span>
                  )}
                </div>
              ))}
          </div>
        </Card>
      )}

      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> Compliance is posture, not paperwork. Adrian drafts
          every resolution to the standard and flags what needs counsel — nothing is marked resolved
          without you.
        </p>
      </Card>

      {runner?.type === 'seed' && (
        <ActionRunner
          title="Set the compliance baseline"
          steps={[
            'Read your exemption posture from formation',
            'Assemble the baseline items',
            'Rank by severity',
            'Prepare for your approval'
          ]}
          draftTitle="Adrian's compliance baseline"
          draft={`${COMPLIANCE_BASELINE.length} items, severity-ranked: ${COMPLIANCE_BASELINE.map((i) => i.category).join(', ')}. Approving stands the board up — each item is then worked to resolution with counsel in the loop.`}
          approveLabel="Approve & set"
          onApprove={async () => {
            const res = await seedCompliance();
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast('Compliance baseline set');
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'resolve' && (
        <ActionRunner
          title={`Resolve — ${runner.item.category}`}
          steps={[
            'Pull the item’s requirements',
            'Assemble the resolution evidence',
            'Stage the counsel review note',
            'Prepare for your approval'
          ]}
          draftTitle={`Resolution · ${runner.item.category}`}
          draft={`${baselineNote(runner.item.category) ?? 'The item’s requirement, evidenced and noted for counsel.'} Approving marks ${runner.item.category} resolved on your posture board.`}
          approveLabel="Approve & resolve"
          onApprove={async () => {
            const res = await resolveComplianceItem(runner.item.id);
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`${runner.item.category} — resolved`);
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
