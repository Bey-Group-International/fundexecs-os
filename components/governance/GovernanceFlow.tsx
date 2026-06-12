'use client';

import { createElement, useEffect, useState, type ReactNode } from 'react';
import { useReducedMotion } from 'motion/react';
import {
  ArrowLeft,
  Banknote,
  BookOpen,
  Building2,
  Check,
  Eye,
  GitFork,
  Gavel,
  Hand,
  Hourglass,
  Landmark,
  Lightbulb,
  Loader2,
  Lock,
  Network,
  PieChart,
  Plus,
  Scale,
  ShieldCheck,
  Sparkles,
  Target,
  TriangleAlert,
  UserCheck,
  UserPlus,
  Users,
  type LucideIcon
} from 'lucide-react';
import { Avatar, type AvatarTone } from '@/components/ui/Avatar';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { ProgressBar } from '@/components/ui/ProgressBar';
import { SegTabs } from '@/components/ui/Tabs';
import { ActionRunner } from '@/components/earn/ActionRunner';
import { adoptGovernancePolicy, saveGovernanceBody } from '@/lib/governance/actions';
import {
  ADV_0,
  ADV_CANDIDATES,
  CAP_0,
  CAP_CANDIDATES,
  FM_0,
  FM_CANDIDATES,
  GOV_POLICIES,
  IC_CANDIDATES,
  IC_MEMBERS_0,
  LEGAL_0,
  LEGAL_CANDIDATES,
  LPAC_0,
  POL_STAGES,
  POL_TONE,
  bodyRunCopy,
  policyDefaults,
  policyRows,
  policyStage,
  type AddableBodyKind,
  type GovCandidate,
  type GovMember,
  type GovPolicy,
  type PolicyValue
} from '@/lib/governance/config';
import type { GovBodyKind } from '@/lib/governance/persistence';
import { cn } from '@/lib/utils';

/* ── tone + icon helpers ─────────────────────────────────────────────────── */
const TONE: Record<string, { bg: string; color: string; line: string }> = {
  azure: { bg: 'var(--accent-soft)', color: 'var(--accent)', line: 'var(--accent-line)' },
  gold: { bg: 'var(--gold-soft)', color: 'var(--gold-1)', line: 'var(--gold-line)' },
  success: { bg: 'var(--success-soft)', color: 'var(--success)', line: 'var(--success-line)' },
  info: { bg: 'var(--accent-soft)', color: 'var(--accent)', line: 'var(--accent-line)' }
};

const POLICY_ICONS: Record<string, LucideIcon> = {
  scale: Scale,
  'git-fork': GitFork,
  'pie-chart': PieChart,
  'shield-check': ShieldCheck,
  'book-open': BookOpen,
  lock: Lock
};
function policyIcon(name: string): LucideIcon {
  return POLICY_ICONS[name] ?? Scale;
}

/** The selectable chip primitive shared by the governance builders. */
function GovChip({
  label,
  selected,
  onClick
}: {
  label: string;
  selected: boolean;
  onClick: () => void;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={selected}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-[12.5px] font-medium transition',
        selected
          ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-fg-1'
          : 'border-hairline bg-surface-1 text-fg-3 hover:bg-surface-2'
      )}
    >
      {selected && <Check size={12} strokeWidth={2.4} aria-hidden />}
      {label}
    </button>
  );
}

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
  icon,
  title,
  eyebrow,
  action
}: {
  icon: LucideIcon;
  title: string;
  eyebrow: string;
  action?: ReactNode;
}) {
  return (
    <div className="mb-3 flex items-start justify-between gap-3">
      <div className="flex items-center gap-2.5">
        <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border border-hairline bg-surface-2 text-fg-3">
          {createElement(icon, { size: 16, strokeWidth: 1.9, 'aria-hidden': true })}
        </span>
        <div>
          <Eyebrow className="mb-px">{eyebrow}</Eyebrow>
          <div className="text-[14.5px] font-semibold tracking-[-0.01em] text-fg-1">{title}</div>
        </div>
      </div>
      {action}
    </div>
  );
}

/* ── a governance-body roster ────────────────────────────────────────────── */

