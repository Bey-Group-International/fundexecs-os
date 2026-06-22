// lib/deal-intelligence.ts
// Deal Intelligence Feed — CB Insights clone.
// Sector tagging, signal classification, thesis match scoring, heatmap data.

export type SignalType =
  | "funding_round"
  | "acquisition"
  | "ipo"
  | "bankruptcy"
  | "exec_change"
  | "partnership"
  | "market_entry"
  | "exit"
  | "lp_activity"
  | "regulatory";

export type ActivityLevel = "low" | "moderate" | "high" | "very_high";

export interface DealSignal {
  id: string;
  signalType: SignalType;
  title: string;
  summary?: string;
  sector?: string;
  geography?: string;
  companyName?: string;
  dealSizeMin?: number | null;
  dealSizeMax?: number | null;
  dealStage?: string;
  relevanceScore: number;
  thesisMatchScore: number;
  sourceUrl?: string;
  publishedAt?: string;
  readAt?: string | null;
  savedAt?: string | null;
}

export interface HeatmapCell {
  sector: string;
  stage: string;
  dealCount: number;
  totalValue?: number;
  activityLevel: ActivityLevel;
  yoyChangePct?: number | null;
}

export const SIGNAL_TYPE_LABELS: Record<SignalType, string> = {
  funding_round: "Funding Round",
  acquisition: "Acquisition",
  ipo: "IPO",
  bankruptcy: "Bankruptcy",
  exec_change: "Leadership Change",
  partnership: "Partnership",
  market_entry: "Market Entry",
  exit: "Exit",
  lp_activity: "LP Activity",
  regulatory: "Regulatory",
};

export const SIGNAL_TYPE_ICONS: Record<SignalType, string> = {
  funding_round: "◈",
  acquisition: "⊕",
  ipo: "▲",
  bankruptcy: "▼",
  exec_change: "○",
  partnership: "⟷",
  market_entry: "→",
  exit: "◎",
  lp_activity: "◆",
  regulatory: "⊞",
};

export const SIGNAL_TYPE_COLORS: Record<SignalType, string> = {
  funding_round: "text-emerald-400 border-emerald-500/30",
  acquisition: "text-gold-400 border-gold-500/30",
  ipo: "text-blue-400 border-blue-500/30",
  bankruptcy: "text-red-400 border-red-500/30",
  exec_change: "text-slate-400 border-slate-500/30",
  partnership: "text-purple-400 border-purple-500/30",
  market_entry: "text-amber-400 border-amber-500/30",
  exit: "text-emerald-300 border-emerald-500/20",
  lp_activity: "text-gold-300 border-gold-500/20",
  regulatory: "text-slate-300 border-slate-500/20",
};

export const ACTIVITY_COLORS: Record<ActivityLevel, { bg: string; text: string; border: string }> = {
  low: { bg: "bg-slate-500/10", text: "text-slate-400", border: "border-slate-500/20" },
  moderate: { bg: "bg-blue-500/15", text: "text-blue-300", border: "border-blue-500/20" },
  high: { bg: "bg-amber-500/20", text: "text-amber-300", border: "border-amber-500/30" },
  very_high: { bg: "bg-gold-500/25", text: "text-gold-300", border: "border-gold-500/40" },
};

// Format signal size
export function formatSignalSize(min: number | null | undefined, max: number | null | undefined): string {
  if (!min && !max) return "—";
  const val = max ?? min!;
  if (val >= 1_000_000_000) return `$${(val / 1_000_000_000).toFixed(1)}B`;
  if (val >= 1_000_000) return `$${(val / 1_000_000).toFixed(0)}M`;
  return `$${(val / 1_000).toFixed(0)}K`;
}

// Time-ago label
export function timeAgo(isoDate: string | undefined): string {
  if (!isoDate) return "";
  const ms = Date.now() - new Date(isoDate).getTime();
  const d = Math.floor(ms / 86400000);
  if (d === 0) return "Today";
  if (d === 1) return "Yesterday";
  if (d < 7) return `${d}d ago`;
  if (d < 30) return `${Math.floor(d / 7)}w ago`;
  return `${Math.floor(d / 30)}mo ago`;
}

// Build a simple heatmap from deal signals
export function buildHeatmap(signals: DealSignal[]): HeatmapCell[] {
  const counter = new Map<string, { count: number; value: number }>();
  for (const s of signals) {
    if (!s.sector || !s.dealStage) continue;
    const key = `${s.sector}||${s.dealStage}`;
    const existing = counter.get(key) ?? { count: 0, value: 0 };
    counter.set(key, {
      count: existing.count + 1,
      value: existing.value + (s.dealSizeMax ?? s.dealSizeMin ?? 0),
    });
  }

  return Array.from(counter.entries()).map(([key, { count, value }]) => {
    const [sector, stage] = key.split("||");
    const activityLevel: ActivityLevel =
      count >= 10 ? "very_high" : count >= 5 ? "high" : count >= 2 ? "moderate" : "low";
    return {
      sector,
      stage,
      dealCount: count,
      totalValue: value,
      activityLevel,
    };
  });
}
