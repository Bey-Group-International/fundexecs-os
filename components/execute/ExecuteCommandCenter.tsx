import Link from "next/link";
import type { ExecutePerformance, ExecuteModuleChip } from "@/lib/execute-performance";
import { compactUsd, multiple } from "@/lib/format";

// Performance ring — pure SVG, renders server-side with no client JS. Fill maps
// the hero multiple onto a 2.0× target (a full ring = doubled capital); tone
// shifts from muted (under water) to gold (compounding) to emerald (1.5×+).
function Ring({ value }: { value: number | null }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const fill = value == null ? 0 : Math.min(100, (value / 2) * 100);
  const offset = c * (1 - fill / 100);
  const tone =
    value == null ? "text-fg-muted" : value >= 1.5 ? "text-emerald-400" : value >= 1 ? "text-gold-400" : "text-status-danger";
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
      <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-line" />
      <circle
        cx="32"
        cy="32"
        r={r}
        fill="none"
        stroke="currentColor"
        strokeWidth="6"
        strokeLinecap="round"
        strokeDasharray={c}
        strokeDashoffset={offset}
        className={`${tone} transition-[stroke-dashoffset]`}
      />
    </svg>
  );
}

// One performance tile. `delta` carries an optional context line so each metric
// reads against a standard (paid-in, cost basis, or capital preserved at 1.0×).
function Metric({
  value,
  label,
  delta,
  tone,
}: {
  value: string;
  label: string;
  delta?: string;
  tone?: "good" | "warn" | "bad";
}) {
  const deltaTone =
    tone === "good"
      ? "text-emerald-300"
      : tone === "bad"
        ? "text-status-danger"
        : tone === "warn"
          ? "text-gold-300"
          : "text-fg-muted";
  return (
    <div className="flex flex-col gap-0.5 rounded-xl border border-line bg-surface-2/40 px-3.5 py-2.5">
      <span className="font-display text-lg font-semibold leading-none text-fg-primary">{value}</span>
      <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</span>
      {delta ? <span className={`text-[11px] leading-tight ${deltaTone}`}>{delta}</span> : null}
    </div>
  );
}

const CHIP_TONE: Record<ExecuteModuleChip["status"], string> = {
  complete: "border-emerald-400/40 text-emerald-300",
  started: "border-gold-500/40 text-gold-300",
  empty: "border-line text-fg-muted",
};