function RosterPanel({
  icon,
  title,
  eyebrow,
  members,
  variant,
  entityIcon,
  memberTone = 'azure',
  entityTone = 'gold',
  principal,
  bench,
  onAddCandidate,
  addLabel,
  setLabel,
  stats
}: {
  icon: LucideIcon;
  title: string;
  eyebrow: string;
  members: GovMember[];
  variant: 'people' | 'entity';
  entityIcon?: LucideIcon;
  /** Tone for non-you member avatars (the prototype: advisors read info). */
  memberTone?: AvatarTone;
  /** Tone for the entity icon square (the prototype: counsel reads info). */
  entityTone?: 'gold' | 'info';
  principal: string;
  /** Remaining candidate suggestions — rendered only while a seat is open. */
  bench: GovCandidate[];
  onAddCandidate: (cand: GovCandidate) => void;
  addLabel?: string;
  setLabel: string;
  stats: [string, string][];
}) {
  const openCount = members.filter((m) => m.open).length;
  return (
    <Card className="p-[18px]">
      <PanelHeader
        icon={icon}
        title={title}
        eyebrow={eyebrow}
        action={
          openCount > 0 ? (
            <Badge tone="neutral" className="text-[9.5px]">
              {openCount} open
            </Badge>
          ) : (
            <Badge tone="success" className="text-[9.5px]">
              {setLabel}
            </Badge>
          )
        }
      />
      <div className="flex flex-col gap-1.5">
        {members.map((m) => {
          const name = m.you ? principal : m.name || 'Open seat';
          return (
            <div
              key={m.id}
              className={cn(
                'flex items-center gap-2.5 rounded-[12px] px-3 py-2.5',
                m.open
                  ? 'border border-dashed border-[var(--border-strong)]'
                  : 'border border-hairline bg-surface-1'
              )}
            >
              {m.open ? (
                <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full border border-dashed border-[var(--border-strong)] text-fg-5">
                  <Plus size={15} aria-hidden />
                </span>
              ) : variant === 'entity' ? (
                <span
                  className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-[9px] border"
                  style={{
                    background: TONE[entityTone].bg,
                    color: TONE[entityTone].color,
                    borderColor: TONE[entityTone].line
                  }}
                >
                  {createElement(entityIcon ?? Banknote, {
                    size: 15,
                    strokeWidth: 1.9,
                    'aria-hidden': true
                  })}
                </span>
              ) : (
                <Avatar name={name} size={30} tone={m.you ? 'gold' : memberTone} />
              )}
              <div className="min-w-0 flex-1">
                <div
                  className={cn('text-[12.5px] font-semibold', m.open ? 'text-fg-4' : 'text-fg-1')}
                >
                  {name}
                </div>
                <div className="text-[10.5px] text-fg-5">
                  {m.role}
                  {m.note ? ` · ${m.note}` : ''}
                </div>
              </div>
              {m.carry && (
                <span className="font-mono text-[12px] font-semibold text-gold-1">{m.carry}</span>
              )}
              {m.you && (
                <Badge tone="gold" className="text-[9.5px]">
                  You
                </Badge>
              )}
            </div>
          );
        })}
      </div>
      {openCount > 0 && bench.length > 0 && (
        <div className="mt-3 border-t border-[var(--border-faint)] pt-3">
          <Eyebrow className="mb-2">
            Earn&apos;s bench · suggestions
            <span className="font-normal normal-case tracking-normal text-fg-5">
              {' '}
              — nothing is added until you confirm
            </span>
          </Eyebrow>
          <div className="flex flex-col gap-1.5">
            {bench.map((c) => (
              <button
                key={c.name}
                type="button"
                onClick={() => onAddCandidate(c)}
                className="group flex w-full items-center gap-2.5 rounded-[12px] border border-dashed border-hairline px-3 py-2 text-left transition hover:border-[var(--accent-line)] hover:bg-[var(--accent-soft)]"
              >
                {variant === 'entity' ? (
                  <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-[8px] border border-hairline bg-surface-2 text-fg-4">
                    {createElement(entityIcon ?? Banknote, {
                      size: 13,
                      strokeWidth: 1.9,
                      'aria-hidden': true
                    })}
                  </span>
                ) : (
                  <Avatar name={c.name} size={26} tone={memberTone} />
                )}
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[12px] font-semibold text-fg-2">{c.name}</div>
                  <div className="truncate text-[10.5px] text-fg-5">
                    {c.role} · {c.note}
                  </div>
                </div>
                {c.carry && (
                  <span className="font-mono text-[11px] font-semibold text-gold-1">{c.carry}</span>
                )}
                <span className="flex flex-none items-center gap-1 text-[11px] font-medium text-fg-4 transition group-hover:text-[var(--accent)]">
                  <UserPlus size={13} aria-hidden />
                  {addLabel ?? 'Add'}
                </span>
              </button>
            ))}
          </div>
        </div>
      )}
      {stats.length > 0 && (
        <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-fg-4">
          {stats.map(([b, rest]) => (
            <span key={b}>
              <span className="font-semibold text-fg-2">{b}</span> {rest}
            </span>
          ))}
        </div>
      )}
    </Card>
  );
}

