import Link from "next/link";
import type { BuildReadiness, ModuleReadiness } from "@/lib/build-readiness";

function Ring({ value }: { value: number }) {
  const r = 26;
  const c = 2 * Math.PI * r;
  const offset = c * (1 - value / 100);
  return (
    <svg viewBox="0 0 64 64" className="h-16 w-16 -rotate-90">
      <circle cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="6" className="text-line" />
      <circle
        cx="32" cy="32" r={r} fill="none" stroke="currentColor" strokeWidth="6"
        strokeLinecap="round" strokeDasharray={c} strokeDashoffset={offset}
        className="text-gold-400 transition-[stroke-dashoffset]"
      />
    </svg>
  );
}

function ModuleChip({ m }: { m: ModuleReadiness }) {
  const tone =
    m.status === "complete"
      ? "border-emerald-400/40 text-emerald-300"
      : m.status === "started"
        ? "border-gold-500/40 text-gold-300"
        : "border-line text-fg-muted";
  const mark = m.status === "complete" ? "✓" : `${m.doneCount}/${m.total}`;
  return (
    <Link
      href={m.href}
      title={`${m.label}: ${m.score}% complete`}
      className={`flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs transition hover:bg-surface-2 ${tone}`}
    >
      <span className="font-mono text-[10px]">{mark}</span>
      <span>{m.label}</span>
    </Link>
  );
}

// Derive top-3 next actions from incomplete modules, sorted by most remaining
// fields (highest impact first). Falls back gracefully when modules are sparse.
function topNextActions(
  modules: ModuleReadiness[],
  primary: BuildReadiness["nextAction"],
): Array<{ label: string; moduleLabel: string; href: string; impact: string }> {
  const incomplete = modules
    .filter((m) => m.status !== "complete")
    .sort((a, b) => (b.total - b.doneCount) - (a.total - a.doneCount));

  const actions: Array<{ label: string; moduleLabel: string; href: string; impact: string }> = [];

  if (primary) {
    actions.push({
      label: primary.label,
      moduleLabel: primary.moduleLabel,
      href: primary.href,
      impact: "highest impact",
    });
  }

  const IMPACT = ["high impact", "quick win"];
  for (const m of incomplete) {
    if (actions.some((a) => a.href === m.href)) continue;
    if (actions.length >= 3) break;
    actions.push({
      label: `Complete ${m.label} (${m.doneCount}/${m.total} fields)`,
      moduleLabel: m.label,
      href: m.href,
      impact: IMPACT[actions.length - 1] ?? "quick win",
    });
  }

  return actions.slice(0, 3);
}

export function ReadinessPanel({
  readiness,
  floating = false,
}: {
  readiness: BuildReadiness;
  /** When true, styles the panel for use inside the floating dismissable
      alert: no bottom margin, a drop shadow, and header room for a ✕. */
  floating?: boolean;
}) {
  const { overall, stage, stages, modules, nextAction } = readiness;
  const nextStage = stages.find((s) => !s.unlocked);
  const gap = nextStage ? nextStage.threshold - overall : 0;
  const topActions = topNextActions(modules, nextAction);

  return (
    <div
      className={`rounded-2xl border border-line bg-surface-1 p-5 ${
        floating ? "shadow-2xl shadow-black/40" : "mb-6"
      }`}
    >
      <div className="flex items-start gap-4">
        <div className="relative shrink-0">
          <Ring value={overall} />
          <span className="absolute inset-0 flex items-center justify-center font-display text-sm font-semibold text-fg-primary">
            {overall}%
          </span>
        </div>

        <div className="min-w-0 flex-1">
          <div className={`flex flex-wrap items-center gap-2 ${floating ? "pr-6" : ""}`}>
            <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">
              Investor Readiness
            </span>
            <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
              {stage.label}
            </span>
            <Link
              href="/build/data_room"
              className="ml-auto font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:text-gold-300"
            >
              View materials →
            </Link>
          </div>
          <p className="mt-1 text-sm text-fg-secondary">{stage.blurb}</p>
          {nextStage ? (
            <p className="mt-1 font-mono text-[10px] uppercase tracking-wider text-gold-400">
              {gap} {gap === 1 ? "point" : "points"} to {nextStage.label}
            </p>
          ) : null}

          {/* Unlock track */}
          <div className="mt-3 flex items-center gap-1.5">
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

      {/* Per-module progress */}
      <div className="mt-4 flex flex-wrap gap-1.5">
        {modules.map((m) => (
          <ModuleChip key={m.key} m={m} />
        ))}
      </div>

      {/* Top-3 ranked next actions */}
      {topActions.length > 0 ? (
        <div className="mt-4 flex flex-col gap-2">
          <p className="font-mono text-[9px] uppercase tracking-widest text-fg-muted">
            Top actions by impact
          </p>
          {topActions.map((action, idx) => (
            <Link
              key={action.href + idx}
              href={action.href}
              className="flex items-center gap-3 rounded-xl border border-gold-500/30 bg-gold-500/5 px-4 py-3 transition hover:bg-gold-500/10"
            >
              <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-gold-400 font-mono text-xs text-surface-0">
                {idx + 1}
              </span>
              <span className="min-w-0 flex-1">
                <span className="block font-mono text-[9px] uppercase tracking-wider text-gold-400">
                  {action.impact} · {action.moduleLabel}
                </span>
                <span className="block truncate text-sm text-fg-primary">{action.label}</span>
              </span>
            </Link>
          ))}
        </div>
      ) : (
        <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-300">
          ✓ Foundation complete — your firm is fundraising-ready.
        </div>
      )}
    </div>
  );
}
