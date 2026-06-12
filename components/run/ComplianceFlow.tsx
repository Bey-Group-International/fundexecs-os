'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  CalendarClock,
  Check,
  CheckCircle2,
  CircleDashed,
  Clock,
  ListChecks,
  ShieldCheck,
  Sparkles,
  TriangleAlert,
  X,
  Zap
} from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { resolveComplianceItem, seedCompliance } from '@/lib/run-ops/actions';
import {
  COMPLIANCE_BASELINE,
  COMPLIANCE_CATEGORIES,
  compliancePosture,
  isComplianceResolvable,
  normalizeComplianceCategory
} from '@/lib/run-ops/vocabulary';
import type { ComplianceItemView } from '@/lib/queries/run-ops';

/* ── status & severity vocabulary (the prototype's RUN_TONE / DD_SEV) ────── */

const STATUS_TONE: Record<string, BadgeTone> = {
  open: 'warning',
  upcoming: 'info',
  resolved: 'success'
};

const STATUS_BAR: Record<string, string> = {
  open: 'var(--warning)',
  upcoming: 'var(--info)',
  resolved: 'var(--success)'
};

const POSTURE_BAR: Record<string, string> = {
  danger: 'var(--danger)',
  warning: 'var(--warning)',
  info: 'var(--info)',
  success: 'var(--success)'
};

const SEVERITY_TONE: Record<string, BadgeTone> = { high: 'danger', medium: 'warning', low: 'info' };
const SEVERITY_ORDER: Record<string, number> = { high: 0, medium: 1, low: 2 };
const STATUS_ORDER: Record<string, number> = { open: 0, upcoming: 1, resolved: 2 };

function itemName(i: ComplianceItemView): string {
  // Legacy rows (pre-posture board) stored the obligation in `category`.
  return i.name ?? i.category;
}

function itemCat(i: ComplianceItemView): string {
  return i.name ? i.category : normalizeComplianceCategory(i.category);
}

function dueLabel(i: ComplianceItemView): string {
  if (i.status === 'resolved') return 'Clear';
  return i.due ?? (i.status === 'upcoming' ? 'Upcoming' : 'Open');
}

/** The prototype's resolve choreography, per the playbook prompt. */
function resolveSteps(i: ComplianceItemView): string[] {
  return [
    `Pull context with ${i.owner ?? 'Adrian'}`,
    i.action ?? 'Work the item to resolution',
    'Update the record',
    'Prepare for your approval'
  ];
}

function resolveDraft(i: ComplianceItemView): string {
  const base = i.detail ?? 'The item’s requirement, evidenced and noted for counsel.';
  return `${base} Approving marks ${itemName(i)} clear on your posture board — nothing is filed or sent without you, and counsel stays in the loop.`;
}

/* ── modal focus management (the drawer is a dialog) ─────────────────────── */

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

/* ── item detail drawer ──────────────────────────────────────────────────── */

