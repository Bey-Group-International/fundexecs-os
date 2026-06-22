import Link from "next/link";
import type { RunConviction, DealConviction } from "@/lib/run-conviction";

// Conviction ring — pure SVG, renders server-side with no client JS. Tone
// shifts from gold (building) to emerald (IC-ready) as the portfolio firms up.
function Ring({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - value / 100);
  const tone = value >= 85 ? "text-emerald-400" : value >= 35 ? "text-gold-400" : "text-fg-muted";
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

function pct(v: number | null): string {
  return v == null ? "—" : `${v % 1 === 0 ? v : v.toFixed(1)}%`;
}

// One benchmark tile. `delta` carries an optional comparison line (e.g. pipeline
// IRR vs the mandate target) so each metric is judged against a standard.
function Bench({
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

function DealConvictionChip({ d }: { d: DealConviction }) {
  return (
    <Link
      href={`/deal/${d.deal.id}`}
      title={`${d.deal.name} · ${d.score}% conviction · ${d.stage.label}`}
      className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition hover:bg-surface-2 ${d.stage.tone}`}
    >
      <span className="font-mono text-[10px]">{d.score}</span>
      <span className="max-w-[10rem] truncate text-fg-secondary">{d.deal.name}</span>
      <span className="font-mono text-[9px] uppercase tracking-wider">{d.stage.label}</span>
    </Link>
  );
}

// Run-hub command center: portfolio conviction, the live pipeline benchmarked
// against the firm's mandate and track record, per-deal go/no-go, and the
// single next-best step. Rendered above the module switcher so the evaluation
// picture stays in view as diligence and underwriting are worked.
export function RunCommandCenter({ conviction }: { conviction: RunConviction }) {
  const { overall, stage, deals, benchmark, nextAction, mandate } = conviction;

  if (deals.length === 0) {
    return (
      <div className="mb-6 flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface-1 px-8 py-10 text-center">
        <div className="flex items-center gap-2">
          <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
            Deal command center
          </span>
          <Link
            href="/run/search"
            className="rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gold-200 transition hover:bg-gold-500/20"
          >
            ✶ AI Evaluate
          </Link>
        </div>
        <p className="mt-2 max-w-sm text-sm text-fg-secondary">
          No deals in evaluation yet. Move a deal into diligence from the{" "}
          <Link href="/source/deal_pipeline" className="text-gold-400 hover:underline">
            deal pipeline
          </Link>{" "}
          and conviction will build here as you underwrite and clear diligence.
        </p>
      </div>
    );
  }

  const irrTone =
    benchmark.avgPipelineIrr == null || benchmark.targetIrr == null
      ? undefined
      : benchmark.avgPipelineIrr >= benchmark.targetIrr
        ? "good"
        : "warn";
  const irrDelta =
    benchmark.avgPipelineIrr != null && benchmark.targetIrr != null
      ? `${benchmark.avgPipelineIrr >= benchmark.targetIrr ? "+" : ""}${(
          benchmark.avgPipelineIrr - benchmark.targetIrr
        ).toFixed(1)} vs ${benchmark.targetIrr}% target`
      : benchmark.historicalIrr != null
        ? `${benchmark.historicalIrr.toFixed(1)}% realized to date`
        : undefined;

  return (
    <div className="mb-6 rounded-2xl border border-line bg-gradient-to-b from-surface-1 to-surface-1/60 p-5">
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
              Portfolio conviction
            </span>
            <span
              className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${stage.tone}`}
            >
              {stage.label}
            </span>
            {benchmark.icReadyCount > 0 ? (
              <span className="rounded-full border border-emerald-400/40 bg-emerald-400/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-300">
                {benchmark.icReadyCount} IC-ready
              </span>
            ) : null}
            <Link
              href="/run/search"
              className="ml-auto rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gold-200 transition hover:bg-gold-500/20"
            >
              ✶ AI Evaluate
            </Link>
          </div>
          <p className="mt-1 text-sm text-fg-secondary">
            {benchmark.dealsInEval} {benchmark.dealsInEval === 1 ? "deal" : "deals"} in evaluation
            {mandate ? (
              <>
                {" "}
                against{" "}
                <Link href="/build/thesis" className="text-fg-primary hover:text-gold-300">
                  {mandate.thesisTitle}
                </Link>
              </>
            ) : null}
            .
          </p>

          {/* Benchmark grid — the live pipeline judged against the firm's own bar */}
          <div className="mt-3 grid grid-cols-2 gap-2 sm:grid-cols-4">
            <Bench
              value={pct(benchmark.avgPipelineIrr)}
              label="Pipeline IRR"
              delta={irrDelta}
              tone={irrTone}
            />
            <Bench
              value={`${Math.round(benchmark.avgCoverage * 100)}%`}
              label="Diligence cleared"
              tone={benchmark.avgCoverage >= 0.7 ? "good" : "warn"}
            />
            <Bench
              value={String(benchmark.openCriticalRisks)}
              label="Open critical risk"
              tone={benchmark.openCriticalRisks === 0 ? "good" : "bad"}
            />
            <Bench
              value={pct(benchmark.historicalIrr)}
              label="Track record IRR"
              delta={benchmark.historicalIrr != null ? "your realized bar" : "no realized deals"}
            />
          </div>
        </div>
      </div>

      {/* Per-deal conviction */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {deals.map((d) => (
          <DealConvictionChip key={d.deal.id} d={d} />
        ))}
      </div>

      {/* Next best step */}
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
              Next best step · {nextAction.dealName}
            </span>
            <span className="block truncate text-sm text-fg-primary">{nextAction.label}</span>
          </span>
        </Link>
      ) : (
        <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-300">
          ✓ Every active deal is IC-ready — take them to committee.
        </div>
      )}
    </div>
  );
}
