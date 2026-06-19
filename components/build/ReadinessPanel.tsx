import Link from "next/link";
import type { BuildReadiness, ModuleReadiness } from "@/lib/build-readiness";

// Ring gauge for the overall score. Pure SVG so it renders server-side with no
// client JS.
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

// Build-hub momentum panel: overall readiness, the unlock track, per-module
// progress, and the single next-best action. Rendered above the module
// switcher so progress is always in view as the foundation is filled in.
export function ReadinessPanel({ readiness }: { readiness: BuildReadiness }) {
  const { overall, stage, stages, modules, nextAction } = readiness;

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
              Foundation readiness
            </span>
            <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
              {stage.label}
            </span>
          </div>
          <p className="mt-1 text-sm text-fg-secondary">{stage.blurb}</p>

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
              Next best step · {nextAction.moduleLabel}
            </span>
            <span className="block truncate text-sm text-fg-primary">{nextAction.label}</span>
          </span>
        </Link>
      ) : (
        <div className="mt-4 rounded-xl border border-emerald-400/30 bg-emerald-400/5 px-4 py-3 text-sm text-emerald-300">
          ✓ Foundation complete — your firm is fundraising-ready.
        </div>
      )}
    </div>
  );
}
