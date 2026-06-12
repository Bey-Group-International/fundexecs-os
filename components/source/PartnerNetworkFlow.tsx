'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  ArrowRight,
  Banknote,
  Briefcase,
  Calculator,
  Check,
  CheckCircle2,
  FileCheck,
  Handshake,
  Landmark,
  Scale,
  ShieldCheck,
  Sparkles,
  Tag,
  X
} from 'lucide-react';
import Link from 'next/link';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { Field } from '@/components/ui/Field';
import { addServiceProvider, engagePartner, requestPartnerIntro } from '@/lib/actions/partners';
import {
  BENCH_NEXT,
  BENCH_STAGE_META,
  type BenchCategoryKey,
  type BenchRow,
  deriveBench,
  essentialCoverage,
  relativeActivity
} from '@/lib/partners/bench';
import type { ServiceProvider } from '@/lib/queries/partners';
import { cn } from '@/lib/utils';

/* ── the prototype's PROV_CAT_ICON, over the derived category keys ───────── */

const CAT_ICON: Record<BenchCategoryKey, typeof Briefcase> = {
  counsel: Scale,
  admin: Calculator,
  audit: FileCheck,
  placement: Handshake,
  capital: Banknote,
  prime: Landmark,
  other: Briefcase
};

function fitColor(f: number): string {
  return f >= 85 ? 'var(--success)' : f >= 75 ? 'var(--gold-1)' : 'var(--fg-3)';
}

/* ── modal focus management (drawer + dialog) ────────────────────────────── */

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

/* ── the partner detail drawer ───────────────────────────────────────────── */

function PartnerDrawer({
  row,
  lastActivity,
  onClose,
  onRun
}: {
  row: BenchRow;
  lastActivity: string;
  onClose: () => void;
  onRun: (row: BenchRow) => void;
}) {
  const panelRef = useModalFocus(onClose);
  const Icon = CAT_ICON[row.key];
  const meta = BENCH_STAGE_META[row.stage];
  const act = BENCH_NEXT[row.stage];

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
        aria-label={row.name}
        className="fixed bottom-0 right-0 top-0 z-[61] w-[420px] max-w-[94vw] overflow-y-auto border-l border-[var(--border-strong)] bg-bg-2 shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
          <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border border-hairline bg-surface-2 text-fg-2">
            <Icon size={20} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15.5px] font-semibold text-fg-1">{row.name}</div>
            <div className="text-[11.5px] capitalize text-fg-4">{row.category}</div>
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
              <div className="text-[10px] text-fg-5">Fit</div>
              <div
                className="mt-1 text-[18px] font-semibold [font-feature-settings:'tnum']"
                style={{ color: fitColor(row.fit) }}
              >
                {row.fit}
              </div>
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <div className="text-[10px] text-fg-5">Terms</div>
              <div className="mt-1.5 text-[11.5px] font-semibold text-fg-2">{row.terms ?? '—'}</div>
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
              <div className="text-[10px] text-fg-5">Status</div>
              <Badge tone={meta.tone} className="mt-1.5 px-2 py-0.5 text-[9.5px]">
                {meta.label}
              </Badge>
            </div>
          </div>

          <div>
            <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
              Why this partner
            </div>
            <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-[12.5px] leading-relaxed text-fg-2">
              {row.note}. Vetted by Adrian and scored{' '}
              <b style={{ color: fitColor(row.fit) }}>{row.fit}</b> on fit, terms and references for
              a fund your size.
            </div>
          </div>

          <div className="text-[11.5px] text-fg-4">
            <b className="text-fg-2">Last activity</b>
            <br />
            {lastActivity}
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
                {act} — I&apos;ll handle the outreach, confirm terms and references, then queue it
                for approval.
              </div>
              <Button
                variant="gold"
                size="sm"
                icon={Sparkles}
                className="w-full"
                onClick={() => onRun(row)}
              >
                {act} with Earn
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-[13px] border border-[var(--success-line)] bg-[var(--success-soft)] px-4 py-3.5 text-[13px] font-semibold text-success">
              <CheckCircle2 size={17} aria-hidden />
              Engaged · active relationship
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── "Find more partners" — a real provider, logged through the loop ─────── */

