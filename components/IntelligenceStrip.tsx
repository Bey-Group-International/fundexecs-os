"use client";

// components/IntelligenceStrip.tsx
// Meridian AI-inspired intelligence strip
import { useState } from "react";
import type { DecayAlert } from "@/lib/relationship-score";

export interface IntelligenceInsight {
  id: string;
  type: "warning" | "opportunity" | "info" | "alert";
  icon: string;
  headline: string;
  detail: string;
  actionLabel?: string;
  actionHref?: string;
}

interface Props {
  insights: IntelligenceInsight[];
}

const TYPE_STYLES = {
  warning: {
    border: "border-amber-500/30",
    bg: "bg-amber-500/8",
    icon: "text-amber-400",
    dot: "bg-amber-400",
    pill: "border-amber-500/30 bg-amber-500/10 text-amber-300",
  },
  opportunity: {
    border: "border-emerald-500/30",
    bg: "bg-emerald-500/8",
    icon: "text-emerald-400",
    dot: "bg-emerald-400",
    pill: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  },
  info: {
    border: "border-blue-500/30",
    bg: "bg-blue-500/8",
    icon: "text-blue-400",
    dot: "bg-blue-400",
    pill: "border-blue-500/30 bg-blue-500/10 text-blue-300",
  },
  alert: {
    border: "border-red-500/30",
    bg: "bg-red-500/8",
    icon: "text-red-400",
    dot: "bg-red-400",
    pill: "border-red-500/30 bg-red-500/10 text-red-300",
  },
};

const TYPE_LABELS = {
  warning: "Watch",
  opportunity: "Opportunity",
  info: "Insight",
  alert: "Alert",
};

function InsightCard({ insight }: { insight: IntelligenceInsight }) {
  const styles = TYPE_STYLES[insight.type];
  return (
    <div
      className={`flex min-w-[260px] max-w-[300px] shrink-0 flex-col gap-2 rounded-xl border ${styles.border} ${styles.bg} p-3.5 transition hover:border-gold-500/30`}
    >
      <div className="flex items-center gap-2">
        <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${styles.dot} shadow-[0_0_6px_1px_rgba(255,255,255,0.15)]`} />
        <span
          className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${styles.pill}`}
        >
          {TYPE_LABELS[insight.type]}
        </span>
        <span className={`ml-auto text-base ${styles.icon}`} aria-hidden>
          {insight.icon}
        </span>
      </div>
      <p className="text-sm font-medium leading-snug text-fg-primary">{insight.headline}</p>
      <p className="text-xs leading-relaxed text-fg-secondary">{insight.detail}</p>
      {insight.actionLabel && insight.actionHref && (
        <a
          href={insight.actionHref}
          className="mt-auto inline-flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-gold-400 transition hover:text-gold-300"
        >
          {insight.actionLabel}
          <span aria-hidden>→</span>
        </a>
      )}
    </div>
  );
}

export function IntelligenceStrip({ insights }: Props) {
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = insights.filter((i) => !dismissed.has(i.id));

  if (visible.length === 0) return null;

  return (
    <section aria-label="Intelligence insights" className="relative">
      <div className="mb-2 flex items-center justify-between">
        <span className="flex items-center gap-2 font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">
          <span className="h-1 w-1 rounded-full bg-gold-400/60" aria-hidden />
          Earn Intelligence
        </span>
        <span className="font-mono text-[10px] text-fg-muted">
          {visible.length} insight{visible.length !== 1 ? "s" : ""}
        </span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-none">
        {visible.map((insight) => (
          <div key={insight.id} className="group relative">
            <InsightCard insight={insight} />
            <button
              type="button"
              onClick={() => setDismissed((p) => new Set([...p, insight.id]))}
              aria-label={`Dismiss: ${insight.headline}`}
              className="absolute right-1.5 top-1.5 hidden h-5 w-5 items-center justify-center rounded text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary group-hover:flex"
            >
              ×
            </button>
          </div>
        ))}
      </div>
    </section>
  );
}

// Build insights from relationship scores + decay alerts
export function buildInsights(params: {
  decayAlerts: DecayAlert[];
  totalInvestors: number;
  committedCount: number;
  warmCount: number;
}): IntelligenceInsight[] {
  const { decayAlerts, totalInvestors, committedCount, warmCount } = params;
  const insights: IntelligenceInsight[] = [];

  const criticalDecay = decayAlerts.filter((a) => a.priority === "critical").length;
  const highDecay = decayAlerts.filter((a) => a.priority === "high").length;
  const totalDecay = decayAlerts.length;

  if (criticalDecay > 0) {
    insights.push({
      id: "decay-critical",
      type: "alert",
      icon: "⚠",
      headline: `${criticalDecay} LP relationship${criticalDecay > 1 ? "s" : ""} going cold`,
      detail: `${criticalDecay} investor${criticalDecay > 1 ? "s" : ""} haven't been contacted in 90+ days. Critical — re-engage now before they disengage entirely.`,
      actionLabel: "View relationships",
      actionHref: "/capital-map",
    });
  } else if (highDecay > 0) {
    insights.push({
      id: "decay-high",
      type: "warning",
      icon: "○",
      headline: `${highDecay} investor${highDecay > 1 ? "s" : ""} need attention`,
      detail: `${highDecay} LP${highDecay > 1 ? "s" : ""} haven't been contacted in 60+ days. Start outreach before momentum fades.`,
      actionLabel: "Start outreach",
      actionHref: "/capital-map",
    });
  } else if (totalDecay > 0) {
    insights.push({
      id: "decay-medium",
      type: "info",
      icon: "◎",
      headline: `${totalDecay} contact${totalDecay > 1 ? "s" : ""} due for a touch`,
      detail: `${totalDecay} relationship${totalDecay > 1 ? "s" : ""} are 30+ days silent. A brief check-in keeps momentum.`,
      actionLabel: "View cadences",
      actionHref: "/capital-map",
    });
  }

  if (totalInvestors > 0 && committedCount > 0) {
    const pct = Math.round((committedCount / totalInvestors) * 100);
    insights.push({
      id: "committed-ratio",
      type: "opportunity",
      icon: "◈",
      headline: `${committedCount} committed LP${committedCount > 1 ? "s" : ""} · ${pct}% of network`,
      detail: `${warmCount} additional investor${warmCount !== 1 ? "s" : ""} are warm and unadvanced. Each is a conversion opportunity.`,
      actionLabel: "Advance warm LPs",
      actionHref: "/capital-map",
    });
  }

  if (warmCount >= 3) {
    insights.push({
      id: "warm-pipeline",
      type: "opportunity",
      icon: "→",
      headline: `${warmCount} warm LPs ready to advance`,
      detail: `These investors have shown interest but haven't been moved to active diligence. A targeted outreach now could accelerate your raise.`,
      actionLabel: "Start sequences",
      actionHref: "/source/lp_pipeline",
    });
  }

  return insights;
}
