"use client";

import Link from "next/link";
import { compactCurrency } from "./format";
import { SwipeableCard, type SwipeAction } from "./SwipeableCard";
import { TaskIcon, DataRoomIcon, SparkIcon } from "./icons";
import { haptic } from "./haptics";

export interface MobileDeal {
  id: string;
  name: string;
  stageLabel: string;
  stage: string;
  targetAmount: number | null;
  sector: string | null;
  geography: string | null;
  thesisFit: number | null;
  href: string;
  nextStep?: string | null;
}

// Stage → accent tone. Warm gold for live pipeline, neural blue for execution,
// muted for terminal states.
const STAGE_TONE: Record<string, string> = {
  sourced: "text-fg-secondary border-line",
  screening: "text-neural-300 border-neural-400/40",
  diligence: "text-neural-300 border-neural-400/40",
  underwriting: "text-gold-400 border-gold-500/40",
  ic_review: "text-gold-400 border-gold-500/40",
  closing: "text-status-success border-status-success/40",
  owned: "text-status-success border-status-success/40",
  exited: "text-fg-muted border-line",
  passed: "text-fg-muted border-line",
  dead: "text-fg-muted border-line",
};

// A scannable, tappable deal card for the mobile pipeline. Summary-first:
// name, stage, one key metric, and a next-step prompt. Tap opens the deal;
// swipe left reveals one-tap actions (task, data room, Earn) so the most common
// moves are reachable without opening the record. The revealed strip must stay
// behind an opaque card face, so the surface is fully opaque (not /70).
export function MobileDealCard({ deal }: { deal: MobileDeal }) {
  const amount = compactCurrency(deal.targetAmount);
  const fit = deal.thesisFit != null ? Math.round(deal.thesisFit * (deal.thesisFit <= 1 ? 100 : 1)) : null;
  const tone = STAGE_TONE[deal.stage] ?? "text-fg-secondary border-line";

  const actions: SwipeAction[] = [
    {
      key: "task",
      label: "Task",
      icon: TaskIcon,
      href: `/earn?ask=${encodeURIComponent(`Create a task to advance ${deal.name}`)}`,
      tone: "neutral",
    },
    { key: "docs", label: "Docs", icon: DataRoomIcon, href: "/build/data_room", tone: "neutral" },
    {
      key: "earn",
      label: "Ask Earn",
      icon: SparkIcon,
      href: `/earn?ask=${encodeURIComponent(`What is the next best step on ${deal.name}?`)}`,
      tone: "gold",
    },
  ];

  return (
    <SwipeableCard actions={actions}>
      <Link
        href={deal.href}
        onClick={() => haptic("tap")}
        className="fx-tap group block rounded-2xl border border-line/60 bg-surface-1 p-3.5 transition active:scale-[0.99] active:bg-surface-2"
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0">
            <p className="truncate text-[15px] font-semibold leading-tight text-fg-primary">{deal.name}</p>
            <p className="mt-1 truncate text-[12px] text-fg-secondary">
              {[deal.sector, deal.geography].filter(Boolean).join(" · ") || "Private markets"}
            </p>
          </div>
          <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wide ${tone}`}>
            {deal.stageLabel}
          </span>
        </div>

        <div className="mt-3 flex items-center gap-3">
          {amount && (
            <span className="rounded-lg border border-gold-500/20 bg-gold-500/[0.06] px-2 py-1 font-mono text-[12px] font-semibold text-gold-300">
              {amount}
            </span>
          )}
          {fit != null && (
            <span className="flex items-center gap-1.5 text-[11px] text-fg-secondary">
              <span aria-hidden className="text-neural-300">◇</span>
              {fit}% fit
            </span>
          )}
          <span aria-hidden className="ml-auto text-fg-muted transition group-hover:translate-x-0.5 group-hover:text-gold-400">
            ›
          </span>
        </div>

        {deal.nextStep && (
          <p className="mt-2.5 flex items-start gap-1.5 rounded-lg border border-neural-400/20 bg-neural-400/[0.05] px-2 py-1.5 text-[11.5px] leading-snug text-neural-300">
            <span aria-hidden className="mt-px">✦</span>
            <span className="min-w-0">{deal.nextStep}</span>
          </p>
        )}
      </Link>
    </SwipeableCard>
  );
}