function AddPartnerDialog({
  onClose,
  onSubmit
}: {
  onClose: () => void;
  onSubmit: (name: string, category: string) => void;
}) {
  const panelRef = useModalFocus(onClose);
  const [name, setName] = useState('');
  const [category, setCategory] = useState('');

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
        aria-label="Find a partner"
        className="fixed left-1/2 top-1/2 z-[61] w-[420px] max-w-[94vw] -translate-x-1/2 -translate-y-1/2 rounded-2xl border border-[var(--border-strong)] bg-bg-2 p-5 shadow-[var(--shadow-lg)]"
      >
        <div className="mb-1 flex items-center gap-2.5">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
            <Handshake size={16} aria-hidden />
          </span>
          <h2 className="text-[14.5px] font-semibold text-fg-1">Find a partner</h2>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="ml-auto flex h-[30px] w-[30px] items-center justify-center rounded-lg text-fg-4 hover:bg-surface-1"
          >
            <X size={17} aria-hidden />
          </button>
        </div>
        <p className="mb-4 text-[12px] leading-relaxed text-fg-4">
          Name the firm and Earn puts them on your vetted bench — they land as Suggested and every
          intro from there routes through you.
        </p>
        <div className="flex flex-col gap-3">
          <Field
            label="Firm"
            value={name}
            onChange={setName}
            icon={Briefcase}
            placeholder="e.g. Standish & Cole"
            required
          />
          <Field
            label="Category"
            value={category}
            onChange={setCategory}
            icon={Tag}
            placeholder="e.g. Fund counsel"
            hint="Fund counsel, fund administration, audit & tax, placement agent…"
          />
        </div>
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="ghost" size="sm" onClick={onClose}>
            Cancel
          </Button>
          <Button
            variant="gold"
            size="sm"
            icon={Sparkles}
            disabled={!name.trim()}
            onClick={() => onSubmit(name.trim(), category.trim())}
          >
            Find with Earn
          </Button>
        </div>
      </div>
    </>
  );
}

/* ── the partner network ─────────────────────────────────────────────────── */

export interface PartnerNetworkFlowProps {
  providers: ServiceProvider[];
  /** partner id → intro request status, from `getPartnersData`. */
  introStatus: Record<string, string>;
  /** partner id → most recent intro activity (ISO), from `getPartnersData`. */
  introActivity: Record<string, string>;
}