/* ── the copiloted policy builder ────────────────────────────────────────── */

function PolicyBuilder({
  pol,
  initial,
  alreadyAdopted,
  startDrafted,
  onBack,
  onAdopted,
  onDrafted
}: {
  pol: GovPolicy;
  /** Persisted decisions when re-opening an adopted policy, or the in-flight draft. */
  initial: Record<string, PolicyValue> | null;
  alreadyAdopted: boolean;
  /** Resume a drafted-but-not-adopted policy at its preview. */
  startDrafted: boolean;
  onBack: () => void;
  onAdopted: (id: string, decisions: Record<string, PolicyValue>) => void;
  onDrafted: (id: string, decisions: Record<string, PolicyValue>) => void;
}) {
  const reduced = useReducedMotion() ?? false;
  const [d, setD] = useState<Record<string, PolicyValue>>(() => initial ?? policyDefaults(pol));
  const [applied, setApplied] = useState(false);
  const [phase, setPhase] = useState<'edit' | 'building' | 'done'>(
    alreadyAdopted || startDrafted ? 'done' : 'edit'
  );
  const [n, setN] = useState(0);
  const [adopting, setAdopting] = useState(false);
  const [adoptError, setAdoptError] = useState<string | null>(null);
  const steps = [
    'Pull your fund context',
    `Draft the ${pol.name.toLowerCase()}`,
    'Check against the institutional standard',
    'Prepare for adoption'
  ];

  const set = (k: string, v: PolicyValue) => setD((p) => ({ ...p, [k]: v }));
  const toggle = (k: string, v: string) =>
    setD((p) => {
      const c = (p[k] as string[]) ?? [];
      return { ...p, [k]: c.includes(v) ? c.filter((x) => x !== v) : [...c, v] };
    });

  useEffect(() => {
    if (phase !== 'building') return;
    if (reduced) {
      const t = setTimeout(() => setPhase('done'), 300);
      return () => clearTimeout(t);
    }
    let i = 0;
    const timer = setInterval(() => {
      i += 1;
      setN(i);
      if (i >= steps.length) {
        clearInterval(timer);
        setTimeout(() => setPhase('done'), 400);
      }
    }, 560);
    return () => clearInterval(timer);
  }, [phase, reduced, steps.length]);

  async function adopt() {
    setAdopting(true);
    setAdoptError(null);
    try {
      const res = await adoptGovernancePolicy(pol.id, d);
      if (res.ok) {
        onAdopted(pol.id, d);
      } else {
        setAdoptError(res.error);
      }
    } catch {
      setAdoptError('Could not adopt — check your connection and try again.');
    } finally {
      setAdopting(false);
    }
  }

  if (phase === 'done') {
    return (
      <div className="mx-auto flex w-full max-w-[540px] flex-col items-center py-5">
        <span className="mb-3 flex h-[54px] w-[54px] items-center justify-center rounded-full border border-[var(--success-line)] bg-[var(--success-soft)] text-success">
          <Check size={26} strokeWidth={2.2} aria-hidden />
        </span>
        <h2 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
          {pol.name} — {alreadyAdopted ? 'active' : 'drafted'}
        </h2>
        <p className="mt-1.5 text-center text-[12.5px] text-fg-3">
          {alreadyAdopted
            ? 'Adopted and active across the firm. Edit and re-adopt anytime.'
            : 'Drafted to the institutional standard — adopt to make it active across the firm.'}
        </p>
        <div className="mt-4 w-full overflow-hidden rounded-[13px] border border-hairline">
          {policyRows(pol, d).map(([k, v], i) => (
            <div
              key={k}
              className={cn(
                'flex gap-3.5 px-[15px] py-2.5',
                i % 2 === 0 ? 'bg-surface-1' : 'bg-transparent',
                i > 0 && 'border-t border-[var(--border-faint)]'
              )}
            >
              <span className="w-[130px] flex-none text-[12px] text-fg-4">{k}</span>
              <span className="text-[13px] font-medium text-fg-1">{v}</span>
            </div>
          ))}
        </div>
        {adoptError && (
          <div className="mt-3 flex w-full items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger">
            <TriangleAlert size={15} aria-hidden />
            {adoptError}
          </div>
        )}
        <div className="mt-4 flex w-full flex-wrap items-center justify-between gap-2.5">
          <Button
            variant="ghost"
            icon={ArrowLeft}
            onClick={() => {
              setPhase('edit');
              setN(0);
            }}
          >
            Go back &amp; edit
          </Button>
          {alreadyAdopted ? (
            <Button variant="outline" iconRight={Check} onClick={onBack}>
              Close
            </Button>
          ) : (
            <Button
              variant="gold"
              icon={adopting ? Loader2 : undefined}
              iconRight={adopting ? undefined : Check}
              disabled={adopting}
              onClick={() => void adopt()}
            >
              {adopting ? 'Adopting…' : 'Adopt & finish'}
            </Button>
          )}
        </div>
      </div>
    );
  }

  if (phase === 'building') {
    const pct = Math.round((n / steps.length) * 100);
    return (
      <div className="mx-auto flex w-full max-w-[520px] flex-col items-center py-6">
        <div className="mb-4 flex flex-col items-center text-center">
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
          <h2 className="text-[18px] font-semibold tracking-[-0.015em] text-fg-1">
            Drafting {pol.name}…
          </h2>
        </div>
        <ProgressBar value={pct} height={6} label="Drafting progress" className="w-full" />
        <Card className="mt-3.5 flex w-full flex-col gap-0.5 p-3">
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
                <span className={cn('text-[13px]', i < n ? 'text-fg-2' : 'text-fg-1')}>{s}</span>
              </div>
            ) : null
          )}
        </Card>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      <div className="flex items-center gap-3">
        <Button variant="outline" size="sm" icon={ArrowLeft} onClick={onBack}>
          Policies
        </Button>
        <div className="min-w-0 flex-1">
          <h1 className="text-[18px] font-semibold tracking-[-0.015em] text-fg-1">{pol.name}</h1>
          <p className="text-[12px] text-fg-4">You set the standard, Earn drafts it</p>
        </div>
        <Badge tone="azure" dot>
          Copiloted
        </Badge>
      </div>
      <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[minmax(0,1fr)_300px]">
        <Card className="p-6">
          <p className="mb-4 text-[12.5px] leading-relaxed text-fg-4">{pol.intro}</p>
          <div className="flex flex-col gap-5">
            {pol.decisions.map((dec) => (
              <div key={dec.key}>
                <Eyebrow className="mb-2">
                  {dec.label}
                  {dec.kind === 'multi' && (
                    <span className="font-normal normal-case tracking-normal text-fg-5">
                      {' '}
                      · pick any
                    </span>
                  )}
                </Eyebrow>
                <div className="flex flex-wrap gap-2">
                  {dec.opts.map((o) => (
                    <GovChip
                      key={o}
                      label={o}
                      selected={
                        dec.kind === 'multi'
                          ? ((d[dec.key] as string[]) ?? []).includes(o)
                          : d[dec.key] === o
                      }
                      onClick={() => (dec.kind === 'multi' ? toggle(dec.key, o) : set(dec.key, o))}
                    />
                  ))}
                </div>
              </div>
            ))}
          </div>
          <div className="mt-6 flex flex-wrap items-center justify-between gap-2.5">
            <Button variant="ghost" icon={ArrowLeft} onClick={onBack}>
              Cancel
            </Button>
            <Button
              variant="gold"
              iconRight={Sparkles}
              onClick={() => {
                onDrafted(pol.id, d);
                setN(0);
                setPhase('building');
              }}
            >
              Draft &amp; adopt
            </Button>
          </div>
        </Card>
        <Card className="self-start p-[17px]">
          <div className="mb-3 flex items-center gap-2.5">
            <EarnCoin size={32} online className="flex-none" />
            <div>
              <div className="text-[13px] font-semibold text-fg-1">Earn</div>
              <div className="text-[10.5px] text-fg-4">Compliance copilot</div>
            </div>
          </div>
          <Eyebrow className="mb-1.5 text-gold-1">Earn recommends</Eyebrow>
          <p className="text-[12.5px] leading-relaxed text-fg-2">{pol.recText}</p>
          <Button
            variant={applied ? 'secondary' : 'gold'}
            size="sm"
            icon={applied ? Check : Sparkles}
            className="mt-3.5 w-full"
            onClick={() => {
              setD(policyDefaults(pol));
              setApplied(true);
            }}
          >
            {applied ? 'Recommendation applied' : "Apply Earn's recommendation"}
          </Button>
          <p className="mt-3 flex items-center gap-1.5 text-[11px] text-fg-5">
            <Hand size={12} aria-hidden />
            You&apos;re in control — change anything.
          </p>
        </Card>
      </div>
    </div>
  );
}

