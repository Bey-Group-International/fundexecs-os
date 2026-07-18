// "Skills at work" — the governed-execution evidence panel for a session. Renders
// every skill_run as a card: which skill + executive ran it, its status, the gate
// tier its follow-on needs, confidence/completeness, the provenance breakdown
// (facts vs assumptions vs calculations vs generated), and any flagged missing
// data. This is the visible, testable proof that a skill actually ran, validated
// its I/O, and produced a provenanced result — not just generated text.
import { SKILL_LABELS } from "@/lib/skills/labels";
import type { SkillRunView } from "@/lib/skills/store";

const TIER_STYLE: Record<number, string> = {
  1: "border-status-success/40 text-status-success",
  2: "border-gold-500/50 text-gold-400",
  3: "border-status-danger/50 text-status-danger",
};
const TIER_LABEL: Record<number, string> = { 1: "Internal", 2: "External", 3: "Capital-binding" };

const STATUS_STYLES: Record<string, string> = {
  succeeded: "text-gold-400",
  failed: "text-fg-muted",
  rejected: "text-status-danger",
};

function pct(n: number): string {
  return `${Math.round(n * 100)}%`;
}

export default function SkillRunFeed({ runs }: { runs: SkillRunView[] }) {
  return (
    <section>
      <h2 className="mb-2 mt-8 font-mono text-xs uppercase tracking-wider text-fg-muted">
        Skills at work
      </h2>

      {runs.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
          No skill runs in this session yet — a governed skill records its run here.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {runs.map((run) => {
            const label = SKILL_LABELS[run.skillId] ?? run.skillId;
            const statusClass = STATUS_STYLES[run.status] ?? "text-fg-muted";
            const c = run.sourceCounts;
            const provChips: Array<[string, number]> = [
              ["facts", c.fact],
              ["assumptions", c.assumption],
              ["calculations", c.calculation],
              ["generated", c.generated],
            ];
            return (
              <article key={run.id} className="rounded-xl border border-line bg-surface-1 p-4">
                <div className="flex items-center gap-2">
                  <span className="truncate text-sm font-semibold text-fg-primary">{label}</span>
                  <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider ${TIER_STYLE[run.approvalTier] ?? ""}`}>
                    {TIER_LABEL[run.approvalTier] ?? `Tier ${run.approvalTier}`}
                  </span>
                  <span className={`ml-auto shrink-0 font-mono text-[10px] uppercase tracking-wider ${statusClass}`}>
                    {run.status}
                  </span>
                </div>

                <p className="mt-1 text-xs text-fg-muted">
                  {run.executiveKey.replace(/_/g, " ")} · v{run.skillVersion}
                  {run.requiresApproval ? " · needs sign-off" : ""}
                </p>

                <div className="mt-3 flex flex-wrap gap-3 font-mono text-[10px] uppercase tracking-wider text-fg-secondary">
                  <span>confidence {pct(run.confidence)}</span>
                  <span>completeness {pct(run.completeness)}</span>
                </div>

                <div className="mt-3 flex flex-wrap gap-1.5">
                  {provChips
                    .filter(([, n]) => n > 0)
                    .map(([name, n]) => (
                      <span
                        key={name}
                        className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-secondary"
                      >
                        {n} {name}
                      </span>
                    ))}
                </div>

                {run.missingData.length > 0 && (
                  <p className="mt-3 border-t border-line pt-3 text-xs text-fg-muted">
                    <span className="font-mono uppercase tracking-wider">Missing (flagged, not invented): </span>
                    {run.missingData.join(", ")}
                  </p>
                )}
              </article>
            );
          })}
        </div>
      )}
    </section>
  );
}