function ModuleChip({ m }: { m: ExecuteModuleChip }) {
  return (
    <Link
      href={m.href}
      title={`${m.label}: ${m.count}`}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition hover:bg-surface-2 ${CHIP_TONE[m.status]}`}
    >
      <span className="font-mono text-[10px]">{m.count}</span>
      <span>{m.label}</span>
    </Link>
  );
}

// Value bridge — paid-in capital alongside what it's worth today, split into the
// portion already returned (DPI) and the portion still held at mark (RVPI). One
// glance answers the operator's core question: have we made money, and how much
// is back versus still on the table?
function ValueBridge({ perf }: { perf: ExecutePerformance }) {
  const { called, distributed, nav } = perf;
  const totalValue = distributed + nav;
  const base = Math.max(called, totalValue, 1);
  const distPct = (distributed / base) * 100;
  const navPct = (nav / base) * 100;
  const calledPct = (called / base) * 100;

  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-3.5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[9px] uppercase tracking-wider text-gold-400">Value bridge</span>
        <span
          className={`font-display text-sm font-semibold ${
            totalValue >= called ? "text-emerald-300" : "text-status-danger"
          }`}
        >
          {compactUsd(totalValue)} total value
        </span>
      </div>

      {/* Total value bar: returned (solid) + still held (translucent) */}
      <div className="mt-2.5 flex h-2 overflow-hidden rounded-full bg-surface-3">
        <div className="h-full bg-emerald-400/80 transition-[width]" style={{ width: `${distPct}%` }} />
        <div className="h-full bg-gold-400/70 transition-[width]" style={{ width: `${navPct}%` }} />
      </div>
      {/* Paid-in reference line */}
      <div className="relative mt-1 h-2">
        <div className="absolute h-full bg-fg-muted/30 transition-[width]" style={{ width: `${calledPct}%` }}>
          <div className="float-right h-full w-px bg-fg-secondary" />
        </div>
      </div>

      <div className="mt-1.5 flex flex-wrap gap-x-4 gap-y-1 text-[11px]">
        <span className="flex items-center gap-1.5 text-fg-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-emerald-400" aria-hidden />
          Returned {compactUsd(distributed)}
        </span>
        <span className="flex items-center gap-1.5 text-fg-secondary">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-400" aria-hidden />
          Held at mark {compactUsd(nav)}
        </span>
        <span className="flex items-center gap-1.5 text-fg-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-fg-muted/50" aria-hidden />
          Paid-in {compactUsd(called)}
        </span>
      </div>
    </div>
  );
}

function CapitalCard({ perf }: { perf: ExecutePerformance }) {
  const { netCashflow, deploymentPct, committed, called, upcomingCall } = perf;
  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-3.5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[9px] uppercase tracking-wider text-gold-400">Capital position</span>
        <span
          className={`font-display text-sm font-semibold ${
            netCashflow >= 0 ? "text-emerald-300" : "text-fg-primary"
          }`}
        >
          {netCashflow >= 0 ? "+" : "−"}
          {compactUsd(Math.abs(netCashflow))} net
        </span>
      </div>
      {committed > 0 && deploymentPct != null ? (
        <>
          <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-gold-400 transition-[width]"
              style={{ width: `${deploymentPct}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-fg-secondary">
            <span className="text-fg-primary">{deploymentPct}%</span> deployed —{" "}
            {compactUsd(called)} of {compactUsd(committed)} committed
          </p>
        </>
      ) : (
        <p className="mt-2 text-xs text-fg-muted">
          <span className="text-fg-primary">{compactUsd(called)}</span> paid in — set a fund size to
          track deployment.
        </p>
      )}
      {upcomingCall ? (
        <p className="mt-1 font-mono text-[10px] text-gold-300">
          ↑ {compactUsd(upcomingCall.amount)} call due {upcomingCall.date}
        </p>
      ) : null}
    </div>
  );
}

