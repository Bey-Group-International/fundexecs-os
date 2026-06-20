import Link from "next/link";
import type { InvestorWarRoom as WarRoom } from "@/lib/source-war-room";
import { formatCompactCurrency } from "@/lib/source-war-room";
import type { Temperature, NextAction } from "@/lib/capital-map";
import type { GateTier } from "@/lib/gates";
import type { CapitalEventType, InvestorType } from "@/lib/supabase/database.types";

// --- Small primitives ------------------------------------------------------
// Thesis-fit ring — same SVG idiom as the Run-hub deal war room.
function Ring({ value, size = 72 }: { value: number; size?: number }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - value / 100);
  const tone = value >= 70 ? "text-emerald-400" : value >= 35 ? "text-gold-400" : "text-fg-muted";
  return (
    <svg viewBox={`0 0 ${size} ${size}`} style={{ width: size, height: size }} className="-rotate-90">
      <circle cx={size / 2} cy={size / 2} r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-line" />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        className={tone}
      />
    </svg>
  );
}

function SectionTitle({ children, action }: { children: React.ReactNode; action?: React.ReactNode }) {
  return (
    <div className="mb-3 flex items-center justify-between gap-3">
      <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-gold-400">{children}</h3>
      {action}
    </div>
  );
}

function humanize(value: string): string {
  return value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

// --- Theme maps ------------------------------------------------------------
const TEMP_META: Record<Temperature, { label: string; tone: string }> = {
  cold: { label: "Cold", tone: "border-line text-fg-muted" },
  warm: { label: "Warm", tone: "border-status-info/40 bg-status-info/10 text-status-info" },
  active: { label: "Active", tone: "border-gold-500/40 bg-gold-500/10 text-gold-300" },
  committed: { label: "Committed", tone: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
};

const TIER_META: Record<GateTier, { label: string; tone: string }> = {
  1: { label: "Internal", tone: "border-line text-fg-muted" },
  2: { label: "External", tone: "border-status-info/40 text-status-info" },
  3: { label: "Capital", tone: "border-status-danger/40 text-status-danger" },
};

// Distributions return capital to the LP; calls/contributions pull it in.
const EVENT_TONE: Record<CapitalEventType, string> = {
  capital_call: "text-status-danger",
  contribution: "text-status-danger",
  fee: "text-fg-muted",
  distribution: "text-emerald-300",
  return_of_capital: "text-emerald-300",
  carry: "text-gold-300",
};

const INFLOW_EVENTS = new Set<CapitalEventType>(["distribution", "return_of_capital", "carry"]);

// --- Sections --------------------------------------------------------------
function Header({ data }: { data: WarRoom }) {
  const { investor, temperature, thesisFit } = data;
  const fit = thesisFit?.score ?? 0;
  const temp = TEMP_META[temperature];
  return (
    <div className="rounded-2xl border border-line bg-gradient-to-b from-surface-1 to-surface-1/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-4 sm:gap-5">
        <div className="relative shrink-0">
          <Ring value={fit} />
          <span className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="font-display text-base font-semibold leading-none text-fg-primary">{fit}</span>
            <span className="mt-0.5 font-mono text-[8px] uppercase tracking-wider text-fg-muted">fit</span>
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-words font-display text-2xl font-semibold tracking-tight text-fg-primary">{investor.name}</h1>
            <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${temp.tone}`}>
              {temp.label}
            </span>
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              {humanize(investor.investor_type as InvestorType)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-secondary">
            {investor.jurisdiction ? <span>{investor.jurisdiction}</span> : null}
            <span className="font-mono uppercase tracking-wider text-fg-muted">
              Stage: <span className="text-fg-secondary">{humanize(investor.pipeline_stage)}</span>
            </span>
            {investor.aum != null ? (
              <span className="font-mono text-fg-primary">{formatCompactCurrency(investor.aum)} AUM</span>
            ) : null}
            {investor.typical_check_min != null || investor.typical_check_max != null ? (
              <span className="font-mono text-fg-secondary">
                {formatCompactCurrency(investor.typical_check_min)}–{formatCompactCurrency(investor.typical_check_max)} check
              </span>
            ) : null}
          </div>
          {investor.contact_name || investor.contact_email ? (
            <p className="mt-1.5 text-sm text-fg-muted">
              {investor.contact_name}
              {investor.contact_name && investor.contact_email ? " · " : ""}
              {investor.contact_email ? (
                <a className="text-gold-300 hover:underline" href={`mailto:${investor.contact_email}`}>
                  {investor.contact_email}
                </a>
              ) : null}
            </p>
          ) : null}
          {thesisFit?.reasons.length ? (
            <ul className="mt-2 flex flex-wrap gap-1.5">
              {thesisFit.reasons.map((reason) => (
                <li
                  key={reason}
                  className="rounded-full border border-line/70 bg-surface-0 px-2 py-0.5 text-[11px] text-fg-secondary"
                >
                  {reason}
                </li>
              ))}
            </ul>
          ) : null}
        </div>
      </div>
    </div>
  );
}

function StatCell({ label, value, tone }: { label: string; value: string; tone?: string }) {
  return (
    <div className="rounded-lg border border-line/60 bg-surface-0 px-3 py-2">
      <p className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</p>
      <p className={`mt-0.5 font-display text-lg font-semibold ${tone ?? "text-fg-primary"}`}>{value}</p>
    </div>
  );
}

function Commitments({ data }: { data: WarRoom }) {
  const { commitments, committedTotal, calledTotal, distributedTotal } = data;
  const uncalled = committedTotal - calledTotal;
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <SectionTitle
        action={
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {commitments.length} {commitments.length === 1 ? "fund" : "funds"}
          </span>
        }
      >
        Commitments
      </SectionTitle>
      <div className="mb-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCell label="Committed" value={formatCompactCurrency(committedTotal)} />
        <StatCell label="Called" value={formatCompactCurrency(calledTotal)} />
        <StatCell label="Distributed" value={formatCompactCurrency(distributedTotal)} tone="text-emerald-300" />
        <StatCell label="Uncalled" value={formatCompactCurrency(uncalled)} tone="text-fg-secondary" />
      </div>
      {commitments.length ? (
        <div className="divide-y divide-line/50 overflow-hidden rounded-lg border border-line/60">
          {commitments.map(({ commitment, fund }) => (
            <div key={commitment.id} className="flex flex-wrap items-center justify-between gap-2 px-3 py-2.5 text-sm">
              <span className="min-w-0 flex-1">
                <span className="text-fg-primary">{fund?.name ?? "Unassigned fund"}</span>
                {commitment.committed_at ? (
                  <span className="ml-2 font-mono text-[10px] text-fg-muted">
                    {new Date(commitment.committed_at).toLocaleDateString()}
                  </span>
                ) : null}
              </span>
              <span className="font-mono text-fg-secondary">
                <span className="text-fg-primary">{formatCompactCurrency(commitment.committed_amount)}</span>
                {" committed · "}
                {formatCompactCurrency(commitment.called_amount)} called ·{" "}
                <span className="text-emerald-300">{formatCompactCurrency(commitment.distributed_amount)} dist.</span>
              </span>
            </div>
          ))}
        </div>
      ) : (
        <p className="text-sm text-fg-muted">No commitments yet — this LP is still in the pipeline.</p>
      )}
    </div>
  );
}

function CapitalFlows({ data }: { data: WarRoom }) {
  const { capitalEvents } = data;
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <SectionTitle
        action={
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">{capitalEvents.length} events</span>
        }
      >
        Capital flows
      </SectionTitle>
      {capitalEvents.length ? (
        <div className="flex flex-col gap-1.5">
          {capitalEvents.map((event) => {
            const inflow = INFLOW_EVENTS.has(event.event_type);
            return (
              <div key={event.id} className="flex items-center gap-2.5 text-sm">
                <span className="shrink-0 font-mono text-[10px] text-fg-muted">
                  {new Date(event.effective_date).toLocaleDateString()}
                </span>
                <span className="shrink-0 rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-secondary">
                  {humanize(event.event_type)}
                </span>
                {event.reference ? <span className="min-w-0 flex-1 truncate text-fg-muted">{event.reference}</span> : <span className="flex-1" />}
                <span className={`shrink-0 font-mono ${EVENT_TONE[event.event_type]}`}>
                  {inflow ? "+" : "−"}
                  {formatCompactCurrency(event.amount)}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-fg-muted">No capital events recorded for this LP.</p>
      )}
    </div>
  );
}

function NextActionItem({ action }: { action: NextAction }) {
  const tier = TIER_META[action.tier];
  return (
    <li className="flex items-start gap-2.5">
      <span className={`mt-0.5 shrink-0 rounded-full border px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider ${tier.tone}`}>
        {tier.label}
      </span>
      <span className="min-w-0 flex-1">
        <span className="text-sm text-fg-primary">{action.label}</span>
        <span className="block text-xs text-fg-muted">{action.rationale}</span>
      </span>
    </li>
  );
}

function NextActions({ data }: { data: WarRoom }) {
  const { nextActions } = data;
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <SectionTitle>Next best actions</SectionTitle>
      {nextActions.length ? (
        <ul className="flex flex-col gap-2.5">
          {nextActions.map((action) => (
            <NextActionItem key={action.action} action={action} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">No recommended moves right now.</p>
      )}
    </div>
  );
}

function Relationships({ data }: { data: WarRoom }) {
  const { relationships, introPath } = data;
  if (!relationships.length && !introPath) return null;
  return (
    <div className="rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <SectionTitle>Relationships & intro path</SectionTitle>
      {introPath ? (
        <div className="mb-3 rounded-lg border border-gold-500/30 bg-gold-500/5 px-3 py-2.5">
          <p className="font-mono text-[10px] uppercase tracking-wider text-gold-400">Warm intro via {introPath.introducer}</p>
          <div className="mt-1.5 flex flex-wrap items-center gap-1.5 text-sm text-fg-secondary">
            {introPath.hops.map((hop, i) => (
              <span key={`${hop}-${i}`} className="flex items-center gap-1.5">
                {i > 0 ? <span className="text-fg-muted">→</span> : null}
                <span className={i === introPath.hops.length - 1 ? "text-fg-primary" : ""}>{hop}</span>
              </span>
            ))}
          </div>
        </div>
      ) : null}
      {relationships.length ? (
        <ul className="flex flex-col gap-1.5">
          {relationships.map((r) => (
            <li key={r.id} className="flex flex-wrap items-center gap-x-2.5 gap-y-1 text-sm">
              <span className="shrink-0 rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-secondary">
                {humanize(r.relation)}
              </span>
              <span className="text-fg-secondary">
                {humanize(r.from_entity_type)} ↔ {humanize(r.to_entity_type)}
              </span>
              {r.strength != null ? (
                <span className="ml-auto font-mono text-[10px] text-fg-muted">strength {r.strength}</span>
              ) : null}
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">No mapped relationships touch this LP yet.</p>
      )}
    </div>
  );
}

// --- War room --------------------------------------------------------------
export function InvestorWarRoom({ data }: { data: WarRoom }) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <Link
        href="/source/lp_pipeline"
        className="font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:text-gold-400"
      >
        ← LP pipeline
      </Link>
      <Header data={data} />
      <Commitments data={data} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CapitalFlows data={data} />
        <NextActions data={data} />
      </div>
      <Relationships data={data} />
    </div>
  );
}