/* ── the governance hub ──────────────────────────────────────────────────── */

type Tab = 'structure' | 'bodies' | 'policies';

export interface GovernanceFlowProps {
  firm: string;
  principal: string;
  /** Structure labels personalized from the persisted formation document. */
  structure: { entity: string; gp: string; mgmtco: string };
  /** Persisted state from `getGovernanceHubState`. */
  initialAdopted: Record<string, Record<string, PolicyValue>>;
  initialBodies: Partial<Record<GovBodyKind, GovMember[]>>;
}

/**
 * A governance-body roster fed from the candidate bench. The bench is never
 * persisted — `confirm` runs the real write (the ActionRunner's approve
 * moment) and `apply` settles the optimistic state only after that write
 * succeeds.
 */
function useRoster(
  kind: GovBodyKind,
  initial: readonly GovMember[],
  candidates: readonly GovCandidate[],
  persisted: GovMember[] | undefined
) {
  const [members, setMembers] = useState<GovMember[]>(persisted ?? [...initial]);
  const bench = candidates.filter((c) => !members.some((m) => m.name === c.name));
  const nextWith = (cand: GovCandidate): GovMember[] | null => {
    const at = members.findIndex((m) => m.open);
    if (at < 0) return null;
    const next = [...members];
    next[at] = {
      id: `${next[at].id}-${cand.name.toLowerCase().replace(/[^a-z0-9]+/g, '-')}`,
      name: cand.name,
      role: cand.role,
      note: cand.note,
      carry: cand.carry
    };
    return next;
  };
  const confirm = async (cand: GovCandidate) => {
    const next = nextWith(cand);
    if (!next) return { ok: false as const, error: 'No open seat left on this body.' };
    return saveGovernanceBody(kind, next);
  };
  const apply = (cand: GovCandidate) => {
    const next = nextWith(cand);
    if (next) setMembers(next);
  };
  return { members, bench, confirm, apply };
}

