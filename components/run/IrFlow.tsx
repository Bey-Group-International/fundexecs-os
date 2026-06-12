'use client';

import { useEffect, useRef, useState } from 'react';
import { useRouter } from 'next/navigation';
import {
  Calendar,
  Check,
  CheckCircle2,
  Edit3,
  FileText,
  HeartHandshake,
  Send,
  ShieldCheck,
  Sparkles,
  TrendingUp,
  Users,
  X,
  Zap
} from 'lucide-react';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { Avatar } from '@/components/ui/Avatar';
import { Badge, type BadgeTone } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { compactMoney } from '@/lib/format';
import { markIrSent, seedIr } from '@/lib/run-ops/actions';
import { IR_BASELINE, IR_CATS, irAction, irSentiment } from '@/lib/run-ops/vocabulary';
import type { IrItemView, IrLpView, IrPerfView } from '@/lib/queries/run-ops';

/* ── due/status vocabulary ───────────────────────────────────────────────── */

/** Whole-day offset from now to the due date; null when undated. */
function dueDays(iso: string | null): number | null {
  if (!iso) return null;
  return Math.ceil((new Date(iso).getTime() - Date.now()) / 86_400_000);
}

function dueLabel(iso: string | null): string {
  const days = dueDays(iso);
  if (days === null) return 'No date';
  if (days < 0) return `${-days}d overdue`;
  if (days === 0) return 'Due today';
  return `Due in ${days}d`;
}

function isOverdue(iso: string | null): boolean {
  const days = dueDays(iso);
  return days !== null && days < 0;
}

function dueTone(item: IrItemView): BadgeTone {
  if (item.status === 'sent') return 'success';
  return isOverdue(item.dueAt) ? 'danger' : 'azure';
}

/** Row left-border color, the prototype's RUN_TONE accent. */
function rowBar(item: IrItemView): string {
  if (item.status === 'sent') return 'var(--success)';
  return isOverdue(item.dueAt) ? 'var(--danger)' : 'var(--azure-1)';
}

/** The send choreography — the prototype's per-row run payload. */
function sendSteps(item: IrItemView): string[] {
  return [
    `Pull context with ${item.who ?? 'Eleanor'}`,
    irAction(item.category),
    'Update the record',
    'Prepare for your approval'
  ];
}

