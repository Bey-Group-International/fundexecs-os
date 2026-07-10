"use client";

// The active-network roster — the working list of who is in the operator's
// orbit right now, ranked hottest-first and filterable by temperature. Fed
// first-party Source-hub data (investors, contacts, partners, providers); no
// imported address book.

import { useMemo, useState } from "react";
import type { ActiveNetworkPerson, PersonKind, Temperature } from "@/lib/network-active";

const TEMP: Record<Temperature, { dot: string; chip: string; label: string }> = {
  committed: { dot: "bg-emerald-400", chip: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300", label: "Committed" },
  active: { dot: "bg-accent-400", chip: "border-accent-400/30 bg-accent-400/10 text-accent-300", label: "Active" },
  warm: { dot: "bg-gold-400", chip: "border-gold-500/30 bg-gold-500/10 text-gold-300", label: "Warm" },
  cold: { dot: "bg-fg-muted", chip: "border-line bg-surface-2 text-fg-muted", label: "Cold" },
};

const KIND_LABEL: Record<PersonKind, string> = {
  investor: "Investor",
  contact: "Contact",
  partner: "Partner",
  provider: "Provider",
};

type Filter = "all" | Temperature;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function lastTouch(days: number | null): string {
  if (days === null) return "No touch logged";
  if (days <= 0) return "Touched today";
  if (days === 1) return "Touched yesterday";
  if (days < 30) return `Touched ${days}d ago`;
  if (days < 365) return `Touched ${Math.floor(days / 30)}mo ago`;
  return `Touched ${Math.floor(days / 365)}y ago`;
}

const PAGE = 40;

export function ActiveRoster({
  people,
  onSelect,
}: {
  people: ActiveNetworkPerson[];
  onSelect?: (person: ActiveNetworkPerson) => void;
}) {
  const [filter, setFilter] = useState<Filter>("all");
  const [query, setQuery] = useState("");
  const [shown, setShown] = useState(PAGE);

  const counts = useMemo(() => {
    const c: Record<Filter, number> = { all: people.length, committed: 0, active: 0, warm: 0, cold: 0 };
    for (const p of people) if (p.temperature) c[p.temperature] += 1;
    return c;
  }, [people]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    return people.filter((p) => {
      if (filter !== "all" && p.temperature !== filter) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.org ?? "").toLowerCase().includes(q) ||
        (p.role ?? "").toLowerCase().includes(q)
      );
    });
  }, [people, filter, query]);

  const visible = filtered.slice(0, shown);

  const FILTERS: { key: Filter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "committed", label: "Committed" },
    { key: "active", label: "Active" },
    { key: "warm", label: "Warm" },
    { key: "cold", label: "Cold" },
  ];

  if (people.length === 0) {
    return (
      <div className="fx-card p-8 text-center">
        <div className="mx-auto mb-3 flex h-10 w-10 items-center justify-center rounded-full border border-gold-500/30 bg-gold-500/10 text-lg text-gold-300">
          ◈
        </div>
        <p className="text-sm font-medium text-fg-primary">Your active network is empty</p>
        <p className="mx-auto mt-2 max-w-sm text-sm text-fg-muted">
          People flow in from the Source hub — investors in your capital pipeline, partners,
          providers, and relationship contacts. Add a prospect or connect a source to begin.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Controls */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="fx-segment inline-flex flex-wrap gap-0.5 font-mono text-[11px] uppercase tracking-wider">
          {FILTERS.map((f) => (
            <button
              key={f.key}
              onClick={() => {
                setFilter(f.key);
                setShown(PAGE);
              }}
              className={`rounded-md px-2.5 py-1 transition ${
                filter === f.key ? "bg-surface-2 text-fg-primary" : "text-fg-muted hover:text-fg-primary"
              }`}
            >
              {f.label}
              <span className="ml-1 text-fg-muted/70">{counts[f.key]}</span>
            </button>
          ))}
        </div>
        <div className="relative ml-auto min-w-[180px] flex-1 sm:max-w-xs">
          <svg
            className="absolute left-2.5 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-fg-muted"
            fill="none"
            stroke="currentColor"
            strokeWidth={2}
            viewBox="0 0 24 24"
          >
            <circle cx="11" cy="11" r="8" />
            <path d="m21 21-4.35-4.35" />
          </svg>
          <input
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setShown(PAGE);
            }}
            placeholder="Filter by name, firm, role…"
            className="fx-focus w-full rounded-lg border border-line bg-surface-1 py-1.5 pl-8 pr-3 text-xs text-fg-primary placeholder:text-fg-muted"
          />
        </div>
      </div>

      {/* Roster */}
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">No one matches that filter.</p>
      ) : (
        <div className="flex flex-col divide-y divide-line/60 overflow-hidden rounded-2xl border border-line/80 bg-surface-1/40">
          {visible.map((p) => (
            <PersonRow key={`${p.kind}:${p.id}`} person={p} onSelect={onSelect} />
          ))}
        </div>
      )}

      {shown < filtered.length && (
        <button
          onClick={() => setShown((s) => s + PAGE)}
          className="fx-btn-secondary self-center text-xs"
        >
          Show {Math.min(PAGE, filtered.length - shown)} more
        </button>
      )}
    </div>
  );
}

