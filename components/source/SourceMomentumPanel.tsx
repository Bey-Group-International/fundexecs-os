import Link from "next/link";
import type {
  SourceMomentum,
  SourceModuleChip,
  CapitalCoverage,
  PipelineVelocity,
} from "@/lib/source-readiness";

function compactUsd(n: number): string {
  if (!n || n <= 0) return "$0";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency: "USD",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(n);
}

// Overall-score ring. Pure SVG so it renders server-side with no client JS.
function Ring({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - value / 100);
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
        className="text-gold-400 transition-[stroke-dashoffset]"
      />
    </svg>
  );
}

function CoverageCard({ coverage }: { coverage: CapitalCoverage }) {
  const pct = coverage.pct;
  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-3.5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[9px] uppercase tracking-wider text-gold-400">
          Capital coverage
        </span>
        {pct != null ? (
          <span className="font-display text-sm font-semibold text-fg-primary">{pct}%</span>
        ) : null}
      </div>
      {coverage.target > 0 ? (
        <>
          <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-surface-3">
            <div
              className="h-full rounded-full bg-gold-400 transition-[width]"
              style={{ width: `${Math.min(100, pct ?? 0)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-fg-secondary">
            <span className="text-fg-primary">{compactUsd(coverage.stack)}</span> lined up of{" "}
            {compactUsd(coverage.target)}
          </p>
        </>
      ) : (
        <p className="mt-2 text-xs text-fg-muted">
          <span className="text-fg-primary">{compactUsd(coverage.stack)}</span> in the stack — set a fund
          target to track coverage.
        </p>
      )}
      {coverage.debt > 0 ? (
        <p className="mt-1 font-mono text-[10px] text-fg-muted">
          incl. {compactUsd(coverage.debt)} debt
        </p>
      ) : null}
    </div>
  );
}

function VelocityCard({ velocity }: { velocity: PipelineVelocity }) {
  const healthy = velocity.stalled === 0;
  return (
    <div className="rounded-xl border border-line bg-surface-2/40 p-3.5">
      <div className="flex items-baseline justify-between">
        <span className="font-mono text-[9px] uppercase tracking-wider text-gold-400">
          Pipeline velocity
        </span>
        <span
          className={`font-display text-sm font-semibold ${healthy ? "text-status-success" : "text-status-warning"}`}
        >
          {velocity.active === 0 ? "—" : healthy ? "On pace" : `${velocity.stalled} stalled`}
        </span>
      </div>
      {velocity.active === 0 ? (
        <p className="mt-2 text-xs text-fg-muted">No live conversations yet.</p>
      ) : healthy ? (
        <p className="mt-2 text-xs text-fg-secondary">
          All <span className="text-fg-primary">{velocity.active}</span> live conversations touched within{" "}
          {21}d.
        </p>
      ) : (
        <p className="mt-2 text-xs text-fg-secondary">
          {velocity.stalled} of <span className="text-fg-primary">{velocity.active}</span> quiet
          {velocity.oldestDays != null ? ` — oldest ${velocity.oldestDays}d` : ""}.
        </p>
      )}
    </div>
  );
}

const CHIP_TONE: Record<SourceModuleChip["status"], string> = {
  complete: "border-emerald-400/40 text-emerald-300",
  started: "border-gold-500/40 text-gold-300",
  empty: "border-line text-fg-muted",
};

function ModuleChip({ m }: { m: SourceModuleChip }) {
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

// Source-hub momentum panel: overall score, the prospecting→closing track, the
// two anchor metrics operators steer by (capital coverage + velocity), per-
// module presence, and the single next-best move. Rendered above the module
// switcher so the state of the raise is always in view.
export function SourceMomentumPanel({ momentum }: { momentum: SourceMomentum }) {
  const { overall, stage, stages, coverage, velocity, modules, nextAction } = momentum;

  return (
    <div className="mb-6 rounded-2xl border border-line bg-surface-1 p-5">
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <Ring value={overall} />
          <span className="absolute inset-0 flex items-center justify-center font-display text-sm font-semibold text-fg-primary">
            {overall}%
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
              Sourcing momentum
            </span>
            <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
              {stage.label}
            </span>
            <Link
              href="/source/search"
              className="ml-auto rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gold-200 transition hover:bg-gold-500/20"
            >
              ✶ AI Search
            </Link>
            <Link
              href="/source/triage"
              className="rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gold-200 transition hover:bg-gold-500/20"
            >
              ✶ Triage
            </Link>
            <Link
              href="/source/intel"
              className="rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gold-200 transition hover:bg-gold-500/20"
            >
              ✶ Intelligence
            </Link>
          </div>
          <p className="mt-1 text-sm text-fg-secondary">{stage.blurb}</p>

          {/* Unlock track */}
          <div className="mt-3 flex flex-wrap items-center gap-1.5">
            {stages.map((s, i) => (
              <div key={s.key} className="flex items-center gap-1.5">
                <span
                  className={`flex items-center gap-1 rounded-full px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                    s.current
                      ? "bg-gold-400 text-surface-0"
                      : s.unlocked
                        ? "border border-emerald-400/40 text-emerald-300"
                        : "border border-line text-fg-muted"
                  }`}
                >
                  {s.unlocked ? "" : "🔒 "}
                  {s.label}
                </span>
                {i < stages.length - 1 ? (
                  <span className={s.unlocked ? "text-emerald-400/50" : "text-line"}>→</span>
                ) : null}
              </div>
            ))}
          </div>
        </div>
      </div>

      {/* Anchor metrics */}
      <div className="mt-4 grid gap-3 sm:grid-cols-2">
        <CoverageCard coverage={coverage} />
        <VelocityCard velocity={velocity} />
      </div>

      {/* Per-module presence */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {modules.map((m) => (
          <ModuleChip key={m.key} m={m} />
        ))}
      </div>

      {/* Next best action */}
      {nextAction ? (
        <Link
          href={nextAction.href}
          className="mt-4 flex items-center gap-3 rounded-xl border border-gold-500/30 bg-gold-500/5 px-4 py-3 transition hover:bg-gold-500/10"
        >
          <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold-400 font-mono text-xs text-surface-0">
            →
          </span>
          <span className="min-w-0">
            <span className="block font-mono text-[9px] uppercase tracking-wider text-gold-400">
              Next best move · {nextAction.moduleLabel}
            </span>
            <span className="block truncate text-sm text-fg-primary">{nextAction.label}</span>
          </span>
        </Link>
      ) : (
        <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-300">
          ✓ Pipeline humming — coverage is on target with the bench in place.
        </div>
      )}
    </div>
  );
}