function sendDraft(item: IrItemView): string {
  return `${item.name}, assembled from your live workspace and staged against your LP list. Approving records the send on your cadence — sending never emails anyone from FundExecs OS yet.`;
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

/* ── the deliverable detail drawer ───────────────────────────────────────── */

function IrDrawer({
  item,
  onClose,
  onRun
}: {
  item: IrItemView;
  onClose: () => void;
  onRun: (item: IrItemView) => void;
}) {
  const panelRef = useModalFocus(onClose);
  const sent = item.status === 'sent';
  const action = irAction(item.category);
  const metaLine = [item.category, item.who, sent ? 'Sent' : dueLabel(item.dueAt)]
    .filter(Boolean)
    .join(' · ');

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
        aria-label={item.name}
        className="fixed bottom-0 right-0 top-0 z-[61] w-[440px] max-w-[94vw] overflow-y-auto border-l border-[var(--border-strong)] bg-bg-2 shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-center gap-3 border-b border-hairline px-5 py-4">
          <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border border-hairline bg-surface-2 text-fg-2">
            <FileText size={20} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15px] font-semibold text-fg-1">{item.name}</div>
            <div className="text-[11.5px] text-fg-4">{metaLine}</div>
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
          <Badge
            tone={sent ? 'success' : 'azure'}
            className="self-start px-2.5 py-1 text-[10.5px] normal-case tracking-normal"
          >
            {sent ? <CheckCircle2 size={13} aria-hidden /> : <Edit3 size={13} aria-hidden />}
            {sent ? 'Sent' : 'Ready to send'}
          </Badge>

          {item.drives && (
            <div className="flex items-center gap-2.5 rounded-[11px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3.5 py-3">
              <Zap size={15} className="flex-none text-gold-1" aria-hidden />
              <span className="text-[12px] text-fg-2">
                <b className="text-gold-1">Why it matters:</b> {item.drives}.
              </span>
            </div>
          )}

          {item.detail && <p className="text-[12.5px] leading-relaxed text-fg-3">{item.detail}</p>}

          {item.contents.length > 0 && (
            <div>
              <div className="mb-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Contents · {item.contents.length}
              </div>
              <div className="flex flex-col gap-1.5">
                {item.contents.map((c) => (
                  <div
                    key={c}
                    className="flex items-center gap-2.5 rounded-[9px] border border-hairline bg-surface-1 px-3 py-2"
                  >
                    {sent ? (
                      <CheckCircle2 size={14} className="flex-none text-success" aria-hidden />
                    ) : (
                      <span
                        className="h-[14px] w-[14px] flex-none rounded-full border border-dashed border-[var(--fg-5)]"
                        aria-hidden
                      />
                    )}
                    <span className={`text-[12.5px] ${sent ? 'text-fg-4' : 'text-fg-2'}`}>{c}</span>
                  </div>
                ))}
              </div>
            </div>
          )}

          {sent ? (
            <div className="flex items-center gap-2.5 rounded-[13px] border border-[var(--success-line)] bg-[var(--success-soft)] px-4 py-3.5 text-[13px] font-semibold text-success">
              <CheckCircle2 size={17} aria-hidden />
              Sent · logged on your cadence
            </div>
          ) : (
            <div className="rounded-[13px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-4 py-3.5">
              <div className="mb-2 flex items-center gap-2">
                <EarnCoin size={24} />
                <span className="text-[12.5px] font-semibold text-gold-1">
                  Earn&apos;s next move
                </span>
              </div>
              <div className="mb-3 text-[12px] leading-relaxed text-fg-2">
                {action} — {item.who ?? 'Eleanor'} assembled it from your workspace. Review and
                approve; approving records the send on your cadence.
              </div>
              <Button
                variant="gold"
                size="sm"
                icon={Sparkles}
                className="w-full"
                onClick={() => onRun(item)}
              >
                {action} with Earn
              </Button>
            </div>
          )}
        </div>
      </div>
    </>
  );
}

/* ── the IR center ───────────────────────────────────────────────────────── */

type RunnerState = { type: 'seed' } | { type: 'send'; item: IrItemView };

export interface IrFlowProps {
  items: IrItemView[];
  /** Committed investors from the capital map — real signals only. */
  lps: IrLpView[];
  /** Performance figures computed from real capital records; null = absent. */
  perf: IrPerfView;
}

