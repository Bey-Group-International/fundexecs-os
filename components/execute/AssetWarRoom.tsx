import Link from "next/link";
import { PrintButton } from "@/components/PrintButton";
import type { AssetWarRoom as WarRoom, LifecycleStage, AssetNextAction } from "@/lib/execute-war-room";
import { formatCompactCurrency } from "@/lib/execute-war-room";
import type { AssetType, CapitalEventType } from "@/lib/supabase/database.types";

// --- Small primitives ------------------------------------------------------
// MOIC ring — same SVG idiom as the Run-hub deal and Source-hub LP war rooms.
// A multiple is mapped onto the 0–100 arc against a 3x ceiling so 1x reads as a
// third of the ring and ≥3x fills it.
function Ring({ value, size = 72 }: { value: number; size?: number }) {
  const r = size / 2 - 6;
  const c = 2 * Math.PI * r;
  const pct = Math.max(0, Math.min(100, value));
  const offset = c * (1 - pct / 100);
  const tone = pct >= 67 ? "text-emerald-400" : pct >= 33 ? "text-gold-400" : "text-fg-muted";
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
  return value.replace(/_/g, " ").replace(/\b\w/g, (ch) => ch.toUpperCase());
}

// --- Theme maps ------------------------------------------------------------
const STAGE_META: Record<LifecycleStage, { label: string; tone: string }> = {
  pre_acquisition: { label: "Pre-acquisition", tone: "border-line text-fg-muted" },
  held: { label: "Held", tone: "border-gold-500/40 bg-gold-500/10 text-gold-300" },
  exited: { label: "Realized", tone: "border-emerald-400/40 bg-emerald-400/10 text-emerald-300" },
};

const ASSET_TYPE_LABEL: Record<AssetType, string> = {
  real_estate: "Real Estate",
  operating_company: "Operating Company",
  portfolio_company: "Portfolio Company",
  fund_interest: "Fund Interest",
  other: "Other",
};

// Capital flowing in (calls/contributions/fees) pulls cash from LPs; flowing out
// (distributions/returns/carry) sends it back. Colour + sign follow that.
const OUTFLOW_EVENTS = new Set<CapitalEventType>(["distribution", "return_of_capital", "carry"]);
const EVENT_TONE: Record<CapitalEventType, string> = {
  capital_call: "text-status-danger",
  contribution: "text-status-danger",
  fee: "text-fg-muted",
  distribution: "text-emerald-300",
  return_of_capital: "text-emerald-300",
  carry: "text-gold-300",
};

