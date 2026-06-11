'use client';

import { createElement, useEffect, useRef, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  AlertTriangle,
  Building2,
  Calculator,
  Check,
  CheckCircle2,
  ChevronRight,
  CircleCheckBig,
  Cpu,
  FileCheck2,
  FileSearch,
  FileText,
  Gauge,
  Info,
  Leaf,
  Loader2,
  Paperclip,
  Phone,
  Scale,
  Sparkles,
  TrendingUp,
  Users,
  X,
  type LucideIcon
} from 'lucide-react';
import { Badge, Button, Card, ProgressBar, type BadgeTone } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { cn } from '@/lib/utils';
import {
  DD_AGENTS,
  DD_DEALS,
  DD_DEAL_META,
  DD_SEV_TONE,
  DD_STATUS,
  dealAgentsCopy,
  dealReadiness,
  deriveVerdict,
  icReady,
  resolveAgent,
  resolveSteps,
  riskRegister,
  type DDAgent,
  type DDAgentMap,
  type DDAgentState
} from '@/lib/diligence-desk/config';

/* ── icon resolvers ──────────────────────────────────────────────────────── */
const ICONS: Record<string, LucideIcon> = {
  calculator: Calculator,
  scale: Scale,
  'trending-up': TrendingUp,
  cpu: Cpu,
  users: Users,
  leaf: Leaf,
  phone: Phone,
  'check-circle-2': CheckCircle2,
  info: Info,
  'alert-triangle': AlertTriangle,
  loader: Loader2
};
function icon(name: string): LucideIcon {
  return ICONS[name] ?? FileSearch;
}

/** Map a Badge tone to its design-token color (for accent bars + meters). */
const TONE_COLOR: Record<BadgeTone, string> = {
  neutral: 'var(--fg-4)',
  gold: 'var(--gold-1)',
  azure: 'var(--accent)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)'
};

function Eyebrow({ children, className }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={cn('text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4', className)}
    >
      {children}
    </div>
  );
}

function PanelHeader({
  icon: Ico,
  title,
  eyebrow
}: {
  icon: LucideIcon;
  title: string;
  eyebrow: string;
}) {
  return (
    <div className="mb-3 flex items-center gap-2.5">
      <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
        <Ico size={16} strokeWidth={1.9} aria-hidden />
      </span>
      <div>
        <Eyebrow className="mb-px">{eyebrow}</Eyebrow>
        <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">{title}</div>
      </div>
    </div>
  );
}

/* ── the agent detail drawer (accessible dialog + copiloted resolution) ───── */

const DRAWER_FOCUSABLE =
  'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';