export function GovernanceFlow({
  firm,
  principal,
  structure,
  initialAdopted,
  initialBodies
}: GovernanceFlowProps) {
  const [view, setView] = useState<Tab>('structure');
  const [openPol, setOpenPol] = useState<string | null>(null);
  const [adopted, setAdopted] =
    useState<Record<string, Record<string, PolicyValue>>>(initialAdopted);
  /** Drafted-but-not-adopted decisions, per policy — the grid's Drafting stage. */
  const [drafts, setDrafts] = useState<Record<string, Record<string, PolicyValue>>>({});
  /** A bench candidate awaiting the operator's approve moment. */
  const [pendingAdd, setPendingAdd] = useState<{
    kind: AddableBodyKind;
    cand: GovCandidate;
  } | null>(null);

  const fm = useRoster('fund_mgmt', FM_0, FM_CANDIDATES, initialBodies.fund_mgmt);
  const ic = useRoster('ic', IC_MEMBERS_0, IC_CANDIDATES, initialBodies.ic);
  const adv = useRoster('advisory', ADV_0, ADV_CANDIDATES, initialBodies.advisory);
  const cap = useRoster('capital_partners', CAP_0, CAP_CANDIDATES, initialBodies.capital_partners);
  const legal = useRoster('legal_counsel', LEGAL_0, LEGAL_CANDIDATES, initialBodies.legal_counsel);
  const rosters: Record<AddableBodyKind, ReturnType<typeof useRoster>> = {
    fund_mgmt: fm,
    ic,
    advisory: adv,
    capital_partners: cap,
    legal_counsel: legal
  };

  if (openPol) {
    const pol = GOV_POLICIES.find((p) => p.id === openPol);
    if (pol) {
      const existing = adopted[pol.id] ?? null;
      const draft = drafts[pol.id] ?? null;
      return (
        <PolicyBuilder
          key={openPol}
          pol={pol}
          initial={existing ?? draft}
          alreadyAdopted={existing != null}
          startDrafted={existing == null && draft != null}
          onBack={() => setOpenPol(null)}
          onDrafted={(id, decisions) => {
            setDrafts((prev) => ({ ...prev, [id]: decisions }));
          }}
          onAdopted={(id, decisions) => {
            setAdopted((prev) => ({ ...prev, [id]: decisions }));
            setDrafts((prev) => {
              const { [id]: _done, ...rest } = prev;
              return rest;
            });
            setOpenPol(null);
          }}
        />
      );
    }
  }

  const adoptedCount = Object.keys(adopted).length;
  const structureNodes = [
    { label: 'Limited Partners', sub: 'Commit capital', icon: Users, tone: 'azure' },
    { label: `${firm} Fund I, LP`, sub: structure.entity, icon: Landmark, tone: 'gold' },
    {
      label: structure.gp,
      sub: 'General Partner · controls the fund',
      icon: ShieldCheck,
      tone: 'success'
    },
    {
      label: structure.mgmtco,
      sub: 'Management company · runs operations',
      icon: Building2,
      tone: 'info'
    }
  ];

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <GitFork size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">
              Structure &amp; governance
            </h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              The institutional spine LPs diligence — structure, committees and policies.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">
              {adoptedCount}/{GOV_POLICIES.length}
            </div>
            <div className="text-[10.5px] text-fg-5">policies active</div>
          </div>
          <Badge tone="warning" className="ml-1 self-start text-[10px]">
            Illustrative
          </Badge>
        </div>
        <ProgressBar
          value={Math.round((adoptedCount / GOV_POLICIES.length) * 100)}
          height={6}
          label="Policies adopted"
          className="mt-3.5"
        />
      </Card>

      <SegTabs
        active={view}
        onChange={(id) => setView(id as Tab)}
        tabs={[
          { id: 'structure', label: 'Structure', icon: Network },
          { id: 'bodies', label: 'Governance bodies', icon: Users },
          { id: 'policies', label: 'Policies', icon: Scale }
        ]}
      />

      {view === 'structure' && (
        <div className="flex flex-col gap-4">
          <Card className="p-[18px]">
            <PanelHeader
              icon={Network}
              title="Fund structure"
              eyebrow="The legal stack · from your formation"
            />
            <div className="flex flex-col items-center">
              {structureNodes.map((node, i) => {
                const t = TONE[node.tone];
                return (
                  <div key={node.label} className="flex w-full max-w-[460px] flex-col items-center">
                    {i > 0 && <div className="h-4 w-0.5 bg-[var(--border-strong)]" />}
                    <div className="flex w-full items-center gap-3 rounded-[12px] border border-hairline bg-surface-1 px-[15px] py-3">
                      <span
                        className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] border"
                        style={{ background: t.bg, color: t.color, borderColor: t.line }}
                      >
                        {createElement(node.icon, {
                          size: 17,
                          strokeWidth: 1.9,
                          'aria-hidden': true
                        })}
                      </span>
                      <div className="min-w-0">
                        <div className="truncate text-[13px] font-semibold text-fg-1">
                          {node.label}
                        </div>
                        <div className="text-[11px] text-fg-5">{node.sub}</div>
                      </div>
                    </div>
                  </div>
                );
              })}
            </div>
          </Card>

          <Card className="p-[18px]">
            <PanelHeader icon={UserCheck} title="Key persons" eyebrow="Who runs the firm" />
            <div className="flex flex-col gap-1.5">
              {[
                { name: principal, role: 'Managing Partner · key person', you: true },
                { name: 'Fractional CFO', role: 'Finance & operations', you: false },
                { name: 'Fund administrator', role: 'Apex Fund Admin · outsourced', you: false }
              ].map((p) => (
                <div
                  key={p.name}
                  className="flex items-center gap-2.5 rounded-[12px] border border-hairline bg-surface-1 px-3 py-2.5"
                >
                  <Avatar name={p.name} size={30} tone={(p.you ? 'gold' : 'azure') as AvatarTone} />
                  <div className="min-w-0 flex-1">
                    <div className="text-[12.5px] font-semibold text-fg-1">{p.name}</div>
                    <div className="text-[10.5px] text-fg-5">{p.role}</div>
                  </div>
                  <Badge tone={p.you ? 'gold' : 'neutral'} className="text-[9.5px]">
                    {p.you ? 'You' : 'Suggested'}
                  </Badge>
                </div>
              ))}
            </div>
          </Card>

          <Card className="p-[18px]">
            <PanelHeader
              icon={Target}
              title="100 / 30 / 10 Governance Plan"
              eyebrow="Your operating cadence · set by Sterling"
            />
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-3">
              {(
                [
                  ['100', 'relationships mapped', 'azure'],
                  ['30', 'in active motion', 'gold'],
                  ['10', 'priority targets', 'success']
                ] as [string, string, string][]
              ).map(([num, label, tone]) => (
                <div
                  key={label}
                  className="rounded-[12px] border border-hairline bg-surface-1 p-3.5"
                >
                  <div
                    className="text-[26px] font-semibold tabular-nums"
                    style={{ color: TONE[tone].color }}
                  >
                    {num}
                  </div>
                  <div className="mt-1 text-[12px] text-fg-3">{label}</div>
                </div>
              ))}
            </div>
          </Card>
        </div>
      )}

      {view === 'bodies' && (
        <div className="flex flex-col gap-4">
          <RosterPanel
            icon={UserCheck}
            title="Fund management team"
            eyebrow="The GP partners running the fund · carry split"
            members={fm.members}
            variant="people"
            principal={principal}
            bench={fm.bench}
            onAddCandidate={(cand) => setPendingAdd({ kind: 'fund_mgmt', cand })}
            addLabel="Add partner"
            setLabel="Team set"
            stats={[
              ['Carry pool', '· 20% of profits'],
              ['Vesting', '· 4 yrs']
            ]}
          />
          <RosterPanel
            icon={Gavel}
            title="Investment Committee"
            eyebrow="Approves every deal · unanimous for new investments"
            members={ic.members}
            variant="people"
            principal={principal}
            bench={ic.bench}
            onAddCandidate={(cand) => setPendingAdd({ kind: 'ic', cand })}
            addLabel="Fill seat"
            setLabel="Quorum met"
            stats={[
              ['Quorum', '· majority'],
              ['New deals', '· unanimous'],
              ['Charter', '· drafted']
            ]}
          />
          <RosterPanel
            icon={Lightbulb}
            title="Advisory Board"
            eyebrow="External experts · strategy, deal flow & credibility"
            members={adv.members}
            variant="people"
            memberTone="info"
            principal={principal}
            bench={adv.bench}
            onAddCandidate={(cand) => setPendingAdd({ kind: 'advisory', cand })}
            addLabel="Add advisor"
            setLabel="Board seated"
            stats={[
              ['Role', '· advisory, non-voting'],
              ['Comp', '· advisory shares']
            ]}
          />
          <Card className="p-[18px]">
            <PanelHeader
              icon={Users}
              title="LP Advisory Committee (LPAC)"
              eyebrow="LP oversight · conflicts & valuation review"
            />
            <div className="flex items-center gap-2.5 rounded-[12px] border border-hairline bg-surface-1 px-3.5 py-3">
              <Hourglass size={17} className="text-fg-4" aria-hidden />
              <div className="min-w-0 flex-1 text-[12.5px] text-fg-3">
                {LPAC_0[0].name} — forms at your first close from your largest LPs. Earn drafts the
                LPAC charter and seats it automatically.
              </div>
              <Badge tone="neutral" className="text-[9.5px]">
                At first close
              </Badge>
            </div>
            <div className="mt-3 flex flex-wrap gap-x-4 gap-y-1 text-[11.5px] text-fg-4">
              <span>
                <span className="font-semibold text-fg-2">Reviews</span> · conflicts, valuation,
                extensions
              </span>
              <span>
                <span className="font-semibold text-fg-2">Seats</span> · top 3 LPs
              </span>
            </div>
          </Card>
          <RosterPanel
            icon={Banknote}
            title="Capital Partners"
            eyebrow="Your capital stack · facilities, lenders & co-investors"
            members={cap.members}
            variant="entity"
            entityIcon={Banknote}
            principal={principal}
            bench={cap.bench}
            onAddCandidate={(cand) => setPendingAdd({ kind: 'capital_partners', cand })}
            addLabel="Add partner"
            setLabel="Stack set"
            stats={[
              ['Use', '· bridge calls, leverage, co-invest'],
              ['Counsel', '· reviewed']
            ]}
          />
          <RosterPanel
            icon={Scale}
            title="Legal Counsel"
            eyebrow="Your counsel bench · formation, regulatory & tax"
            members={legal.members}
            variant="entity"
            entityIcon={Scale}
            entityTone="info"
            principal={principal}
            bench={legal.bench}
            onAddCandidate={(cand) => setPendingAdd({ kind: 'legal_counsel', cand })}
            addLabel="Add counsel"
            setLabel="Bench set"
            stats={[['Scope', '· formation, regulatory, tax, deals']]}
          />
        </div>
      )}

      {view === 'policies' && (
        <Card className="p-[18px]">
          <PanelHeader
            icon={Scale}
            title="Policies"
            eyebrow="Adopt the institutional baseline · copiloted by Adrian"
          />
          <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2">
            {GOV_POLICIES.map((p) => {
              const stage = policyStage(p.id in adopted, p.id in drafts);
              return (
                <div
                  key={p.id}
                  className="flex items-center gap-2.5 rounded-[12px] border border-hairline bg-surface-1 px-[13px] py-3"
                >
                  <span
                    className={cn(
                      'flex h-8 w-8 flex-none items-center justify-center rounded-[9px] border',
                      stage === 'active'
                        ? 'border-[var(--success-line)] bg-[var(--success-soft)] text-success'
                        : stage === 'drafting'
                          ? 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1'
                          : 'border-hairline bg-surface-2 text-fg-3'
                    )}
                  >
                    {createElement(stage === 'active' ? Check : policyIcon(p.icon), {
                      size: 16,
                      strokeWidth: 1.9,
                      'aria-hidden': true
                    })}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[12.5px] font-semibold text-fg-1">{p.name}</div>
                    <Badge tone={POL_TONE[stage]} className="mt-1 text-[9px]">
                      {POL_STAGES[stage]}
                    </Badge>
                  </div>
                  <Button
                    variant={
                      stage === 'active' ? 'ghost' : stage === 'drafting' ? 'gold' : 'secondary'
                    }
                    size="sm"
                    icon={stage === 'active' ? Eye : stage === 'drafting' ? Check : Sparkles}
                    onClick={() => setOpenPol(p.id)}
                  >
                    {stage === 'active' ? 'View' : stage === 'drafting' ? 'Adopt' : 'Draft'}
                  </Button>
                </div>
              );
            })}
          </div>
        </Card>
      )}

      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-[14px] px-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <span className="font-semibold text-gold-1">Earn:</span> Governance is what separates a
          fund from a deal. I draft every policy and charter to the institutional standard — you set
          the posture and adopt.
        </p>
      </Card>

      {pendingAdd &&
        (() => {
          const roster = rosters[pendingAdd.kind];
          const copy = bodyRunCopy(pendingAdd.kind, pendingAdd.cand);
          return (
            <ActionRunner
              title={copy.title}
              steps={copy.steps}
              draftTitle={copy.draftTitle}
              draft={copy.draft}
              onApprove={() => roster.confirm(pendingAdd.cand)}
              onApplied={() => roster.apply(pendingAdd.cand)}
              onClose={() => setPendingAdd(null)}
            />
          );
        })()}
    </div>
  );
}

export default GovernanceFlow;