// --- Sections --------------------------------------------------------------
function Header({ data }: { data: WarRoom }) {
  const { asset, moic, lifecycleStage } = data;
  const stage = STAGE_META[lifecycleStage];
  // Map the multiple onto the 0–100 ring against a 3x ceiling; show the raw value.
  const ringValue = moic != null ? (moic / 3) * 100 : 0;
  return (
    <div className="break-inside-avoid rounded-2xl border border-line bg-gradient-to-b from-surface-1 to-surface-1/60 p-4 sm:p-5">
      <div className="flex flex-wrap items-center gap-4 sm:gap-5">
        <div className="relative shrink-0">
          <Ring value={ringValue} />
          <span className="absolute inset-0 flex flex-col items-center justify-center text-center">
            <span className="font-display text-base font-semibold leading-none text-fg-primary">
              {moic != null ? `${moic}x` : "—"}
            </span>
            <span className="mt-0.5 font-mono text-[8px] uppercase tracking-wider text-fg-muted">MOIC</span>
          </span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <h1 className="min-w-0 break-words font-display text-2xl font-semibold tracking-tight text-fg-primary">{asset.name}</h1>
            <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${stage.tone}`}>
              {stage.label}
            </span>
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              {ASSET_TYPE_LABEL[asset.asset_type]}
            </span>
            <span className="rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
              {humanize(asset.status)}
            </span>
          </div>
          <div className="mt-1 flex flex-wrap gap-x-4 gap-y-1 text-sm text-fg-secondary">
            {asset.acquisition_date ? (
              <span className="font-mono uppercase tracking-wider text-fg-muted">
                Acquired <span className="text-fg-secondary">{new Date(asset.acquisition_date).toLocaleDateString()}</span>
              </span>
            ) : null}
            {data.fund ? <span>{data.fund.name}</span> : null}
          </div>
          <p className="mt-2 text-sm text-fg-muted">{data.deploymentNote}</p>
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

function Value({ data }: { data: WarRoom }) {
  const { asset, moic, unrealizedGain } = data;
  const gainTone =
    unrealizedGain == null ? "text-fg-muted" : unrealizedGain >= 0 ? "text-emerald-300" : "text-status-danger";
  const gainValue =
    unrealizedGain == null
      ? "—"
      : `${unrealizedGain >= 0 ? "+" : "−"}${formatCompactCurrency(Math.abs(unrealizedGain))}`;
  const hasYield = asset.noi != null || asset.cap_rate != null;
  return (
    <div className="break-inside-avoid rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <SectionTitle>Value</SectionTitle>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <StatCell label="Acquisition cost" value={formatCompactCurrency(asset.acquisition_cost)} />
        <StatCell label="Current mark" value={formatCompactCurrency(asset.current_value)} />
        <StatCell label="Unrealized gain" value={gainValue} tone={gainTone} />
        <StatCell label="Gross MOIC" value={moic != null ? `${moic}x` : "—"} />
      </div>
      {hasYield ? (
        <div className="mt-2 grid grid-cols-2 gap-2 sm:grid-cols-4">
          {asset.noi != null ? <StatCell label="NOI" value={formatCompactCurrency(asset.noi)} /> : null}
          {asset.cap_rate != null ? (
            <StatCell label="Cap rate" value={`${asset.cap_rate}%`} tone="text-fg-secondary" />
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

function CapitalFlows({ data }: { data: WarRoom }) {
  const { capitalEvents } = data;
  return (
    <div className="break-inside-avoid rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <SectionTitle
        action={
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {capitalEvents.length} events
          </span>
        }
      >
        Capital flows
      </SectionTitle>
      {capitalEvents.length ? (
        <div className="flex flex-col gap-1.5">
          {capitalEvents.map((event) => {
            const outflow = OUTFLOW_EVENTS.has(event.event_type);
            return (
              <div key={event.id} className="flex items-center gap-2.5 text-sm">
                <span className="shrink-0 font-mono text-[10px] text-fg-muted">
                  {new Date(event.effective_date).toLocaleDateString()}
                </span>
                <span className="shrink-0 rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-secondary">
                  {humanize(event.event_type)}
                </span>
                {event.reference ? (
                  <span className="min-w-0 flex-1 truncate text-fg-muted">{event.reference}</span>
                ) : (
                  <span className="flex-1" />
                )}
                <span className={`shrink-0 font-mono ${EVENT_TONE[event.event_type]}`}>
                  {outflow ? "+" : "−"}
                  {formatCompactCurrency(event.amount)}
                </span>
              </div>
            );
          })}
        </div>
      ) : (
        <p className="text-sm text-fg-muted">No capital events recorded against this asset.</p>
      )}
    </div>
  );
}

function NextActionItem({ action }: { action: AssetNextAction }) {
  return (
    <li>
      <Link
        href={action.href}
        className="flex items-start gap-2.5 rounded-lg border border-line/60 bg-surface-0 px-3 py-2.5 transition hover:border-gold-500/50"
      >
        <span className="mt-0.5 shrink-0 text-gold-400">→</span>
        <span className="min-w-0 flex-1">
          <span className="block text-sm text-fg-primary">{action.label}</span>
          <span className="block text-xs text-fg-muted">{action.rationale}</span>
        </span>
      </Link>
    </li>
  );
}

function NextActions({ data }: { data: WarRoom }) {
  const { nextActions } = data;
  return (
    <div className="break-inside-avoid rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <SectionTitle>Next best actions</SectionTitle>
      {nextActions.length ? (
        <ul className="flex flex-col gap-2">
          {nextActions.map((action) => (
            <NextActionItem key={action.key} action={action} />
          ))}
        </ul>
      ) : (
        <p className="text-sm text-fg-muted">Fully marked and on basis — no open moves on this holding.</p>
      )}
    </div>
  );
}

function Provenance({ data }: { data: WarRoom }) {
  const { asset, deal, fund } = data;
  if (!deal && !fund) return null;
  return (
    <div className="break-inside-avoid rounded-2xl border border-line bg-surface-1 p-4 sm:p-5">
      <SectionTitle>Provenance</SectionTitle>
      <div className="flex flex-col gap-2 text-sm">
        {fund ? (
          <div className="flex items-center justify-between gap-3">
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Fund</span>
            <span className="min-w-0 truncate text-right text-fg-primary">{fund.name}</span>
          </div>
        ) : null}
        {deal ? (
          <div className="flex items-center justify-between gap-3">
            <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Source deal</span>
            <Link href={`/deal/${deal.id}`} className="min-w-0 truncate text-right text-gold-300 transition hover:underline">
              {deal.name} →
            </Link>
          </div>
        ) : null}
        {asset.acquisition_date ? (
          <div className="flex items-center justify-between gap-3">
            <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Acquired</span>
            <span className="text-fg-secondary">{new Date(asset.acquisition_date).toLocaleDateString()}</span>
          </div>
        ) : null}
      </div>
    </div>
  );
}

// --- War room --------------------------------------------------------------
export function AssetWarRoom({ data }: { data: WarRoom }) {
  return (
    <div className="mx-auto flex max-w-4xl flex-col gap-4">
      <div className="flex items-center justify-between gap-3">
        <Link
          href="/execute/asset_management"
          className="font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:text-gold-400"
        >
          ← Asset management
        </Link>
        <PrintButton />
      </div>
      <Header data={data} />
      <Value data={data} />
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">
        <CapitalFlows data={data} />
        <NextActions data={data} />
      </div>
      <Provenance data={data} />
    </div>
  );
}