// Execute-hub command center: portfolio value at a glance — the hero multiple
// (TVPI), the standard PE ratios, the value bridge of returned-vs-held capital,
// the deployment position, the lifecycle track, per-module presence, and the
// single next-best move. Rendered above the module switcher so the state of the
// book is always in view as marks and capital events are worked.
export function ExecuteCommandCenter({ perf }: { perf: ExecutePerformance }) {
  if (!perf.hasData) {
    return (
      <div className="mb-6 flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface-1 px-8 py-10 text-center">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
          Portfolio command center
        </span>
        <p className="mt-2 max-w-sm text-sm text-fg-secondary">
          Nothing on the book yet. Add a holding in{" "}
          <Link href="/execute/asset_management" className="text-gold-400 hover:underline">
            asset management
          </Link>{" "}
          and your NAV, multiples, and the capital ledger will compound here as you operate.
        </p>
      </div>
    );
  }

  const { stage, stages, heroMultiple, heroLabel, nav, activeAssets, exitedAssets } = perf;

  const navTone = perf.unrealizedGain >= 0 ? "good" : "bad";
  const navDelta =
    perf.cost > 0
      ? `${perf.unrealizedGain >= 0 ? "+" : "−"}${compactUsd(Math.abs(perf.unrealizedGain))} vs cost`
      : "no cost basis yet";

  return (
    <div className="mb-6 rounded-2xl border border-line bg-gradient-to-b from-surface-1 to-surface-1/60 p-5">
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <Ring value={heroMultiple} />
          <span className="absolute inset-0 flex flex-col items-center justify-center leading-none">
            <span className="font-display text-sm font-semibold text-fg-primary">
              {multiple(heroMultiple)}
            </span>
            <span className="mt-0.5 font-mono text-[7px] uppercase tracking-wider text-fg-muted">
              {heroLabel}
            </span>
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
              Portfolio performance
            </span>
            <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
              {stage.label}
            </span>
            {exitedAssets > 0 ? (
              <span className="rounded-full border border-emerald-400/40 bg-emerald-400/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-300">
                {exitedAssets} exited
              </span>
            ) : null}
            <Link
              href="/execute/asset_management"
              className="ml-auto rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gold-200 transition hover:bg-gold-500/20"
            >
              ✶ AI Ops
            </Link>
          </div>
          <p className="mt-1 text-sm text-fg-secondary">
            {activeAssets} {activeAssets === 1 ? "holding" : "holdings"} on the book
            {perf.topAsset ? (
              <>
                {" "}
                · best mark{" "}
                <span className="text-fg-primary">
                  {perf.topAsset.name} {multiple(perf.topAsset.multiple)}
                </span>
              </>
            ) : null}
            .
          </p>

          {/* Performance grid — the standard multiples LP reports lead with */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Metric value={compactUsd(nav)} label="NAV" delta={navDelta} tone={navTone} />
            <Metric
              value={multiple(perf.tvpi)}
              label="TVPI"
              delta={perf.tvpi != null ? (perf.tvpi >= 1 ? "above paid-in" : "below paid-in") : "no capital yet"}
              tone={perf.tvpi == null ? undefined : perf.tvpi >= 1 ? "good" : "bad"}
            />
            <Metric
              value={multiple(perf.dpi)}
              label="DPI"
              delta={perf.dpi != null ? `${Math.round(perf.dpi * 100)}% returned` : "nothing back yet"}
              tone={perf.dpi != null && perf.dpi >= 1 ? "good" : undefined}
            />
            <Metric
              value={multiple(perf.grossMoic)}
              label="Gross MOIC"
              delta="value / cost"
              tone={perf.grossMoic == null ? undefined : perf.grossMoic >= 1 ? "good" : "bad"}
            />
          </div>
        </div>
      </div>

      {/* Lifecycle track — the portfolio's journey from deployment to realization */}
      <div className="mt-4 flex flex-wrap items-center gap-1.5">
        {stages.map((s, i) => (
          <div key={s.stage.key} className="flex items-center gap-1.5">
            <span
              className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                s.current
                  ? "bg-gold-400 text-surface-0"
                  : s.reached
                    ? "border border-emerald-400/40 text-emerald-300"
                    : "border border-line text-fg-muted"
              }`}
            >
              {s.stage.label}
            </span>
            {i < stages.length - 1 ? (
              <span className={s.reached ? "text-emerald-400/50" : "text-line"}>→</span>
            ) : null}
          </div>
        ))}
      </div>

      {/* Anchor cards — value bridge + capital position */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <ValueBridge perf={perf} />
        <CapitalCard perf={perf} />
      </div>

      {/* Per-module presence */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {perf.modules.map((m) => (
          <ModuleChip key={m.key} m={m} />
        ))}
      </div>

      {/* Next best move */}
      {perf.nextAction ? (
        <Link
          href={perf.nextAction.href}
          className="mt-4 flex items-center gap-3 rounded-xl border border-gold-500/30 bg-gold-500/5 px-4 py-3 transition hover:bg-gold-500/10"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold-400 font-mono text-xs text-surface-0">
            →
          </span>
          <span className="min-w-0">
            <span className="block font-mono text-[9px] uppercase tracking-wider text-gold-400">
              Next best move · {perf.nextAction.moduleLabel}
            </span>
            <span className="block truncate text-sm text-fg-primary">{perf.nextAction.label}</span>
          </span>
        </Link>
      ) : (
        <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-300">
          ✓ Portfolio compounding — capital returning with value held at mark.
        </div>
      )}
    </div>
  );
}