function PersonRow({
  person: p,
  onSelect,
}: {
  person: ActiveNetworkPerson;
  onSelect?: (person: ActiveNetworkPerson) => void;
}) {
  const temp = p.temperature ? TEMP[p.temperature] : TEMP.cold;
  const subtitle = [p.role, p.org].filter(Boolean).join(" · ");
  const clickable = !!onSelect;

  return (
    <div
      role={clickable ? "button" : undefined}
      tabIndex={clickable ? 0 : undefined}
      onClick={clickable ? () => onSelect(p) : undefined}
      onKeyDown={
        clickable
          ? (e) => {
              if (e.key === "Enter" || e.key === " ") {
                e.preventDefault();
                onSelect(p);
              }
            }
          : undefined
      }
      className={`group flex items-start gap-3 px-4 py-3 transition hover:bg-surface-2/40 ${
        clickable ? "fx-focus cursor-pointer" : ""
      }`}
    >
      {/* Avatar */}
      <div className="relative mt-0.5 shrink-0">
        <div className="flex h-9 w-9 items-center justify-center rounded-full border border-line bg-surface-2 text-xs font-semibold text-fg-secondary">
          {initials(p.name)}
        </div>
        <span
          className={`absolute -bottom-0.5 -right-0.5 h-2.5 w-2.5 rounded-full ring-2 ring-surface-1 ${temp.dot}`}
          title={temp.label}
        />
      </div>

      {/* Identity */}
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1">
          <span className="truncate text-sm font-medium text-fg-primary">{p.name}</span>
          <span className={`shrink-0 rounded-full border px-1.5 py-px text-[10px] font-medium ${temp.chip}`}>
            {temp.label}
          </span>
          <span className="shrink-0 font-mono text-[10px] uppercase tracking-wider text-fg-muted/70">
            {KIND_LABEL[p.kind]}
          </span>
        </div>
        {subtitle && <p className="mt-0.5 truncate text-xs text-fg-muted">{subtitle}</p>}

        {/* Next action + intro path */}
        {p.nextAction && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-fg-secondary">
            <svg className="h-3 w-3 shrink-0 text-gold-400" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M13 2 3 14h7l-1 8 10-12h-7l1-8Z" />
            </svg>
            <span className="truncate">{p.nextAction}</span>
          </p>
        )}
        {p.introPath && p.introPath.length > 1 && (
          <div className="mt-1.5 flex flex-wrap items-center gap-1">
            {p.introPath.map((hop, i) => (
              <span key={i} className="flex items-center gap-1">
                <span className="text-[11px] text-fg-muted">{hop}</span>
                {i < p.introPath!.length - 1 && (
                  <svg className="h-3 w-3 shrink-0 text-fg-muted/40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                    <path d="M5 12h14M12 5l7 7-7 7" />
                  </svg>
                )}
              </span>
            ))}
          </div>
        )}
      </div>

      {/* Right rail: warmth + last touch + committed */}
      <div className="hidden shrink-0 flex-col items-end gap-0.5 sm:flex">
        <div className="flex items-center gap-1.5">
          <span className="font-mono text-xs tabular-nums text-fg-secondary">{p.warmth}</span>
          <div className="h-1 w-12 overflow-hidden rounded-full bg-surface-2">
            <div className={`h-full rounded-full ${temp.dot}`} style={{ width: `${Math.max(4, p.warmth)}%` }} />
          </div>
        </div>
        <span className="text-[11px] text-fg-muted">{lastTouch(p.lastContactDays)}</span>
        {p.committedAmount > 0 && (
          <span className="text-[11px] font-medium text-emerald-300">
            {p.thesisFitScore !== null ? `Fit ${p.thesisFitScore}` : "Committed"}
          </span>
        )}
      </div>
    </div>
  );
}
