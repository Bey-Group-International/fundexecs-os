"use client";

// components/NextBestAction.tsx
// Rhythms AI-inspired Next Best Action panel.
import { useState } from "react";
import { useRouter } from "next/navigation";
import type { NBAItem } from "@/lib/next-best-action";

const ACTION_TYPE_META: Record<
  NBAItem["actionType"],
  { icon: string; label: string; color: string }
> = {
  contact_overdue: { icon: "◌", label: "Overdue", color: "text-red-400" },
  cadence_due: { icon: "○", label: "Cadence due", color: "text-amber-400" },
  meeting_prep: { icon: "◎", label: "Meeting prep", color: "text-blue-400" },
  deal_followup: { icon: "◈", label: "Deal follow-up", color: "text-gold-400" },
  lp_update: { icon: "▣", label: "LP update", color: "text-emerald-400" },
  intro_request: { icon: "⟳", label: "Intro", color: "text-purple-400" },
};

const PRIORITY_RING: (priority: number) => string = (p) =>
  p >= 90
    ? "border-red-500/40 bg-red-500/6"
    : p >= 75
      ? "border-amber-500/40 bg-amber-500/6"
      : p >= 60
        ? "border-gold-500/30 bg-gold-500/5"
        : "border-line bg-surface-1";

function NBACard({
  item,
  onDismiss,
  onLaunch,
}: {
  item: NBAItem;
  onDismiss: (id: string) => void;
  onLaunch: (prompt: string) => void;
}) {
  const meta = ACTION_TYPE_META[item.actionType];
  return (
    <div
      className={`group relative flex flex-col gap-2.5 rounded-xl border p-4 transition ${PRIORITY_RING(item.priority)}`}
    >
      <div className="flex items-center gap-2">
        <span className={`text-base ${meta.color}`} aria-hidden>
          {meta.icon}
        </span>
        <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
          {meta.label}
        </span>
        {item.priority >= 80 && (
          <span className="ml-auto rounded-full border border-red-500/30 bg-red-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-red-300">
            Priority
          </span>
        )}
      </div>

      <div>
        <p className="text-sm font-medium text-fg-primary">{item.title}</p>
        <p className="mt-0.5 text-xs leading-relaxed text-fg-secondary">{item.description}</p>
      </div>

      {item.contextSummary && (
        <p className="rounded-lg border border-line bg-surface-2/50 px-3 py-2 text-xs leading-relaxed text-fg-muted">
          {item.contextSummary}
        </p>
      )}

      <div className="flex items-center gap-2 pt-0.5">
        <button
          type="button"
          onClick={() => onLaunch(item.copilotPrompt)}
          className="inline-flex items-center gap-1.5 rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-gold-300 transition hover:border-gold-500/70 hover:bg-gold-500/20"
        >
          <span aria-hidden>◈</span>
          Ask Earn
        </button>
        <button
          type="button"
          onClick={() => onDismiss(item.id)}
          className="ml-auto font-mono text-[10px] text-fg-muted transition hover:text-fg-secondary"
        >
          Dismiss
        </button>
      </div>

      <button
        type="button"
        onClick={() => onDismiss(item.id)}
        aria-label="Dismiss"
        className="absolute right-1.5 top-1.5 hidden h-5 w-5 items-center justify-center rounded text-fg-muted transition hover:bg-surface-2 hover:text-fg-primary group-hover:flex"
      >
        ×
      </button>
    </div>
  );
}

interface Props {
  items: NBAItem[];
}

export function NextBestAction({ items }: Props) {
  const router = useRouter();
  const [dismissed, setDismissed] = useState<Set<string>>(new Set());
  const visible = items.filter((i) => !dismissed.has(i.id));

  function handleDismiss(id: string) {
    setDismissed((p) => new Set([...p, id]));
  }

  function handleLaunch(prompt: string) {
    const params = new URLSearchParams({ prompt });
    router.push(`/earn?${params.toString()}`);
  }

  if (visible.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface-1/50 px-4 py-6 text-center">
        <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
          All caught up
        </p>
        <p className="mt-1 text-xs text-fg-secondary">
          No priority actions today. Check back after new interactions.
        </p>
      </div>
    );
  }

  return (
    <section aria-label="Next best actions">
      <header className="mb-3 flex items-center justify-between">
        <span className="flex items-center gap-2 font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">
          <span className="h-1.5 w-1.5 rounded-full bg-gold-400 shadow-[0_0_6px_2px_rgba(212,175,106,0.4)]" aria-hidden />
          Today&apos;s Priority Actions
        </span>
        <span className="font-mono text-[10px] text-fg-muted">
          {visible.length} of {items.length}
        </span>
      </header>
      <div className="flex flex-col gap-3">
        {visible.map((item) => (
          <NBACard
            key={item.id}
            item={item}
            onDismiss={handleDismiss}
            onLaunch={handleLaunch}
          />
        ))}
      </div>
    </section>
  );
}
