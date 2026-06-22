import type { EntityInsights } from "@/lib/entity-insights";

const TYPE_LABEL: Record<string, string> = {
  gp: "GP",
  management_co: "Mgmt Co",
  fund: "Funds",
  spv: "SPVs",
  holdco: "Holdcos",
  other: "Other",
};

function Stat({ value, label, tone }: { value: string; label: string; tone?: "warn" }) {
  return (
    <div className="rounded-lg border border-line bg-surface-0 px-3 py-2">
      <p className={`font-display text-xl font-semibold leading-none ${tone === "warn" ? "text-status-warning" : "text-fg-primary"}`}>
        {value}
      </p>
      <p className="mt-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</p>
    </div>
  );
}

// Overview header for the Entity workspace — leads with structure + ownership
// health so the page opens with signal, not a wall of forms.
export function EntityInsights({ insights }: { insights: EntityInsights }) {
  const { entityCount, stakeholderCount, unlinkedStakeholders, byType, imbalanced, topConcentration } = insights;
  const typeSummary = byType.map((t) => `${t.count} ${TYPE_LABEL[t.type] ?? t.type}`).join(" · ");

  return (
    <div className="mb-5 rounded-2xl border border-line bg-surface-1 p-5">
      <div className="mb-3 flex items-center gap-2">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">Structure &amp; ownership</span>
        {topConcentration ? (
          <span className="ml-auto font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Top holder {topConcentration.pct}% · {topConcentration.entityName}
          </span>
        ) : null}
      </div>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <Stat value={String(entityCount)} label={entityCount === 1 ? "entity" : "entities"} />
        <Stat value={String(stakeholderCount)} label="stakeholders" />
        <Stat
          value={unlinkedStakeholders > 0 ? String(unlinkedStakeholders) : "0"}
          label="unlinked"
          tone={unlinkedStakeholders > 0 ? "warn" : undefined}
        />
        <Stat
          value={imbalanced.length > 0 ? String(imbalanced.length) : "✓"}
          label={imbalanced.length > 0 ? "need 100%" : "balanced"}
          tone={imbalanced.length > 0 ? "warn" : undefined}
        />
      </div>
      {typeSummary ? <p className="mt-2 text-xs text-fg-muted">{typeSummary}</p> : null}
      {imbalanced.length > 0 ? (
        <p className="mt-2 rounded-lg border border-status-warning/30 bg-status-warning/5 px-3 py-1.5 text-xs text-fg-secondary">
          Ownership doesn&apos;t total 100% for: {imbalanced.map((i) => `${i.name} (${i.totalPct}%)`).join(", ")}.
        </p>
      ) : null}
    </div>
  );
}
