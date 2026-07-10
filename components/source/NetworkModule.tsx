"use client";

// Network OS — the institutional relationship-capital workspace. The default
// view is the operator's ACTIVE NETWORK: who is in the capital orbit right now,
// ranked by warmth, alongside a live activity feed streaming from first-party
// Source-hub data. Search and Syndicate Circles remain as focused tabs. There
// is no imported address book — the network is populated from the Source engine.

import { useState } from "react";
import Link from "next/link";
import { NetworkSearch } from "./NetworkSearch";
import { AddContactPanel } from "./AddContactPanel";
import { SyndicateCircle } from "./SyndicateCircle";
import { WarmIntroPanel } from "./WarmIntroPanel";
import { ActiveRoster } from "./ActiveRoster";
import { NetworkActivityFeed } from "./NetworkActivityFeed";
import type {
  ActiveNetworkPerson,
  NetworkPulse,
  NetworkActivityEvent,
  NetworkLiveCounts,
  Temperature,
} from "@/lib/network-active";
import type { NetworkSearchResult } from "@/lib/network-search";

type Tab = "network" | "search" | "circles";

interface Circle {
  id: string;
  name: string;
  description: string | null;
  memberCount: number;
  inviteCode: string;
  isActive: boolean;
  createdAt: string;
}

interface Props {
  senderName: string;
  senderTitle?: string | null;
  people: ActiveNetworkPerson[];
  pulse: NetworkPulse;
  activityEvents: NetworkActivityEvent[];
  liveCounts: NetworkLiveCounts;
  circles?: Circle[];
}

const TEMP_BAR: Record<Temperature, { bg: string; label: string }> = {
  committed: { bg: "bg-emerald-400", label: "Committed" },
  active: { bg: "bg-accent-400", label: "Active" },
  warm: { bg: "bg-gold-400", label: "Warm" },
  cold: { bg: "bg-fg-muted/50", label: "Cold" },
};

export function NetworkModule({
  senderName,
  senderTitle,
  people,
  pulse,
  activityEvents,
  liveCounts,
  circles = [],
}: Props) {
  const [tab, setTab] = useState<Tab>("network");
  const [showAdd, setShowAdd] = useState(false);
  const [addedCount, setAddedCount] = useState(0);
  const [selectedContact, setSelectedContact] = useState<NetworkSearchResult | null>(null);
  const [circleList, setCircleList] = useState<Circle[]>(circles);

  async function handleCreateCircle(
    name: string,
    description: string,
  ): Promise<{ ok: boolean; error?: string }> {
    try {
      const res = await fetch("/api/network/circles", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, description }),
      });
      if (!res.ok) {
        const body = await res.json().catch(() => null);
        return { ok: false, error: body?.error ?? "Failed to create circle. Please try again." };
      }
      const circle = await res.json();
      setCircleList((prev) => [circle, ...prev]);
      return { ok: true };
    } catch {
      return { ok: false, error: "Failed to create circle. Please try again." };
    }
  }

  const tempOrder: Temperature[] = ["committed", "active", "warm", "cold"];
  const tempTotal = tempOrder.reduce((sum, t) => sum + pulse.temperature[t], 0) || 1;

  const TABS: { key: Tab; label: string }[] = [
    { key: "network", label: "Active Network" },
    { key: "search", label: "Search" },
    { key: "circles", label: "Circles" },
  ];

  return (
    <div className="flex flex-col gap-6">
      {/* Pulse — instrument panel */}
      <div className="grid gap-3 sm:grid-cols-4">
        <Stat label="In your orbit" value={pulse.people} hint="people across every source" />
        <Stat label="Engaged" value={pulse.engaged} hint="warm, active, or committed" accent="text-accent-300" />
        <Stat label="Committed" value={pulse.committed} hint="capital relationships" accent="text-emerald-300" />
        <div className="fx-stat flex flex-col justify-between">
          <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">Temperature</p>
          <div className="mt-2 flex h-2 overflow-hidden rounded-full bg-surface-2">
            {tempOrder.map((t) =>
              pulse.temperature[t] > 0 ? (
                <div
                  key={t}
                  className={TEMP_BAR[t].bg}
                  style={{ width: `${(pulse.temperature[t] / tempTotal) * 100}%` }}
                  title={`${TEMP_BAR[t].label}: ${pulse.temperature[t]}`}
                />
              ) : null,
            )}
          </div>
          <div className="mt-2 flex flex-wrap gap-x-3 gap-y-1">
            {tempOrder.map((t) => (
              <span key={t} className="flex items-center gap-1 text-[10px] text-fg-muted">
                <span className={`h-1.5 w-1.5 rounded-full ${TEMP_BAR[t].bg}`} />
                {pulse.temperature[t]}
              </span>
            ))}
          </div>
        </div>
      </div>

      {/* Tabs + actions */}
      <div className="flex flex-wrap items-center gap-3">
        <nav className="fx-segment inline-flex font-mono text-xs uppercase tracking-wider">
          {TABS.map((t) => (
            <button
              key={t.key}
              onClick={() => setTab(t.key)}
              className={`rounded-md px-3 py-1.5 transition ${
                tab === t.key ? "bg-surface-2 text-fg-primary" : "text-fg-muted hover:text-fg-primary"
              }`}
            >
              {t.label}
            </button>
          ))}
        </nav>
        <div className="ml-auto flex items-center gap-2">
          <Link
            href="/settings"
            className="hidden text-xs text-fg-muted transition hover:text-fg-primary sm:inline-flex sm:items-center sm:gap-1"
          >
            <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
            </svg>
            Connect sources
          </Link>
          <button onClick={() => setShowAdd((s) => !s)} className="fx-btn-secondary text-xs">
            {showAdd ? "Close" : "+ Add contact"}
          </button>
        </div>
      </div>

      {/* Add-contact drawer */}
      {showAdd && (
        <AddContactPanel
          onAdded={() => {
            setAddedCount((c) => c + 1);
            setShowAdd(false);
          }}
        />
      )}
      {addedCount > 0 && !showAdd && (
        <p className="text-xs text-emerald-300">
          {addedCount} contact{addedCount === 1 ? "" : "s"} added — reload to see them ranked in your network.
        </p>
      )}

      {/* Tab content */}
      {tab === "network" && (
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.6fr)_minmax(0,1fr)]">
          <ActiveRoster people={people} />
          <div className="lg:sticky lg:top-6 lg:max-h-[calc(100vh-6rem)]">
            <NetworkActivityFeed initialEvents={activityEvents} initialLive={liveCounts} />
          </div>
        </div>
      )}

      {tab === "search" && <NetworkSearch onSelectContact={(c) => setSelectedContact(c)} />}

      {tab === "circles" && <SyndicateCircle circles={circleList} onCreateCircle={handleCreateCircle} />}

      {/* Warm-intro drawer from search results */}
      {selectedContact && (
        <WarmIntroPanel
          contact={selectedContact}
          senderName={senderName}
          senderTitle={senderTitle}
          onClose={() => setSelectedContact(null)}
        />
      )}
    </div>
  );
}

function Stat({
  label,
  value,
  hint,
  accent = "text-fg-primary",
}: {
  label: string;
  value: number;
  hint: string;
  accent?: string;
}) {
  return (
    <div className="fx-stat">
      <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-fg-muted">{label}</p>
      <p className={`mt-1 font-display text-2xl font-semibold tabular-nums ${accent}`}>
        {value.toLocaleString()}
      </p>
      <p className="mt-0.5 text-[11px] text-fg-muted">{hint}</p>
    </div>
  );
}