function AgentDrawer({
  agent,
  state,
  dealName,
  onResolve,
  onClose
}: {
  agent: DDAgent;
  state: DDAgentState;
  dealName: string;
  onResolve: (agentId: string) => void;
  onClose: () => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const [phase, setPhase] = useState<'detail' | 'resolving'>('detail');
  const [n, setN] = useState(0);
  const steps = resolveSteps(agent, state);
  const statusMeta = DD_STATUS[state.status];
  const cleared = state.status === 'clear';

  const panelRef = useRef<HTMLDivElement>(null);
  const openerRef = useRef<HTMLElement | null>(null);

  // Full dialog ergonomics: focus into the drawer on open, trap Tab, close on
  // Escape, lock background scroll, restore focus to the opener on close.
  // Mirrors components/dataroom/DataRoomFlow.tsx's VettingGate.
  useEffect(() => {
    openerRef.current = document.activeElement as HTMLElement | null;
    const panel = panelRef.current;
    panel?.querySelector<HTMLElement>(DRAWER_FOCUSABLE)?.focus();

    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = 'hidden';

    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
        return;
      }
      if (e.key !== 'Tab' || !panel) return;
      const focusable = Array.from(panel.querySelectorAll<HTMLElement>(DRAWER_FOCUSABLE));
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

  // Drive the resolution steps, then apply the pure clear transform upstream.
  useEffect(() => {
    if (phase !== 'resolving') return;
    if (reduced) {
      const t = setTimeout(() => {
        onResolve(agent.id);
        setPhase('detail');
        setN(0);
      }, 300);
      return () => clearTimeout(t);
    }
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= steps.length) {
        clearInterval(timer);
        setTimeout(() => {
          onResolve(agent.id);
          setPhase('detail');
          setN(0);
        }, 450);
      }
    }, 600);
    return () => clearInterval(timer);
  }, [phase, reduced, steps.length, agent.id, onResolve]);

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
        aria-label={`${agent.name} diligence — ${dealName}`}
        className="fixed bottom-0 right-0 top-0 z-[61] w-[440px] max-w-[94vw] overflow-y-auto border-l border-[var(--border-strong)] bg-bg-2 shadow-[-30px_0_80px_-30px_rgba(0,0,0,0.7)]"
      >
        <div className="flex items-center gap-3 border-b border-hairline px-5 py-[18px]">
          <span className="flex h-[42px] w-[42px] flex-none items-center justify-center rounded-[11px] border border-hairline bg-surface-2 text-fg-2">
            {createElement(icon(agent.icon), { size: 20, strokeWidth: 1.9, 'aria-hidden': true })}
          </span>
          <div className="min-w-0 flex-1">
            <div className="text-[15.5px] font-semibold text-fg-1">{agent.name}</div>
            <div className="text-[11.5px] text-fg-4">
              Run by {agent.who} · {dealName}
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

        {phase === 'resolving' ? (
          <div className="flex flex-col items-center px-5 py-8 text-center">
            <div className="relative mb-3">
              <span
                aria-hidden
                className="absolute -inset-2.5 rounded-full motion-safe:animate-pulse"
                style={{
                  background: 'radial-gradient(circle, rgba(247,201,72,0.5), transparent 70%)',
                  filter: 'blur(8px)'
                }}
              />
              <EarnCoin size={48} className="relative" />
            </div>
            <h2 className="text-[17px] font-semibold tracking-[-0.015em] text-fg-1">
              Resolving with {agent.who}…
            </h2>
            <p className="mt-1.5 text-[12px] text-fg-3">
              Clearing the workstream and logging evidence for your sign-off.
            </p>
            <ProgressBar
              value={Math.round((n / steps.length) * 100)}
              gradient="linear-gradient(90deg,#F7C948,#E5A823)"
              height={6}
              ariaLabel="Resolution progress"
              className="mt-4 w-full"
            />
            <Card className="mt-3.5 flex w-full flex-col gap-0.5 p-3 text-left">
              {steps.map((s, i) =>
                i <= n ? (
                  <div key={s} className="flex items-center gap-2.5 px-2 py-2">
                    <span
                      className={cn(
                        'flex h-[22px] w-[22px] flex-none items-center justify-center rounded-full border',
                        i < n
                          ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                          : 'border-hairline bg-surface-2 text-fg-4'
                      )}
                    >
                      {i < n ? (
                        <Check size={12} strokeWidth={2.4} aria-hidden />
                      ) : (
                        <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden />
                      )}
                    </span>
                    <span className={cn('text-[13px]', i < n ? 'text-fg-2' : 'text-fg-1')}>
                      {s}
                    </span>
                  </div>
                ) : null
              )}
            </Card>
          </div>
        ) : (
          <div className="flex flex-col gap-4 p-5">
            <div className="flex flex-wrap items-center gap-2">
              <Badge tone={statusMeta.tone} dot>
                {statusMeta.label}
              </Badge>
              {state.severity && !cleared && (
                <span
                  className="rounded-[5px] px-2 py-[3px] text-[9.5px] font-bold uppercase tracking-[0.04em] text-white"
                  style={{ background: TONE_COLOR[DD_SEV_TONE[state.severity]] }}
                >
                  {state.severity} severity
                </span>
              )}
            </div>

            <div className="grid grid-cols-2 gap-2.5">
              <Card className="p-3">
                <div className="text-[10px] text-fg-5">Confidence</div>
                <div
                  className="mt-1 text-[18px] font-semibold tabular-nums"
                  style={{ color: TONE_COLOR[statusMeta.tone] }}
                >
                  {state.confidence}%
                </div>
              </Card>
              <Card className="p-3">
                <div className="text-[10px] text-fg-5">Checks run</div>
                <div className="mt-1 text-[18px] font-semibold tabular-nums text-fg-1">
                  {state.checks}
                </div>
              </Card>
            </div>

            <div>
              <div className="text-[14.5px] font-semibold text-fg-1">{state.headline}</div>
              <p className="mt-2 text-[12.5px] leading-relaxed text-fg-3">{state.detail}</p>
            </div>

            <div>
              <Eyebrow className="mb-2 flex items-center gap-1.5">
                <Paperclip size={12} className="text-fg-4" aria-hidden />
                Evidence reviewed · {state.evidence.length}
              </Eyebrow>
              <div className="flex flex-col gap-1.5">
                {state.evidence.map((e) => (
                  <div
                    key={e}
                    className="flex items-center gap-2.5 rounded-[9px] border border-[var(--border-faint)] bg-surface-1 px-3 py-2"
                  >
                    <FileCheck2 size={14} className="flex-none text-success" aria-hidden />
                    <span className="flex-1 text-[12px] text-fg-2">{e}</span>
                    <Check size={13} className="text-fg-5" aria-hidden />
                  </div>
                ))}
              </div>
            </div>

            {cleared ? (
              <div className="flex items-center gap-2.5 rounded-[13px] border border-[var(--success-line)] bg-[var(--success-soft)] px-4 py-3.5 text-[13px] font-semibold text-success">
                <CheckCircle2 size={17} aria-hidden />
                Cleared · logged to Chain of Trust
              </div>
            ) : state.status === 'pending' ? (
              <div className="flex items-center gap-2.5 rounded-[13px] border border-hairline bg-surface-1 px-4 py-3.5 text-[12.5px] text-fg-3">
                <Loader2 size={16} className="flex-none motion-safe:animate-spin" aria-hidden />
                {agent.who} is still running this workstream — findings land shortly.
              </div>
            ) : (
              <div className="rounded-[13px] border border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
                <div className="mb-2 flex items-center gap-2.5">
                  <EarnCoin size={24} />
                  <span className="text-[12.5px] font-semibold text-gold-1">
                    Earn&apos;s resolution
                  </span>
                </div>
                <p className="mb-3 text-[12px] leading-relaxed text-fg-2">
                  {state.action} — I&apos;ll prepare it with {agent.who} and bring it back for your
                  sign-off.
                </p>
                <Button
                  variant="gold"
                  size="sm"
                  icon={Sparkles}
                  className="w-full"
                  onClick={() => setPhase('resolving')}
                >
                  {state.action} with Earn
                </Button>
              </div>
            )}
          </div>
        )}
      </div>
    </>
  );
}