function ItemDrawer({
  item,
  onClose,
  onRun
}: {
  item: ComplianceItemView;
  onClose: () => void;
  onRun: (item: ComplianceItemView) => void;
}) {
  const panelRef = useModalFocus(onClose);
  const done = item.status === 'resolved';
  const statusTone = STATUS_TONE[item.status] ?? 'neutral';
  const StatusIcon = done ? CheckCircle2 : item.status === 'upcoming' ? Clock : TriangleAlert;
  const statusLabel = done ? 'Clear' : item.status === 'upcoming' ? 'Upcoming' : 'Action needed';

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
        aria-label={itemName(item)}
        className="fixed bottom-0 right-0 top-0 z-[61] w-[440px] max-w-[94vw] overflow-y-auto border-l border-[var(--border-strong)] bg-bg-2 shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
          <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border border-hairline bg-surface-2 text-fg-2">
            <ShieldCheck size={20} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[15px] font-semibold text-fg-1">{itemName(item)}</div>
            <div className="truncate text-[11.5px] text-fg-4">
              {itemCat(item)}
              {item.owner ? ` · ${item.owner}` : ''} · {dueLabel(item)}
            </div>
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
          <div className="flex flex-wrap items-center gap-2">
            <Badge
              tone={statusTone}
              className="px-2.5 py-1 text-[10px] normal-case tracking-normal"
            >
              <StatusIcon size={13} aria-hidden />
              {statusLabel}
            </Badge>
            {!done && (
              <Badge
                tone={SEVERITY_TONE[item.severity] ?? 'neutral'}
                className="px-2 py-0.5 text-[9.5px]"
              >
                {item.severity} severity
              </Badge>
            )}
          </div>

          {item.drives && (
            <div className="flex items-center gap-2.5 rounded-[11px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3.5 py-3">
              <Zap size={15} className="flex-none text-gold-1" aria-hidden />
              <span className="text-[12px] text-fg-2">
                <b className="text-gold-1">Why it matters:</b> {item.drives}.
              </span>
            </div>
          )}

          {item.detail && <p className="text-[12.5px] leading-relaxed text-fg-3">{item.detail}</p>}

          {item.checklist.length > 0 && (
            <div>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Checklist · {item.checklist.length}
              </div>
              <div className="flex flex-col gap-1.5">
                {item.checklist.map((x) => (
                  <div
                    key={x}
                    className="flex items-center gap-2.5 rounded-[9px] border border-hairline bg-surface-1 px-3 py-2.5"
                  >
                    {done ? (
                      <CheckCircle2 size={14} className="flex-none text-success" aria-hidden />
                    ) : (
                      <CircleDashed size={14} className="flex-none text-fg-5" aria-hidden />
                    )}
                    <span className={`text-[12.5px] ${done ? 'text-fg-4' : 'text-fg-2'}`}>{x}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {isComplianceResolvable(item.status) ? (
            <div className="rounded-[13px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3.5">
              <div className="mb-2 flex items-center gap-2">
                <EarnCoin size={24} />
                <span className="text-[12.5px] font-semibold text-gold-1">
                  Earn&apos;s next move
                </span>
              </div>
              <div className="mb-3 text-[12px] leading-relaxed text-fg-2">
                {item.action ?? 'Work it to resolution'} — I&apos;ll handle it with{' '}
                {item.owner ?? 'Adrian'} and bring it back for your sign-off, keeping you
                execution-ready.
              </div>
              <Button
                variant="gold"
                size="sm"
                icon={Sparkles}
                className="w-full"
                onClick={() => onRun(item)}
              >
                {item.action ?? 'Resolve'} with Earn
              </Button>
            </div>
          ) : (
            <div className="flex items-center gap-2.5 rounded-[13px] border border-[var(--success-line)] bg-[var(--success-soft)] px-4 py-3.5 text-[13px] font-semibold text-success">
              <CheckCircle2 size={17} aria-hidden />
              Clear · resolved with your approval
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── the posture board ───────────────────────────────────────────────────── */

type RunnerState = { type: 'seed' } | { type: 'resolve'; item: ComplianceItemView };

export function ComplianceFlow({ items }: { items: ComplianceItemView[] }) {
  const router = useRouter();
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cat, setCat] = useState<string>('All');
  const [toast, setToast] = useState<string | null>(null);
  const upcomingRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const open = items.filter((i) => i.status === 'open');
  const upcoming = items.filter((i) => i.status === 'upcoming');
  const clear = items.filter((i) => i.status === 'resolved');
  const highOpen = open.filter((i) => i.severity === 'high').length;
  const score = items.length > 0 ? Math.round((clear.length / items.length) * 100) : 0;
  const posture = compliancePosture(items);

  const shown = items
    .filter((i) => cat === 'All' || itemCat(i) === cat)
    .sort(
      (a, b) =>
        (STATUS_ORDER[a.status] ?? 3) - (STATUS_ORDER[b.status] ?? 3) ||
        (SEVERITY_ORDER[a.severity] ?? 3) - (SEVERITY_ORDER[b.severity] ?? 3)
    );

  const openItem = openId ? (items.find((i) => i.id === openId) ?? null) : null;

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <ShieldCheck size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
                Compliance
              </h1>
              <Badge tone="neutral" className="px-2 py-0.5 text-[9px]">
                Illustrative
              </Badge>
            </div>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Stay execution-ready · Adrian&apos;s posture board, counsel in the loop on every
              resolution.
            </p>
          </div>
        </div>
      </Card>

      {items.length === 0 ? (
        <Card className="p-8 text-center">
          <ShieldCheck size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">No compliance baseline yet</h2>
          <p className="mx-auto mb-4 mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            Adrian sets the posture every emerging manager owes — Regulatory, Investor, Internal and
            Data &amp; Cyber obligations, severity-ranked and worked to resolution.
          </p>
          <Button variant="gold" icon={Sparkles} onClick={() => setRunner({ type: 'seed' })}>
            Set the baseline with Adrian
          </Button>
        </Card>
      ) : (
        <Card className="p-[18px]">
          {/* posture header + readiness CTA pair */}
          <div className="mb-3.5 flex flex-wrap gap-3">
            <div
              className="min-w-[280px] flex-[2_1_280px] rounded-xl border border-hairline bg-surface-1 px-4 py-3.5"
              style={{ borderLeftWidth: 3, borderLeftColor: POSTURE_BAR[posture.tone] }}
            >
              <div className="mb-2 flex flex-wrap items-center gap-2.5">
                <Badge
                  tone={posture.tone}
                  className="px-3 py-1 text-[11px] normal-case tracking-normal"
                >
                  <ShieldCheck size={14} aria-hidden />
                  {posture.label}
                </Badge>
                <span className="text-[11.5px] text-fg-4">
                  {open.length} open · {upcoming.length} upcoming · {clear.length} clear
                </span>
              </div>
              <div className="mb-1.5 flex items-baseline justify-between">
                <span className="text-[11.5px] text-fg-3">
                  <b className="text-fg-1">{score}%</b> compliant · ODD-readiness
                </span>
                {highOpen > 0 && (
                  <span className="text-[11px] text-danger">{highOpen} high-severity</span>
                )}
              </div>
              <div
                className="h-[7px] overflow-hidden rounded-full bg-surface-2"
                role="progressbar"
                aria-label="ODD readiness"
                aria-valuenow={score}
                aria-valuemin={0}
                aria-valuemax={100}
              >
                <div
                  className="h-full bg-[linear-gradient(90deg,#1F8A5B,#2fae74)] transition-[width] duration-300"
                  style={{ width: `${score}%` }}
                />
              </div>
            </div>
            <div className="flex flex-col justify-center gap-2">
              {open.length + upcoming.length > 0 ? (
                <Button variant="secondary" size="sm" icon={ListChecks} disabled>
                  {open.length + upcoming.length} to clear
                </Button>
              ) : (
                <Button variant="gold" size="sm" icon={ShieldCheck}>
                  ODD-ready
                </Button>
              )}
              <Button
                variant="ghost"
                size="sm"
                icon={CalendarClock}
                disabled={upcoming.length === 0}
                onClick={() =>
                  upcomingRef.current?.scrollIntoView({ behavior: 'smooth', block: 'center' })
                }
              >
                Filings calendar
              </Button>
            </div>
          </div>

          {/* category filter chips */}
          <div className="mb-3 flex flex-wrap gap-1.5">
            {['All', ...COMPLIANCE_CATEGORIES].map((c) => (
              <button
                key={c}
                type="button"
                onClick={() => setCat(c)}
                aria-pressed={cat === c}
                className={`rounded-full border px-3 py-1.5 text-[11.5px] font-medium transition ${
                  cat === c
                    ? 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1'
                    : 'border-hairline bg-surface-1 text-fg-3 hover:bg-surface-2'
                }`}
              >
                {c}
              </button>
            ))}
          </div>

          {/* upcoming deadlines strip */}
          {upcoming.length > 0 && (
            <div
              ref={upcomingRef}
              className="mb-3 rounded-xl border border-hairline bg-surface-1 px-3.5 py-2.5"
            >
              <div className="mb-2 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                <CalendarClock size={12} className="text-info" aria-hidden />
                Upcoming deadlines · {upcoming.length}
              </div>
              <div className="flex flex-wrap gap-2">
                {upcoming.map((u) => (
                  <button
                    key={u.id}
                    type="button"
                    onClick={() => setOpenId(u.id)}
                    className="inline-flex items-center gap-1.5 rounded-full border border-[var(--info-line)] bg-[var(--info-soft)] px-2.5 py-1.5 text-fg-2 transition hover:brightness-110"
                  >
                    <Clock size={12} className="text-info" aria-hidden />
                    <span className="text-[11.5px] font-medium">{itemName(u)}</span>
                    {u.due && <span className="text-[10.5px] text-fg-4">· {u.due}</span>}
                  </button>
                ))}
              </div>
            </div>
          )}

          {/* obligations list */}
          <div className="flex flex-col gap-1.5">
            {shown.map((i) => {
              const done = i.status === 'resolved';
              return (
                <div
                  key={i.id}
                  role="button"
                  tabIndex={0}
                  onClick={() => setOpenId(i.id)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' || e.key === ' ') {
                      e.preventDefault();
                      setOpenId(i.id);
                    }
                  }}
                  className={`flex cursor-pointer items-center gap-3 rounded-xl border border-hairline bg-surface-1 px-3.5 py-3 text-left transition hover:bg-surface-2 ${
                    done ? 'opacity-70' : ''
                  }`}
                  style={{
                    borderLeftWidth: 2,
                    borderLeftColor: STATUS_BAR[i.status] ?? 'var(--fg-5)'
                  }}
                >
                  <span
                    className={`flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border ${
                      done
                        ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                        : 'border-hairline bg-surface-2 text-fg-3'
                    }`}
                  >
                    {done ? <Check size={15} aria-hidden /> : <ShieldCheck size={15} aria-hidden />}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-[13px] font-semibold text-fg-1">
                        {itemName(i)}
                      </span>
                      {!done && (
                        <Badge
                          tone={SEVERITY_TONE[i.severity] ?? 'neutral'}
                          className="flex-none px-1.5 py-0 text-[8.5px]"
                        >
                          {i.severity}
                        </Badge>
                      )}
                      <span className="flex-none text-[9.5px] text-fg-5">· {itemCat(i)}</span>
                    </div>
                    <div
                      className={`mt-0.5 truncate text-[11px] ${done ? 'text-fg-5' : 'text-gold-1'}`}
                    >
                      {done
                        ? `Clear${i.owner ? ` · ${i.owner}` : ''}`
                        : (i.drives ?? 'Worked to resolution with counsel in the loop')}
                    </div>
                  </div>
                  <Badge
                    tone={STATUS_TONE[i.status] ?? 'neutral'}
                    className="flex-none px-1.5 py-0 text-[9px]"
                  >
                    {dueLabel(i)}
                  </Badge>
                  {isComplianceResolvable(i.status) && (
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={Sparkles}
                      className="flex-none"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRunner({ type: 'resolve', item: i });
                      }}
                    >
                      {i.action ?? 'Resolve'}
                    </Button>
                  )}
                </div>
              );
            })}
            {shown.length === 0 && (
              <div className="rounded-xl border border-hairline bg-surface-1 px-4 py-6 text-center text-[12.5px] text-fg-4">
                No {cat} items on the board.
              </div>
            )}
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

      {openItem && (
        <ItemDrawer
          item={openItem}
          onClose={() => setOpenId(null)}
          onRun={(item) => {
            setOpenId(null);
            setRunner({ type: 'resolve', item });
          }}
        />
      )}

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
          draft={`${COMPLIANCE_BASELINE.length} obligations across Regulatory, Investor, Internal and Data & Cyber — severity-ranked, every one open or upcoming. Approving stands the board up; each item is then worked to resolution with counsel in the loop, and nothing is ever pre-marked done.`}
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
          title={`${runner.item.action ?? 'Resolve'} — ${itemName(runner.item)}`}
          steps={resolveSteps(runner.item)}
          draftTitle={`Resolution · ${itemName(runner.item)}`}
          draft={resolveDraft(runner.item)}
          approveLabel="Approve & resolve"
          onApprove={async () => {
            const res = await resolveComplianceItem(runner.item.id);
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`${itemName(runner.item)} — clear`);
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