export function PartnerNetworkFlow({
  providers,
  introStatus: initialIntroStatus,
  introActivity
}: PartnerNetworkFlowProps) {
  const router = useRouter();
  const [introStatus, setIntroStatus] = useState(initialIntroStatus);
  const [openId, setOpenId] = useState<string | null>(null);
  const [running, setRunning] = useState<BenchRow | null>(null);
  const [adding, setAdding] = useState(false);
  const [finding, setFinding] = useState<{ name: string; category: string } | null>(null);
  const [toast, setToast] = useState<string | null>(null);

  // Server refreshes (after a create) re-seed the intro map.
  const [seededFrom, setSeededFrom] = useState(initialIntroStatus);
  if (seededFrom !== initialIntroStatus) {
    setSeededFrom(initialIntroStatus);
    setIntroStatus(initialIntroStatus);
  }

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const rows = deriveBench(providers, introStatus);
  const engaged = rows.filter((r) => r.stage === 'engaged');
  const essentials = essentialCoverage(rows);
  const covered = essentials.filter((e) => e.engaged).length;
  const openRow = openId ? (rows.find((r) => r.id === openId) ?? null) : null;
  const act = running ? BENCH_NEXT[running.stage] : undefined;

  function lastActivityFor(row: BenchRow): string {
    // Only a real intro-request timestamp is "last activity" — provider
    // creation time is not, so an engaged provider with no outreach on record
    // honestly reads "—" rather than looking recently active.
    return relativeActivity(introActivity[row.id] ?? null);
  }

  return (
    <div className="flex flex-col gap-4">
      {/* the prototype's PartnerNetwork panel — tiles, chips and cards in one frame */}
      <Card className="p-[18px]">
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
              <Handshake size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <div>
              <div className="mb-px text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Vetted partners &amp; providers · tap to open
              </div>
              <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                Partner Network
              </h2>
            </div>
          </div>
          <Button variant="ghost" size="sm" icon={Sparkles} onClick={() => setAdding(true)}>
            Find more partners
          </Button>
        </div>

        {/* coverage summary */}
        <div className="mb-3.5 grid grid-cols-3 gap-2.5">
          <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3">
            <div className="text-[11px] text-fg-4">Essential coverage</div>
            <div className="mt-1.5 text-[21px] font-semibold text-success [font-feature-settings:'tnum']">
              {covered}/{essentials.length}
            </div>
            <div className="mt-0.5 text-[10.5px] text-fg-5">key services engaged</div>
          </div>
          <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3">
            <div className="text-[11px] text-fg-4">Engaged</div>
            <div className="mt-1.5 text-[21px] font-semibold text-gold-1 [font-feature-settings:'tnum']">
              {engaged.length}
            </div>
            <div className="mt-0.5 text-[10.5px] text-fg-5">active relationships</div>
          </div>
          <div className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3">
            <div className="text-[11px] text-fg-4">On the bench</div>
            <div className="mt-1.5 text-[21px] font-semibold text-azure-1 [font-feature-settings:'tnum']">
              {rows.length}
            </div>
            <div className="mt-0.5 text-[10.5px] text-fg-5">vetted &amp; ranked</div>
          </div>
        </div>

        {/* essential coverage chips */}
        <div className="mb-4 flex flex-wrap gap-[7px]">
          {essentials.map((e) => {
            const ChipIcon = e.engaged ? Check : CAT_ICON[e.key];
            return (
              <span
                key={e.key}
                className={cn(
                  'inline-flex items-center gap-1.5 rounded-full border px-[11px] py-1 text-[11px] font-medium',
                  e.engaged
                    ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                    : 'border-hairline bg-surface-1 text-fg-4'
                )}
              >
                <ChipIcon size={12} aria-hidden />
                {e.label}
              </span>
            );
          })}
        </div>

        {/* partner cards */}
        {rows.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <Handshake size={22} className="mx-auto text-fg-4" aria-hidden />
            <h3 className="mt-3 text-[15px] font-semibold text-fg-1">
              No providers on the bench yet
            </h3>
            <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
              The team maps counsel, fund admin, audit and placement against your mandate —
              providers land here vetted, and every introduction routes through your approval.
            </p>
            <Button
              variant="secondary"
              size="sm"
              icon={Sparkles}
              className="mt-4"
              onClick={() => setAdding(true)}
            >
              Find your first partner
            </Button>
          </div>
        ) : (
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {rows.map((r) => {
              const Icon = CAT_ICON[r.key];
              const meta = BENCH_STAGE_META[r.stage];
              return (
                <button
                  key={r.id}
                  type="button"
                  onClick={() => setOpenId(r.id)}
                  className="rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-left transition hover:bg-surface-2"
                >
                  <div className="flex items-center gap-2.5">
                    <span
                      className={cn(
                        'flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border',
                        r.stage === 'engaged'
                          ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                          : 'border-hairline bg-surface-2 text-fg-3'
                      )}
                    >
                      <Icon size={16} aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <div className="truncate text-[13px] font-semibold text-fg-1">{r.name}</div>
                      <div className="truncate text-[10.5px] capitalize text-fg-5">
                        {r.category}
                      </div>
                    </div>
                    <Badge tone={meta.tone} className="px-2 py-0.5 text-[9.5px]">
                      {meta.label}
                    </Badge>
                  </div>
                  <div className="mt-2.5 flex items-center gap-3.5 text-[11px] text-fg-4">
                    <span className="flex-none">
                      Fit <b style={{ color: fitColor(r.fit) }}>{r.fit}</b>
                    </span>
                    <span className="truncate">{r.note}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </Card>

      {/* capital partners live on the Capital Map (one home per relationship) */}
      <Link
        href="/source/capital-map"
        className="flex items-center gap-3 rounded-2xl border border-hairline bg-surface-1 px-4 py-3.5 transition hover:bg-surface-2"
      >
        <span className="flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
          <Banknote size={15} aria-hidden />
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

      {openRow && (
        <PartnerDrawer
          row={openRow}
          lastActivity={lastActivityFor(openRow)}
          onClose={() => setOpenId(null)}
          onRun={(r) => {
            setOpenId(null);
            setRunning(r);
          }}
        />
      )}

      {adding && (
        <AddPartnerDialog
          onClose={() => setAdding(false)}
          onSubmit={(name, category) => {
            setAdding(false);
            setFinding({ name, category });
          }}
        />
      )}

      {finding && (
        <ActionRunner
          title={`Find ${finding.name}`}
          steps={[
            'Log them on your vetted bench',
            'Run the vetting checklist',
            'Score fit for a fund your size',
            'Prepare for your approval'
          ]}
          draftTitle={`New partner · ${finding.name}`}
          draft={`${finding.name} joins your vetted bench${
            finding.category ? ` as ${finding.category}` : ''
          } — they land as Suggested, Adrian scores the fit, and every intro from here routes through you.`}
          onApprove={async () => {
            const res = await addServiceProvider({
              name: finding.name,
              category: finding.category || undefined,
              status: 'prospect'
            });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setFinding(null)}
          onApplied={() => {
            setToast(`${finding.name} added to your bench`);
            router.refresh();
          }}
        />
      )}

      {running && act && (
        <ActionRunner
          title={`${act} — ${running.name}`}
          steps={[
            `Pull vetting + fit on ${running.category}`,
            `Draft the ${act.toLowerCase()}`,
            'Check terms & references',
            'Prepare for your approval'
          ]}
          draftTitle={`${act} — ${running.name}`}
          draft={`Earn lined up ${running.name} (${running.category}, fit ${running.fit}) from the vetted bench. Approve to ${act.toLowerCase()} and move them forward.`}
          onApprove={async () => {
            const res =
              running.stage === 'suggested'
                ? await requestPartnerIntro({
                    partnerId: running.id,
                    partnerName: running.name,
                    partnerType: 'service_provider',
                    rationale: 'Requested from the Source hub partner network.'
                  })
                : await engagePartner({ partnerId: running.id });
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunning(null)}
          onApplied={() => {
            const next = running.stage === 'suggested' ? 'requested' : 'introduced';
            setIntroStatus((prev) => ({ ...prev, [running.id]: next }));
            setToast(`${running.name} — ${next === 'requested' ? 'intro requested' : 'engaged'}`);
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
