"use client";

// components/dashboard/AgentRoutingConsole.tsx
// Feature 01 — Agent Routing Console
//
// Right-panel drawer showing per-task routing decisions with confidence bars,
// expandable rationales, inline agent overrides, and org-level workload bars.

import React, { useCallback, useEffect, useRef, useState } from "react";
import type { RoutingEvent } from "@/lib/routing-trace";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

const AGENT_LIST = [
  "deal-coach",
  "analyst",
  "diligence",
  "meeting-copilot",
  "capital-raiser",
] as const;

type AgentKey = (typeof AGENT_LIST)[number] | string;

interface WorkloadEntry {
  agent_key: string;
  active_count: number;
}

// ---------------------------------------------------------------------------
// Utility helpers
// ---------------------------------------------------------------------------

/** Deterministically map an agent_key string to one of 8 Tailwind bg colours. */
function agentChipColor(key: string): string {
  const palette = [
    "bg-violet-500",
    "bg-sky-500",
    "bg-emerald-500",
    "bg-amber-500",
    "bg-rose-500",
    "bg-indigo-500",
    "bg-teal-500",
    "bg-orange-500",
  ];
  let hash = 0;
  for (let i = 0; i < key.length; i++) {
    hash = (hash * 31 + key.charCodeAt(i)) >>> 0;
  }
  return palette[hash % palette.length];
}

/** Confidence bar colour class. */
function confidenceColor(conf: number): string {
  if (conf >= 0.7) return "bg-emerald-500";
  if (conf >= 0.5) return "bg-amber-500";
  return "bg-rose-500";
}

/** Format confidence as a readable percentage string. */
function fmtConfidence(conf: number): string {
  return `${Math.round(conf * 100)}%`;
}

// ---------------------------------------------------------------------------
// Sub-components
// ---------------------------------------------------------------------------

interface AgentChipProps {
  agentKey: string;
}