export function IrFlow({ items, lps, perf }: IrFlowProps) {
  const router = useRouter();
  const [runner, setRunner] = useState<RunnerState | null>(null);
  const [openId, setOpenId] = useState<string | null>(null);
  const [cat, setCat] = useState<string>('All');
  const [toast, setToast] = useState<string | null>(null);
  const listRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(null), 3200);
    return () => clearTimeout(t);
  }, [toast]);

  const sent = items.filter((i) => i.status === 'sent').length;
  const open = items.filter((i) => i.status !== 'sent');
  // On cadence = already sent or not yet overdue; only late items count against it.
  const onTimeCount = items.filter((i) => i.status === 'sent' || !isOverdue(i.dueAt)).length;
  const onTime = items.length > 0 ? Math.round((onTimeCount / items.length) * 100) : 0;
  const sentiments = lps.map((l) => ({ lp: l, sentiment: irSentiment(l.warmth) }));
  const attention = sentiments.filter((s) => s.sentiment?.tone === 'warning').length;
  const champions = sentiments.filter((s) => s.sentiment?.label === 'Champion').length;
  const shown = items.filter((i) => cat === 'All' || i.category === cat);
  const openItem = openId ? (items.find((i) => i.id === openId) ?? null) : null;

  const perfTiles: { label: string; value: string | null; color: string }[] = [
    {
      label: 'Net IRR',
      value: perf.netIrr !== null ? `${perf.netIrr.toFixed(1)}%` : null,
      color: 'var(--success)'
    },
    {
      label: 'TVPI',
      value: perf.tvpi !== null ? `${perf.tvpi.toFixed(2)}x` : null,
      color: 'var(--gold-1)'
    },
    {
      label: 'DPI',
      value: perf.dpi !== null ? `${perf.dpi.toFixed(2)}x` : null,
      color: 'var(--azure-1)'
    },
    { label: 'NAV', value: perf.nav !== null ? compactMoney(perf.nav) : null, color: 'var(--info)' }
  ];
  const anyPerf = perfTiles.some((t) => t.value !== null);

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-[18px]">
        {/* panel framing */}
        <div className="mb-4 flex items-start justify-between gap-3">
          <div className="flex items-center gap-2.5">
            <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
              <Users size={16} strokeWidth={1.9} aria-hidden />
            </span>
            <div>
              <div className="mb-px text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                Keep LPs confident · Eleanor
              </div>
              <h2 className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">
                IR &amp; reporting
              </h2>
            </div>
          </div>
        </div>

        {items.length === 0 ? (
          /* honest empty state — the cadence hasn't been stood up yet */
          <div className="px-4 py-8 text-center">
            <Users size={22} className="mx-auto text-fg-4" aria-hidden />
            <h3 className="mt-3 text-[15px] font-semibold text-fg-1">No reporting cadence yet</h3>
            <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
              Eleanor sets the deliverables LPs expect — the quarterly letter, capital account
              statements, the pipeline update — each dated and driven to sent.
            </p>
            <Button
              variant="gold"
              size="sm"
              icon={Sparkles}
              className="mt-4"
              onClick={() => setRunner({ type: 'seed' })}
            >
              Set the cadence with Eleanor
            </Button>
          </div>
        ) : (
          <>
            {/* IR posture header */}
            <div className="mb-4 flex flex-wrap gap-3">
              <div
                className="min-w-[280px] flex-[2_1_280px] rounded-xl border border-hairline bg-surface-1 px-4 py-3.5"
                style={{
                  borderLeftWidth: 3,
                  borderLeftColor: attention ? 'var(--warning)' : 'var(--success)'
                }}
              >
                <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
                  <Badge
                    tone={attention ? 'warning' : 'success'}
                    className="px-3 py-1 text-[11px] normal-case tracking-normal"
                  >
                    <HeartHandshake size={14} aria-hidden />
                    {attention
                      ? `${attention} LP${attention === 1 ? '' : 's'} need${attention === 1 ? 's' : ''} attention`
                      : 'LPs warm'}
                  </Badge>
                  <span className="text-[11.5px] text-fg-4">
                    {lps.length > 0 ? `${champions} champion · ` : ''}
                    {open.length} report{open.length === 1 ? '' : 's'} open
                  </span>
                </div>
                <div className="mb-1.5 flex items-baseline justify-between">
                  <span className="text-[11.5px] text-fg-3">
                    <b className="text-fg-1">{onTime}%</b> reporting on cadence
                  </span>
                  <span className="text-[11px] text-fg-4">
                    {sent}/{items.length} sent
                  </span>
                </div>
                <div
                  className="h-[7px] overflow-hidden rounded-full bg-surface-2"
                  role="progressbar"
                  aria-label="Reporting on cadence"
                  aria-valuenow={onTime}
                  aria-valuemin={0}
                  aria-valuemax={100}
                >
                  <div
                    className="h-full bg-[linear-gradient(90deg,#1F8A5B,#2fae74)] transition-[width] duration-300"
                    style={{ width: `${onTime}%` }}
                  />
                </div>
              </div>
              <div className="flex flex-col justify-center gap-2">
                <Button
                  variant={open.length ? 'secondary' : 'gold'}
                  size="sm"
                  icon={open.length ? Send : CheckCircle2}
                  disabled={!!open.length}
                >
                  {open.length ? `${open.length} to send` : 'All sent'}
                </Button>
                <Button
                  variant="ghost"
                  size="sm"
                  icon={Calendar}
                  onClick={() => {
                    setCat('All');
                    listRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' });
                  }}
                >
                  Reporting calendar
                </Button>
              </div>
            </div>

            {/* fund performance snapshot — real figures only */}
            <div className="mb-4 rounded-xl border border-hairline bg-surface-1 px-3.5 py-3">
              <div className="mb-2.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                <TrendingUp size={12} className="text-gold-1" aria-hidden />
                Fund performance · what LPs check first
              </div>
              <div className="grid grid-cols-2 gap-2.5 sm:grid-cols-4">
                {perfTiles.map((p) => (
                  <div
                    key={p.label}
                    className="rounded-[10px] border border-hairline bg-surface-2 px-3 py-2.5"
                  >
                    <div className="text-[10.5px] text-fg-4">{p.label}</div>
                    {p.value !== null ? (
                      <div
                        className="mt-1 text-[20px] font-semibold [font-feature-settings:'tnum']"
                        style={{ color: p.color }}
                      >
                        {p.value}
                      </div>
                    ) : (
                      <div className="mt-1 text-[20px] font-semibold text-fg-5">—</div>
                    )}
                  </div>
                ))}
              </div>
              <div className="mt-2 text-[10.5px] text-fg-5">
                {anyPerf
                  ? 'Computed from your capital records · — figures arrive as records land'
                  : 'No fund records yet — figures compute from your capital accounts as they land'}
              </div>
            </div>

            {/* LP engagement roster — real committed investors only */}
            <div className="mb-4 rounded-xl border border-hairline bg-surface-1 px-3.5 py-3">
              <div className="mb-2.5 flex items-center gap-1.5 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
                <Users size={12} aria-hidden />
                LP engagement
              </div>
              {lps.length === 0 ? (
                <p className="text-[11.5px] leading-relaxed text-fg-5">
                  No committed LPs yet — investors land here from your capital map as they commit,
                  with sentiment from real engagement signals.
                </p>
              ) : (
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {sentiments.map(({ lp, sentiment }) => (
                    <div
                      key={lp.id}
                      className="flex items-center gap-2.5 rounded-[10px] border border-hairline bg-surface-2 px-2.5 py-2"
                    >
                      <Avatar
                        name={lp.name}
                        size={28}
                        tone={sentiment?.tone === 'success' ? 'gold' : 'azure'}
                      />
                      <div className="min-w-0 flex-1">
                        <div className="truncate text-[12px] font-semibold text-fg-1">
                          {lp.name}
                        </div>
                        <div className="truncate text-[10px] text-fg-5">
                          {lp.lastTouch ?? lp.type ?? 'Committed'}
                        </div>
                      </div>
                      {sentiment && (
                        <Badge tone={sentiment.tone} className="flex-none px-2 py-0.5 text-[9px]">
                          {sentiment.label}
                        </Badge>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* category filter */}
            <div
              className="mb-3 flex flex-wrap gap-1.5"
              role="group"
              aria-label="Filter deliverables"
            >
              {['All', ...IR_CATS].map((c) => (
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

            {/* deliverables */}
            <div ref={listRef} className="flex flex-col gap-1.5">
              {shown.length === 0 ? (
                <p className="px-1 py-3 text-[11.5px] text-fg-5">Nothing filed under {cat} yet.</p>
              ) : (
                shown
                  .slice()
                  .sort((a, b) => (a.status === 'sent' ? 1 : 0) - (b.status === 'sent' ? 1 : 0))
                  .map((i) => {
                    const done = i.status === 'sent';
                    return (
                      <div
                        key={i.id}
                        role="button"
                        tabIndex={0}
                        onClick={() => setOpenId(i.id)}
                        onKeyDown={(e) => {
                          // Keys bubbling up from the nested send button must not open the drawer.
                          if (e.target !== e.currentTarget) return;
                          if (e.key === 'Enter' || e.key === ' ') {
                            e.preventDefault();
                            setOpenId(i.id);
                          }
                        }}
                        className={`flex cursor-pointer items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3 transition hover:bg-surface-2 ${
                          done ? 'opacity-70' : ''
                        }`}
                        style={{ borderLeftWidth: 2, borderLeftColor: rowBar(i) }}
                      >
                        <span
                          className={`flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border ${
                            done
                              ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                              : 'border-hairline bg-surface-2 text-fg-3'
                          }`}
                        >
                          {done ? (
                            <Check size={15} aria-hidden />
                          ) : (
                            <FileText size={15} aria-hidden />
                          )}
                        </span>
                        <div className="min-w-0 flex-1">
                          <div className="flex items-center gap-2">
                            <span className="truncate text-[13px] font-semibold text-fg-1">
                              {i.name}
                            </span>
                            {i.category && (
                              <span className="flex-none text-[9.5px] text-fg-5">
                                · {i.category}
                              </span>
                            )}
                          </div>
                          <div
                            className={`mt-0.5 truncate text-[11px] ${done ? 'text-fg-5' : 'text-gold-1'}`}
                          >
                            {done
                              ? `Sent${i.who ? ` · ${i.who}` : ''}`
                              : (i.drives ?? dueLabel(i.dueAt))}
                          </div>
                        </div>
                        <Badge tone={dueTone(i)} className="flex-none px-2 py-0.5 text-[9px]">
                          {done ? 'Sent' : dueLabel(i.dueAt)}
                        </Badge>
                        {!done && (
                          <Button
                            variant="secondary"
                            size="sm"
                            icon={Sparkles}
                            className="flex-none"
                            onClick={(e) => {
                              e.stopPropagation();
                              setRunner({ type: 'send', item: i });
                            }}
                          >
                            {irAction(i.category)}
                          </Button>
                        )}
                      </div>
                    );
                  })
              )}
            </div>
          </>
        )}
      </Card>

      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> Confidence between raises is built on cadence.
          Eleanor assembles every deliverable from your workspace — nothing reaches an LP until you
          approve.
        </p>
      </Card>

      {openItem && (
        <IrDrawer
          item={openItem}
          onClose={() => setOpenId(null)}
          onRun={(item) => {
            setOpenId(null);
            setRunner({ type: 'send', item });
          }}
        />
      )}

      {runner?.type === 'seed' && (
        <ActionRunner
          title="Set the reporting cadence"
          steps={[
            'Read your raise stage and LP roster',
            'Assemble the deliverable calendar',
            'Date each deliverable',
            'Prepare for your approval'
          ]}
          draftTitle="Eleanor's reporting cadence"
          draft={`${IR_BASELINE.length} dated deliverables: ${IR_BASELINE.map((i) => i.name.toLowerCase()).join(', ')}. Approving stands the calendar up — each deliverable is then assembled and sent on your approval.`}
          approveLabel="Approve & set"
          onApprove={async () => {
            const res = await seedIr();
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast('Reporting cadence set');
            router.refresh();
          }}
        />
      )}

      {runner?.type === 'send' && (
        <ActionRunner
          title={`${irAction(runner.item.category)} — ${runner.item.name}`}
          steps={sendSteps(runner.item)}
          draftTitle={runner.item.name}
          draft={sendDraft(runner.item)}
          approveLabel="Approve & send"
          onApprove={async () => {
            const res = await markIrSent(runner.item.id);
            return res.ok ? { ok: true } : { ok: false, error: res.error };
          }}
          onClose={() => setRunner(null)}
          onApplied={() => {
            setToast(`${runner.item.name} — sent`);
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
