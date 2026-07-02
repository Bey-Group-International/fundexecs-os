"use client";

export interface GPScorecard {
  overallScore: number;
  trackRecord: { score: number; moicAvg: number | null; irrAvg: number | null; dealCount: number };
  teamStrength: { score: number; seniorYears: number | null; boardSeats: number | null };
  thesisClarity: { score: number; sectorsCount: number; stagesCount: number };
  networkReach: { score: number; lpRelationships: number; coInvestors: number };
  operationalReadiness: { score: number; hasAuditor: boolean; hasCounsel: boolean; hasAdmin: boolean };
}

function scoreColor(score: number): string {
  if (score >= 70) return "text-emerald-300";
  if (score >= 40) return "text-gold-400";
  return "text-fg-muted";
}

function barColor(score: number): string {
  if (score >= 70) return "bg-emerald-300";
  if (score >= 40) return "bg-gold-400";
  return "bg-fg-muted";
}

function Pill({ label, value }: { label: string; value: string | number }) {
  return (
    <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-surface-1 border border-line text-xs font-mono text-fg-secondary">
      <span className="text-fg-muted">{label}</span>
      <span className="text-fg-primary">{value}</span>
    </span>
  );
}

function ScoreBar({ score }: { score: number }) {
  return (
    <div className="h-1.5 w-full rounded-full bg-surface-1 overflow-hidden">
      <div
        className={`h-full rounded-full transition-all ${barColor(score)}`}
        style={{ width: `${Math.max(score, 2)}%` }}
      />
    </div>
  );
}

function DimensionRow({
  label,
  score,
  pills,
}: {
  label: string;
  score: number;
  pills: { label: string; value: string | number }[];
}) {
  return (
    <div className="flex flex-col gap-1.5 py-3 border-b border-line last:border-b-0">
      <div className="flex items-center justify-between">
        <span className="text-sm text-fg-secondary">{label}</span>
        <span className={`text-sm font-mono font-semibold ${scoreColor(score)}`}>{score}</span>
      </div>
      <ScoreBar score={score} />
      {pills.length > 0 && (
        <div className="flex flex-wrap gap-1.5 mt-0.5">
          {pills.map((p) => (
            <Pill key={p.label} label={p.label} value={p.value} />
          ))}
        </div>
      )}
    </div>
  );
}

export function GPProfileScorecard({ scorecard }: { scorecard: GPScorecard }) {
  const { overallScore, trackRecord, teamStrength, thesisClarity, networkReach, operationalReadiness } = scorecard;

  const r = 28;
  const circ = 2 * Math.PI * r;
  const offset = circ * (1 - overallScore / 100);
  const ringColor =
    overallScore >= 70 ? "#6ee7b7" : overallScore >= 40 ? "#fbbf24" : "#6b7280";

  const opPills: { label: string; value: string | number }[] = [
    { label: "Auditor", value: operationalReadiness.hasAuditor ? "Yes" : "No" },
    { label: "Counsel", value: operationalReadiness.hasCounsel ? "Yes" : "No" },
    { label: "Admin", value: operationalReadiness.hasAdmin ? "Yes" : "No" },
  ];

  const trackPills: { label: string; value: string | number }[] = [
    { label: "Deals", value: trackRecord.dealCount },
    ...(trackRecord.moicAvg !== null ? [{ label: "MOIC avg", value: `${trackRecord.moicAvg.toFixed(1)}x` }] : []),
    ...(trackRecord.irrAvg !== null ? [{ label: "IRR avg", value: `${trackRecord.irrAvg.toFixed(0)}%` }] : []),
  ];

  const teamPills: { label: string; value: string | number }[] = [
    ...(teamStrength.seniorYears !== null ? [{ label: "Sr. yrs", value: teamStrength.seniorYears }] : []),
    ...(teamStrength.boardSeats !== null ? [{ label: "Board seats", value: teamStrength.boardSeats }] : []),
  ];

  const thesisPills: { label: string; value: string | number }[] = [
    { label: "Sectors", value: thesisClarity.sectorsCount },
    { label: "Stages", value: thesisClarity.stagesCount },
  ];

  const networkPills: { label: string; value: string | number }[] = [
    { label: "LP rels.", value: networkReach.lpRelationships },
    { label: "Co-inv.", value: networkReach.coInvestors },
  ];

  return (
    <div className="bg-surface-0 border border-line rounded-2xl p-6 flex flex-col gap-6 w-full max-w-md">
      <div className="flex flex-col gap-0.5">
        <h2 className="font-display text-lg font-semibold text-fg-primary">GP Profile Scorecard</h2>
        <p className="text-xs text-fg-muted">
          GPLPMatch-style attractiveness scoring across five LP evaluation dimensions.
        </p>
      </div>

      <div className="flex items-center gap-6">
        <div className="relative flex-shrink-0 flex items-center justify-center" style={{ width: 72, height: 72 }}>
          <svg width={72} height={72} viewBox="0 0 72 72" className="-rotate-90">
            <circle
              cx={36}
              cy={36}
              r={r}
              fill="none"
              stroke="currentColor"
              strokeWidth={6}
              className="text-surface-1"
            />
            <circle
              cx={36}
              cy={36}
              r={r}
              fill="none"
              stroke={ringColor}
              strokeWidth={6}
              strokeLinecap="round"
              strokeDasharray={circ}
              strokeDashoffset={offset}
            />
          </svg>
          <span
            className="absolute font-mono font-bold text-lg"
            style={{ color: ringColor }}
          >
            {overallScore}
          </span>
        </div>

        <div className="flex flex-col gap-0.5">
          <span className="text-xs text-fg-muted uppercase tracking-widest font-mono">Overall Score</span>
          <span className={`text-2xl font-display font-bold ${scoreColor(overallScore)}`}>
            {overallScore >= 70 ? "Strong" : overallScore >= 40 ? "Developing" : "Early Stage"}
          </span>
          <span className="text-xs text-fg-muted">out of 100</span>
        </div>
      </div>

      <div className="flex flex-col">
        <DimensionRow label="Track Record" score={trackRecord.score} pills={trackPills} />
        <DimensionRow label="Team Strength" score={teamStrength.score} pills={teamPills} />
        <DimensionRow label="Thesis Clarity" score={thesisClarity.score} pills={thesisPills} />
        <DimensionRow label="Network Reach" score={networkReach.score} pills={networkPills} />
        <DimensionRow label="Operational Readiness" score={operationalReadiness.score} pills={opPills} />
      </div>
    </div>
  );
}