function AgentChip({ agentKey }: AgentChipProps) {
  const color = agentChipColor(agentKey);
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-0.5 text-xs font-medium text-white ${color}`}
    >
      {agentKey}
    </span>
  );
}

interface ConfidenceBarProps {
  confidence: number;
}

function ConfidenceBar({ confidence: conf }: ConfidenceBarProps) {
  const color = confidenceColor(conf);
  const pct = Math.round(conf * 100);
  return (
    <div className="flex items-center gap-2">
      <div className="h-2 flex-1 overflow-hidden rounded-full bg-line">
        <div
          className={`h-full rounded-full transition-all duration-300 ${color}`}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span className="w-10 text-right text-xs tabular-nums text-fg-muted">
        {fmtConfidence(conf)}
      </span>
    </div>
  );
}

interface RoutingEventRowProps {
  event: RoutingEvent;
  onOverride: (eventId: string, stepId: string | undefined, agentKey: AgentKey) => Promise<void>;
  overridePending: boolean;
}

function RoutingEventRow({ event, onOverride, overridePending }: RoutingEventRowProps) {
  const [expanded, setExpanded] = useState(false);
  const [showPicker, setShowPicker] = useState(false);
  const [selectedAgent, setSelectedAgent] = useState<AgentKey>(event.agent_key);
  const lowConfidence = (event.confidence ?? 1) < 0.7;

  const handleOverride = async () => {
    await onOverride(event.id, event.step_id, selectedAgent);
    setShowPicker(false);
  };

  const rationaleText =
    event.rationale_json != null
      ? JSON.stringify(event.rationale_json, null, 2)
      : null;

  return (
    <div className="rounded-lg border border-line bg-surface-1 p-3 space-y-2">
      {/* Header row */}
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <AgentChip agentKey={event.agent_key} />
          {lowConfidence && (
            <span
              title="Low confidence routing"
              aria-label="Warning: low confidence"
              className="text-amber-500"
            >
              {/* Warning triangle icon via SVG */}
              <svg
                xmlns="http://www.w3.org/2000/svg"
                viewBox="0 0 20 20"
                fill="currentColor"
                className="h-4 w-4 shrink-0"
                aria-hidden="true"
              >
                <path
                  fillRule="evenodd"
                  d="M8.485 2.495c.673-1.167 2.357-1.167 3.03 0l6.28 10.875c.673 1.167-.17 2.625-1.516 2.625H3.72c-1.347 0-2.189-1.458-1.515-2.625L8.485 2.495zM10 5a.75.75 0 01.75.75v3.5a.75.75 0 01-1.5 0v-3.5A.75.75 0 0110 5zm0 9a1 1 0 100-2 1 1 0 000 2z"
                  clipRule="evenodd"
                />
              </svg>
            </span>
          )}
        </div>
        <time
          className="shrink-0 text-xs text-fg-muted"
          dateTime={event.created_at}
        >
          {new Date(event.created_at).toLocaleTimeString([], {
            hour: "2-digit",
            minute: "2-digit",
          })}
        </time>
      </div>

      {/* Confidence bar */}
      {event.confidence != null && (
        <ConfidenceBar confidence={event.confidence} />
      )}

      {/* Rationale toggle */}
      {rationaleText != null && (
        <div>
          <button
            type="button"
            onClick={() => setExpanded((v) => !v)}
            className="flex items-center gap-1 text-xs text-fg-muted hover:text-fg-primary transition-colors"
          >
            <svg
              xmlns="http://www.w3.org/2000/svg"
              viewBox="0 0 20 20"
              fill="currentColor"
              className={`h-3.5 w-3.5 transition-transform ${expanded ? "rotate-90" : ""}`}
              aria-hidden="true"
            >
              <path
                fillRule="evenodd"
                d="M7.21 14.77a.75.75 0 01.02-1.06L11.168 10 7.23 6.29a.75.75 0 111.04-1.08l4.5 4.25a.75.75 0 010 1.08l-4.5 4.25a.75.75 0 01-1.06-.02z"
                clipRule="evenodd"
              />
            </svg>
            {expanded ? "Hide rationale" : "Show rationale"}
          </button>
          {expanded && (
            <pre className="mt-1.5 overflow-x-auto rounded bg-surface-1 p-2 text-xs text-fg-muted border border-line whitespace-pre-wrap break-all">
              {rationaleText}
            </pre>
          )}
        </div>
      )}

      {/* Override section */}
      {!showPicker ? (
        <button
          type="button"
          onClick={() => setShowPicker(true)}
          className="text-xs font-medium text-sky-600 hover:text-sky-500 transition-colors"
        >
          Override agent
        </button>
      ) : (
        <div className="flex items-center gap-2">
          <select
            value={selectedAgent}
            onChange={(e) => setSelectedAgent(e.target.value)}
            className="flex-1 rounded border border-line bg-surface-1 px-2 py-1 text-xs text-fg-primary focus:outline-none focus:ring-2 focus:ring-sky-500"
          >
            {AGENT_LIST.map((a) => (
              <option key={a} value={a}>
                {a}
              </option>
            ))}
          </select>
          <button
            type="button"
            onClick={handleOverride}
            disabled={overridePending}
            className="rounded bg-sky-600 px-2.5 py-1 text-xs font-medium text-white hover:bg-sky-500 disabled:opacity-50 transition-colors"
          >
            {overridePending ? "Saving…" : "Apply"}
          </button>
          <button
            type="button"
            onClick={() => setShowPicker(false)}
            className="text-xs text-fg-muted hover:text-fg-primary transition-colors"
          >
            Cancel
          </button>
        </div>
      )}
    </div>
  );
}

interface WorkloadBarProps {
  agentKey: string;
  count: number;
  max: number;
}

function WorkloadBar({ agentKey, count, max }: WorkloadBarProps) {
  const pct = max > 0 ? Math.round((count / max) * 100) : 0;
  return (
    <div className="space-y-0.5">
      <div className="flex items-center justify-between text-xs">
        <span className="font-medium text-fg-primary">{agentKey}</span>
        <span className="tabular-nums text-fg-muted">{count}</span>
      </div>
      <div className="h-1.5 overflow-hidden rounded-full bg-line">
        <div
          className="h-full rounded-full bg-sky-500 transition-all duration-300"
          style={{ width: `${pct}%` }}
        />
      </div>
    </div>
  );
}

// ---------------------------------------------------------------------------
// Main component
// ---------------------------------------------------------------------------

export interface AgentRoutingConsoleProps {
  taskId: string;
  orgId: string;
  onClose?: () => void;
}

export function AgentRoutingConsole({
  taskId,
  orgId,
  onClose,
}: AgentRoutingConsoleProps) {
  const [events, setEvents] = useState<RoutingEvent[]>([]);
  const [workload, setWorkload] = useState<WorkloadEntry[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [overridePending, setOverridePending] = useState<string | null>(null); // eventId being saved
  const abortRef = useRef<AbortController | null>(null);

  // ---------------------------------------------------------------------------
  // Data fetching
  // ---------------------------------------------------------------------------

  const fetchData = useCallback(async () => {
    abortRef.current?.abort();
    const ctrl = new AbortController();
    abortRef.current = ctrl;

    setLoading(true);
    setError(null);

    try {
      const [eventsRes, workloadRes] = await Promise.all([
        fetch(`/api/routing/${encodeURIComponent(taskId)}`, {
          signal: ctrl.signal,
        }),
        fetch(
          `/api/routing/workload?orgId=${encodeURIComponent(orgId)}`,
          { signal: ctrl.signal },
        ),
      ]);

      if (!eventsRes.ok) {
        throw new Error(`Routing events fetch failed: ${eventsRes.status}`);
      }
      if (!workloadRes.ok) {
        throw new Error(`Workload fetch failed: ${workloadRes.status}`);
      }

      const eventsData = (await eventsRes.json()) as { events: RoutingEvent[] };
      const workloadData = (await workloadRes.json()) as {
        workload: WorkloadEntry[];
      };

      setEvents(eventsData.events);
      setWorkload(workloadData.workload);
    } catch (err) {
      if (err instanceof Error && err.name === "AbortError") return;
      setError(err instanceof Error ? err.message : "Failed to load routing data");
    } finally {
      setLoading(false);
    }
  }, [taskId, orgId]);

  useEffect(() => {
    void fetchData();
    return () => abortRef.current?.abort();
  }, [fetchData]);

  // ---------------------------------------------------------------------------
  // Override handler
  // ---------------------------------------------------------------------------

  const handleOverride = async (
    eventId: string,
    stepId: string | undefined,
    agentKey: AgentKey,
  ) => {
    if (!stepId) return;
    setOverridePending(eventId);
    try {
      await fetch(`/api/routing/override`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ stepId, agentKey }),
      });
      // Refresh so the UI reflects any resulting new routing events.
      await fetchData();
    } finally {
      setOverridePending(null);
    }
  };

  // ---------------------------------------------------------------------------
  // Workload max for normalising bars
  // ---------------------------------------------------------------------------

  const workloadMax = workload.reduce(
    (acc, w) => Math.max(acc, w.active_count),
    1,
  );

  const lowConfidenceCount = events.filter(
    (e) => (e.confidence ?? 1) < 0.7,
  ).length;

  // ---------------------------------------------------------------------------
  // Render
  // ---------------------------------------------------------------------------

  return (
    <aside
      className="flex h-full w-80 flex-col border-l border-line bg-surface-1"
      aria-label="Agent Routing Console"
    >
      {/* Header */}
      <div className="flex items-center justify-between border-b border-line px-4 py-3">
        <div className="flex items-center gap-2">
          <h2 className="text-sm font-semibold text-fg-primary">
            Agent Routing
          </h2>
          {lowConfidenceCount > 0 && (
            <span
              className="inline-flex items-center rounded-full bg-amber-100 px-2 py-0.5 text-xs font-medium text-amber-700"
              title={`${lowConfidenceCount} low-confidence routing decision${lowConfidenceCount > 1 ? "s" : ""}`}
            >
              {lowConfidenceCount} warning{lowConfidenceCount > 1 ? "s" : ""}
            </span>
          )}
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close Agent Routing Console"
          className="rounded p-1 text-fg-muted hover:bg-line hover:text-fg-primary transition-colors"
        >
          <svg
            xmlns="http://www.w3.org/2000/svg"
            viewBox="0 0 20 20"
            fill="currentColor"
            className="h-4 w-4"
            aria-hidden="true"
          >
            <path d="M6.28 5.22a.75.75 0 00-1.06 1.06L8.94 10l-3.72 3.72a.75.75 0 101.06 1.06L10 11.06l3.72 3.72a.75.75 0 101.06-1.06L11.06 10l3.72-3.72a.75.75 0 00-1.06-1.06L10 8.94 6.28 5.22z" />
          </svg>
        </button>
      </div>

      {/* Body */}
      <div className="flex-1 overflow-y-auto px-4 py-3 space-y-4">
        {/* Loading / error states */}
        {loading && (
          <p className="text-sm text-fg-muted">Loading routing data…</p>
        )}
        {!loading && error != null && (
          <div className="rounded-lg border border-rose-200 bg-rose-50 p-3">
            <p className="text-sm text-rose-700">{error}</p>
            <button
              type="button"
              onClick={() => void fetchData()}
              className="mt-1.5 text-xs font-medium text-rose-700 underline hover:no-underline"
            >
              Retry
            </button>
          </div>
        )}

        {/* Routing events */}
        {!loading && error == null && (
          <section aria-label="Routing decisions">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Routing Decisions
            </h3>
            {events.length === 0 ? (
              <p className="text-sm text-fg-muted">
                No routing events for this task yet.
              </p>
            ) : (
              <ul className="space-y-2 list-none p-0">
                {events.map((event) => (
                  <li key={event.id}>
                    <RoutingEventRow
                      event={event}
                      onOverride={handleOverride}
                      overridePending={overridePending === event.id}
                    />
                  </li>
                ))}
              </ul>
            )}
          </section>
        )}

        {/* Workload section */}
        {!loading && error == null && workload.length > 0 && (
          <section aria-label="Agent workload">
            <h3 className="mb-2 text-xs font-semibold uppercase tracking-wide text-fg-muted">
              Agent Workload (24 h)
            </h3>
            <div className="space-y-2">
              {workload.map((w) => (
                <WorkloadBar
                  key={w.agent_key}
                  agentKey={w.agent_key}
                  count={w.active_count}
                  max={workloadMax}
                />
              ))}
            </div>
          </section>
        )}
      </div>
    </aside>
  );
}