/* ── the diligence desk ──────────────────────────────────────────────────── */

export function DiligenceDeskFlow({ firm }: { firm: string }) {
  const [dealId, setDealId] = useState<string>(DD_DEAL_META[0].id);
  const [agentsByDeal, setAgentsByDeal] = useState<Record<string, DDAgentMap>>(() => {
    const out: Record<string, DDAgentMap> = {};
    for (const meta of DD_DEAL_META) out[meta.id] = dealAgentsCopy(DD_DEALS[meta.id]);
    return out;
  });
  const [openAgentId, setOpenAgentId] = useState<string | null>(null);

  const deal = DD_DEALS[dealId];
  const agents = agentsByDeal[dealId];
  const readiness = dealReadiness(agents);
  const verdict = deriveVerdict(agents);
  const register = riskRegister(agents);
  const ready = icReady(agents);

  const resolve = (agentId: string) =>
    setAgentsByDeal((prev) => ({
      ...prev,
      [dealId]: { ...prev[dealId], [agentId]: resolveAgent(prev[dealId][agentId]) }
    }));

  const openAgentMeta = openAgentId ? DD_AGENTS.find((a) => a.id === openAgentId) : null;

  return (
    <div className="flex flex-col gap-4">
      {/* header */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <FileSearch size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
              Diligence desk
            </h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              A panel of agents runs each workstream on your live deals — {firm} reviews and clears
              toward an IC verdict.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">
              {readiness.pct}%
            </div>
            <div className="text-[10.5px] text-fg-5">Cleared</div>
          </div>
          <Badge tone="warning" className="ml-1 self-start text-[10px]">
            Illustrative
          </Badge>
        </div>
        <ProgressBar
          value={readiness.pct}
          gradient="linear-gradient(90deg,#F7C948,#E5A823)"
          height={6}
          ariaLabel="Diligence cleared"
          className="mt-3.5"
        />
      </Card>

      <Card className="p-[18px]">
        <PanelHeader
          icon={FileSearch}
          title="Diligence"
          eyebrow={`${deal.name} · ${deal.sector} · $${deal.amt}M`}
        />

        {/* deal switcher */}
        <div className="mb-3.5 flex flex-wrap gap-2">
          {DD_DEAL_META.map((d) => {
            const on = d.id === dealId;
            const cl = dealReadiness(agentsByDeal[d.id]).cleared;
            return (
              <button
                key={d.id}
                type="button"
                aria-pressed={on}
                onClick={() => {
                  setDealId(d.id);
                  setOpenAgentId(null);
                }}
                className={cn(
                  'flex items-center gap-2.5 rounded-[11px] border px-3.5 py-2.5 text-left transition',
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
                <div>
                  <div
                    className={cn('text-[12.5px] font-semibold', on ? 'text-fg-1' : 'text-fg-2')}
                  >
                    {d.label}
                  </div>
                  <div className="text-[10px] text-fg-5">
                    {d.sub} · {cl}/{DD_AGENTS.length} clear
                  </div>
                </div>
              </button>
            );
          })}
        </div>

        {/* verdict + readiness */}
        <div className="mb-3.5 flex flex-wrap gap-3">
          <Card
            className="flex-[2_1_280px] p-4"
            style={{ borderLeft: `3px solid ${TONE_COLOR[verdict.tone]}` }}
          >
            <div className="mb-2.5 flex flex-wrap items-center gap-2.5">
              <Badge tone={verdict.tone} dot>
                {verdict.label}
              </Badge>
              <span className="text-[11.5px] text-fg-4">{verdict.note}</span>
            </div>
            <div className="mb-1.5 flex items-baseline justify-between">
              <span className="text-[11.5px] text-fg-3">
                <b className="text-fg-1">
                  {readiness.cleared}/{readiness.total}
                </b>{' '}
                workstreams clear · {readiness.totalChecks} checks run
              </span>
              <span className="text-[11px] text-fg-4">
                avg confidence <b className="text-gold-1">{readiness.avgConfidence}%</b>
              </span>
            </div>
            <ProgressBar
              value={readiness.pct}
              gradient="linear-gradient(90deg,#1F8A5B,#2fae74)"
              height={7}
              ariaLabel="Workstreams cleared"
            />
          </Card>
          <div className="flex flex-col justify-center gap-2">
            <Button
              variant={ready ? 'gold' : 'secondary'}
              size="sm"
              icon={ready ? CircleCheckBig : Gauge}
              disabled={!ready}
            >
              {ready ? 'Send to IC' : `${register.length} open`}
            </Button>
            <Button variant="ghost" size="sm" icon={FileText}>
              Export memo
            </Button>
          </div>
        </div>

        {/* risk register */}
        {register.length > 0 && (
          <Card className="mb-3.5 p-3.5">
            <Eyebrow className="mb-2.5 flex items-center gap-1.5">
              <AlertTriangle size={12} className="text-warning" aria-hidden />
              Risk register · {register.length} open
            </Eyebrow>
            <div className="flex flex-col gap-1.5">
              {register.map((r) => (
                <button
                  key={r.agentId}
                  type="button"
                  onClick={() => setOpenAgentId(r.agentId)}
                  className="flex items-center gap-2.5 rounded-[9px] border border-hairline bg-surface-2 px-2.5 py-2 text-left hover:bg-surface-3"
                >
                  <span
                    className="flex-none rounded-[5px] px-1.5 py-0.5 text-[9px] font-bold uppercase tracking-[0.04em] text-white"
                    style={{ background: TONE_COLOR[DD_SEV_TONE[r.severity]] }}
                  >
                    {r.severity}
                  </span>
                  <span className="min-w-0 flex-1 truncate text-[12px] font-medium text-fg-1">
                    {r.headline}
                  </span>
                  <span className="flex-none text-[10.5px] text-fg-5">{r.name}</span>
                  <ChevronRight size={14} className="flex-none text-fg-5" aria-hidden />
                </button>
              ))}
            </div>
          </Card>
        )}

        {/* agent grid */}
        <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
          {DD_AGENTS.map((a) => {
            const st = agents[a.id];
            const meta = DD_STATUS[st.status];
            return (
              <button
                key={a.id}
                type="button"
                onClick={() => setOpenAgentId(a.id)}
                className="flex flex-col rounded-[12px] border border-hairline bg-surface-1 p-3.5 text-left transition hover:bg-surface-2"
                style={{ borderLeft: `2px solid ${TONE_COLOR[meta.tone]}` }}
              >
                <div className="flex items-center gap-2.5">
                  <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg border border-hairline bg-surface-2 text-fg-3">
                    {createElement(icon(a.icon), { size: 15, 'aria-hidden': true })}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-fg-1">{a.name}</div>
                    <div className="text-[10px] text-fg-5">
                      {a.who} · {st.checks} checks
                    </div>
                  </div>
                  <span
                    className="inline-flex flex-none items-center gap-1 text-[9.5px] font-semibold"
                    style={{ color: TONE_COLOR[meta.tone] }}
                  >
                    {createElement(icon(meta.icon), {
                      size: 11,
                      className: st.status === 'pending' ? 'motion-safe:animate-spin' : undefined,
                      'aria-hidden': true
                    })}
                    {meta.label}
                  </span>
                </div>
                <div className="mt-2.5 line-clamp-2 text-[11px] leading-snug text-fg-4">
                  {st.headline}
                </div>
                <div className="mt-2.5 flex items-center gap-2">
                  <div className="h-1 flex-1 overflow-hidden rounded-full bg-surface-3">
                    <div
                      className="h-full rounded-full"
                      style={{
                        width: `${st.confidence}%`,
                        background: TONE_COLOR[meta.tone]
                      }}
                    />
                  </div>
                  <span className="flex-none text-[10px] tabular-nums text-fg-5">
                    {st.confidence}%
                  </span>
                  {st.severity && st.status !== 'clear' && (
                    <span
                      className="flex-none rounded-[4px] px-1.5 py-px text-[8.5px] font-bold uppercase text-white"
                      style={{ background: TONE_COLOR[DD_SEV_TONE[st.severity]] }}
                    >
                      {st.severity}
                    </span>
                  )}
                </div>
              </button>
            );
          })}
        </div>

        {/* Earn footer */}
        <Card
          className="mt-3.5 flex items-center gap-2.5 p-3.5"
          style={{
            background: 'var(--gold-soft)',
            borderColor: 'var(--gold-line)'
          }}
        >
          <EarnCoin size={24} />
          <div className="flex-1 text-[12px] leading-snug text-fg-2">
            <b className="text-gold-1">Earn:</b>{' '}
            {register.length
              ? `${verdict.label} — ${register.length} of ${readiness.total} workstreams need your call. Open the risk register and I'll resolve each with you.`
              : `All ${readiness.total} workstreams clear at ${readiness.avgConfidence}% avg confidence. This deal is IC-ready.`}
          </div>
        </Card>
      </Card>

      {openAgentMeta && (
        <AgentDrawer
          agent={openAgentMeta}
          state={agents[openAgentMeta.id]}
          dealName={deal.name}
          onResolve={resolve}
          onClose={() => setOpenAgentId(null)}
        />
      )}
    </div>
  );
}
