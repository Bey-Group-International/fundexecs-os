// components/build/ReadinessReport.tsx
// Server component — GP data-room readiness audit before opening to LPs.

interface ReadinessSection {
  key: string;
  label: string;
  ready: boolean;
  qualityScore: number | null;
  qualityLevel: string | null;
  topGap: string | null;
  weight: number;
}

interface Props {
  sections: ReadinessSection[];
}

function levelClass(level: string | null): string {
  if (level === "Institutional") return "border-emerald-400/40 text-emerald-300";
  if (level === "Solid") return "border-gold-500/40 text-gold-300";
  return "border-line text-fg-muted";
}

function scoreBarColor(score: number): string {
  if (score >= 80) return "bg-emerald-400";
  if (score >= 50) return "bg-gold-400";
  return "bg-amber-500";
}

export function ReadinessReport({ sections }: Props) {
  // Weighted average overall score (weight by section weight, skip sections with no score)
  const scoredSections = sections.filter((s) => s.qualityScore != null);
  const totalWeight = scoredSections.reduce((acc, s) => acc + s.weight, 0);
  const weightedScore =
    totalWeight > 0
      ? Math.round(
          scoredSections.reduce((acc, s) => acc + (s.qualityScore ?? 0) * s.weight, 0) / totalWeight,
        )
      : null;

  // Priority sections: weight >= 12
  const prioritySections = sections.filter((s) => s.weight >= 12);
  const priorityEmpty = prioritySections.filter((s) => !s.ready && s.qualityLevel === null);
  const priorityDraft = prioritySections.filter(
    (s) => s.qualityLevel === "Draft" || (s.ready && s.qualityScore != null && s.qualityScore < 50),
  );
  const priorityOk = prioritySections.filter(
    (s) => s.qualityLevel === "Institutional" || s.qualityLevel === "Solid",
  );

  type Verdict = "share-ready" | "needs-work" | "not-ready";
  const verdict: Verdict =
    priorityEmpty.length > 0
      ? "not-ready"
      : priorityDraft.length > 0
        ? "needs-work"
        : "share-ready";

  const verdictConfig = {
    "share-ready": {
      label: "Share-ready",
      description: "All priority sections meet the institutional bar. You can open this data room to LPs.",
      classes: "border-emerald-500/30 bg-emerald-500/5 text-emerald-300",
      dot: "bg-emerald-400",
    },
    "needs-work": {
      label: "Needs work",
      description: "Some priority sections are at Draft level. Strengthen them before sharing with LPs.",
      classes: "border-amber-500/30 bg-amber-500/5 text-amber-300",
      dot: "bg-amber-400",
    },
    "not-ready": {
      label: "Not ready",
      description: "Key sections are empty. Complete them before opening the data room.",
      classes: "border-status-danger/30 bg-status-danger/5 text-status-danger",
      dot: "bg-status-danger",
    },
  } as const;

  const v = verdictConfig[verdict];

  return (
    <div className="flex flex-col gap-5">
      {/* Header */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-base font-semibold text-fg-primary">Data Room Readiness Report</h2>
          <p className="mt-0.5 text-xs text-fg-muted">
            Institutional quality audit across all data room sections.
          </p>
        </div>
        <button
          type="button"
          onClick={() => {
            if (typeof window !== "undefined") window.print();
          }}
          className="rounded-md border border-line px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-secondary transition hover:text-fg-primary print:hidden"
        >
          ⤓ Download report
        </button>
      </div>

      {/* Overall score */}
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-3">
        {/* Score tile */}
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-1 px-4 py-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Overall score</span>
          {weightedScore != null ? (
            <>
              <span className="font-display text-3xl font-semibold text-fg-primary">{weightedScore}%</span>
              <div className="h-1 overflow-hidden rounded-full bg-surface-2">
                <div
                  className={`h-full ${scoreBarColor(weightedScore)}`}
                  style={{ width: `${weightedScore}%` }}
                />
              </div>
            </>
          ) : (
            <span className="text-sm text-fg-muted">No documents scored yet</span>
          )}
        </div>

        {/* Sections covered */}
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-1 px-4 py-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Sections covered</span>
          <span className="font-display text-3xl font-semibold text-fg-primary">
            {sections.filter((s) => s.ready).length}
            <span className="text-lg text-fg-muted">/{sections.length}</span>
          </span>
          <div className="h-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full bg-gold-400"
              style={{ width: `${Math.round((sections.filter((s) => s.ready).length / Math.max(sections.length, 1)) * 100)}%` }}
            />
          </div>
        </div>

        {/* Institutional docs */}
        <div className="flex flex-col gap-2 rounded-xl border border-line bg-surface-1 px-4 py-3">
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Institutional sections</span>
          <span className="font-display text-3xl font-semibold text-emerald-300">
            {sections.filter((s) => s.qualityLevel === "Institutional").length}
            <span className="text-lg text-fg-muted">/{sections.length}</span>
          </span>
          <div className="h-1 overflow-hidden rounded-full bg-surface-2">
            <div
              className="h-full bg-emerald-400"
              style={{
                width: `${Math.round(
                  (sections.filter((s) => s.qualityLevel === "Institutional").length / Math.max(sections.length, 1)) * 100,
                )}%`,
              }}
            />
          </div>
        </div>
      </div>

      {/* Verdict banner */}
      <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${v.classes}`}>
        <span className={`h-2 w-2 shrink-0 rounded-full ${v.dot}`} />
        <div className="flex min-w-0 flex-col gap-0.5">
          <span className="font-mono text-[10px] uppercase tracking-wider">{v.label}</span>
          <span className="text-sm">{v.description}</span>
        </div>
      </div>

      {/* Per-section table */}
      <div className="flex flex-col gap-0 overflow-hidden rounded-xl border border-line bg-surface-0">
        {/* Table header */}
        <div className="grid grid-cols-[1fr_80px_90px_1fr] items-center gap-3 border-b border-line bg-surface-1 px-4 py-2">
          <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Section</span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Score</span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Level</span>
          <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Top gap</span>
        </div>

        {sections.map((s, i) => (
          <div
            key={s.key}
            className={`grid grid-cols-[1fr_80px_90px_1fr] items-center gap-3 px-4 py-2.5 ${
              i < sections.length - 1 ? "border-b border-line/50" : ""
            } ${s.weight >= 12 ? "bg-surface-0" : "bg-surface-0/60"}`}
          >
            {/* Label */}
            <div className="flex min-w-0 items-center gap-2">
              <span className={`truncate text-sm ${s.ready ? "text-fg-primary" : "text-fg-secondary"}`}>
                {s.label}
              </span>
              {s.weight >= 12 && (
                <span className="shrink-0 rounded-full bg-amber-500/10 px-1.5 py-0.5 font-mono text-[8px] uppercase tracking-wider text-amber-400">
                  Priority
                </span>
              )}
              {!s.ready && (
                <span className="shrink-0 font-mono text-[9px] text-fg-muted">Empty</span>
              )}
            </div>

            {/* Score */}
            <div className="flex flex-col gap-0.5">
              {s.qualityScore != null ? (
                <>
                  <span className="font-mono text-xs text-fg-primary">{s.qualityScore}%</span>
                  <div className="h-0.5 w-full overflow-hidden rounded-full bg-surface-2">
                    <div
                      className={`h-full ${scoreBarColor(s.qualityScore)}`}
                      style={{ width: `${s.qualityScore}%` }}
                    />
                  </div>
                </>
              ) : (
                <span className="font-mono text-xs text-fg-muted">—</span>
              )}
            </div>

            {/* Level pill */}
            <div>
              {s.qualityLevel ? (
                <span
                  className={`inline-flex rounded-full border px-2 py-0.5 font-mono text-[8px] uppercase tracking-wider ${levelClass(s.qualityLevel)}`}
                >
                  {s.qualityLevel}
                </span>
              ) : (
                <span className="font-mono text-[9px] text-fg-muted">—</span>
              )}
            </div>

            {/* Top gap */}
            <p className="truncate text-xs text-fg-muted" title={s.topGap ?? undefined}>
              {s.topGap ?? (s.ready ? "No gaps" : "Add a document to score this section.")}
            </p>
          </div>
        ))}
      </div>

      {/* Print styles (injected inline for server component compatibility) */}
      <style
        // eslint-disable-next-line react/no-danger
        dangerouslySetInnerHTML={{
          __html: `
            @media print {
              body { background: white; color: black; }
              .print\\:hidden { display: none !important; }
            }
          `,
        }}
      />
    </div>
  );
}
