// components/activity/ActivityFeed.tsx — the cross-hub timeline.
//
// Renders activity grouped by day (mono-uppercase headings), each entry showing
// the authoring agent badge, the hub chip, the title, a status pill, a relative
// timestamp, and a deep link into the originating session when present.
//
// Client component so filter pills can run without a round-trip to the server.
"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import Link from "next/link";
import {
  groupByDay,
  relativeTime,
  statusTone,
  statusLabel,
  type ActivityEntry,
  type StatusTone,
} from "@/lib/activity";
import { AGENT_BY_KEY } from "@/lib/agents";
import { HUB_BY_KEY } from "@/lib/hubs";
import type { Hub, TaskStatus } from "@/lib/supabase/database.types";
import { deleteActivityEntry, clearActivity } from "@/app/(app)/activity/actions";

const TONE_CLASS: Record<StatusTone, string> = {
  active: "border-cyan-500/40 bg-cyan-500/10 text-cyan-300",
  pending: "border-gold-500/40 bg-gold-500/10 text-gold-300",
  done: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300",
  blocked: "border-red-500/40 bg-red-500/10 text-red-300",
  muted: "border-line bg-surface-2 text-fg-muted",
};

function StatusPill({ entry }: { entry: ActivityEntry }) {
  const tone = statusTone(entry.status);
  return (
    <span
      className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${TONE_CLASS[tone]}`}
    >
      {statusLabel(entry.status)}
    </span>
  );
}

function AgentBadge({ entry }: { entry: ActivityEntry }) {
  const agent = entry.agent ? AGENT_BY_KEY[entry.agent] : undefined;
  if (!agent) return null;
  return (
    <span className="inline-flex items-center gap-1.5 text-xs text-fg-secondary">
      <span
        className="h-2 w-2 shrink-0 rounded-full"
        style={{ backgroundColor: agent.color }}
        aria-hidden
      />
      {agent.name}
    </span>
  );
}

function HubChip({ entry }: { entry: ActivityEntry }) {
  const hub = entry.hub ? HUB_BY_KEY[entry.hub] : undefined;
  if (!hub) return null;
  return (
    <span className="rounded-full border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
      {hub.label}
    </span>
  );
}

function DeleteEntryButton({ entry, onDeleted }: { entry: ActivityEntry; onDeleted: () => void }) {
  const [pending, startTransition] = useTransition();

  function handleClick() {
    if (pending) return;
    startTransition(async () => {
      const res = await deleteActivityEntry(entry.id);
      if (res.ok) onDeleted();
    });
  }

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={pending}
      aria-label="Delete entry"
      title="Delete"
      className="shrink-0 rounded-full border border-line px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted transition hover:border-red-500/40 hover:bg-red-500/10 hover:text-red-300 disabled:opacity-50"
    >
      {pending ? "…" : "Delete"}
    </button>
  );
}

function EntryRow({ entry, onDeleted }: { entry: ActivityEntry; onDeleted: () => void }) {
  return (
    <div className="flex items-start gap-3 rounded-xl border border-line bg-surface-1 p-4">
      <span
        className={`mt-1.5 h-2 w-2 shrink-0 rounded-full ${
          entry.kind === "artifact" ? "bg-gold-400/70" : "bg-cyan-400/70"
        }`}
        aria-label={entry.kind}
      />
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="text-sm font-medium text-fg-primary">{entry.title}</span>
          <HubChip entry={entry} />
          {entry.kind === "artifact" ? (
            <span className="rounded-full border border-gold-500/30 bg-gold-500/5 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300/80">
              Artifact
            </span>
          ) : null}
          <StatusPill entry={entry} />
          <span className="ml-auto" />
          <DeleteEntryButton entry={entry} onDeleted={onDeleted} />
        </div>

        {entry.summary ? (
          <p className="mt-1 line-clamp-2 text-xs leading-snug text-fg-secondary">
            {entry.summary}
          </p>
        ) : null}

        <div className="mt-1.5 flex flex-wrap items-center gap-x-3 gap-y-1">
          <AgentBadge entry={entry} />
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            {relativeTime(entry.when)}
          </span>
          {entry.sessionId ? (
            <Link
              href={`/session/${entry.sessionId}`}
              className="font-mono text-[10px] uppercase tracking-wider text-gold-400 transition hover:text-gold-300"
            >
              Open session →
            </Link>
          ) : null}
        </div>
      </div>
    </div>
  );
}

// Filter pill options
type StatusFilter = TaskStatus | "all";
type HubFilter = Hub | "all";

const STATUS_FILTERS: { label: string; value: StatusFilter }[] = [
  { label: "All", value: "all" },
  { label: "Active", value: "in_progress" },
  { label: "Awaiting", value: "awaiting_approval" },
  { label: "Completed", value: "completed" },
];

const HUB_FILTERS: { label: string; value: HubFilter }[] = [
  { label: "All hubs", value: "all" },
  { label: "Build", value: "build" },
  { label: "Source", value: "source" },
  { label: "Run", value: "run" },
  { label: "Execute", value: "execute" },
];

export function ActivityFeed({ entries }: { entries: ActivityEntry[] }) {
  const router = useRouter();
  const [statusFilter, setStatusFilter] = useState<StatusFilter>("all");
  const [hubFilter, setHubFilter] = useState<HubFilter>("all");
  const [clearing, startClear] = useTransition();

  function handleClearAll() {
    if (clearing) return;
    const ok = window.confirm(
      "Clear all activity? This permanently deletes every workflow and its produced artifacts across all hubs. This cannot be undone.",
    );
    if (!ok) return;
    startClear(async () => {
      const res = await clearActivity();
      if (res.ok) router.refresh();
    });
  }

  const filtered = entries.filter((e) => {
    if (statusFilter !== "all" && e.status !== statusFilter) return false;
    if (hubFilter !== "all" && e.hub !== hubFilter) return false;
    return true;
  });

  const groups = groupByDay(filtered);

  return (
    <div className="flex flex-col gap-6">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        {/* Status filters */}
        <div className="flex flex-wrap gap-1.5">
          {STATUS_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setStatusFilter(f.value)}
              className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition ${
                statusFilter === f.value
                  ? "border-gold-500/60 bg-gold-500/15 text-gold-300"
                  : "border-line bg-surface-1 text-fg-muted hover:border-gold-500/30 hover:text-fg-secondary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        <span className="hidden h-4 w-px bg-line sm:block" aria-hidden />

        {/* Hub filters */}
        <div className="flex flex-wrap gap-1.5">
          {HUB_FILTERS.map((f) => (
            <button
              key={f.value}
              onClick={() => setHubFilter(f.value)}
              className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition ${
                hubFilter === f.value
                  ? "border-gold-500/60 bg-gold-500/15 text-gold-300"
                  : "border-line bg-surface-1 text-fg-muted hover:border-gold-500/30 hover:text-fg-secondary"
              }`}
            >
              {f.label}
            </button>
          ))}
        </div>

        {/* Result count */}
        {(statusFilter !== "all" || hubFilter !== "all") && (
          <span className="ml-auto font-mono text-[10px] text-fg-muted">
            {filtered.length} result{filtered.length !== 1 ? "s" : ""}
          </span>
        )}

        {/* Clear all — permanently deletes every workflow + its artifacts. */}
        {entries.length > 0 && (
          <button
            type="button"
            onClick={handleClearAll}
            disabled={clearing}
            className={`rounded-full border border-red-500/40 bg-red-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-red-300 transition hover:bg-red-500/20 disabled:opacity-50 ${
              statusFilter !== "all" || hubFilter !== "all" ? "" : "ml-auto"
            }`}
          >
            {clearing ? "Clearing…" : "Clear all"}
          </button>
        )}
      </div>

      {/* Timeline */}
      {filtered.length === 0 ? (
        <p className="rounded-xl border border-dashed border-line bg-surface-1 p-6 text-center text-sm text-fg-muted">
          {entries.length === 0
            ? "Nothing yet. As Earn and the agent team run workflows across your hubs, their work appears here as one timeline."
            : "No activity matches the current filters."}
        </p>
      ) : (
        <div className="flex flex-col gap-8">
          {groups.map((group) => (
            <section key={group.day}>
              <h2 className="mb-3 font-mono text-[11px] uppercase tracking-[0.25em] text-fg-muted">
                {group.label}
              </h2>
              <div className="flex flex-col gap-2">
                {group.entries.map((entry) => (
                  <EntryRow key={entry.id} entry={entry} onDeleted={() => router.refresh()} />
                ))}
              </div>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
