"use client";

// components/source/AllocatorDirectory.tsx
// Allocator Intelligence Directory — FinTrx clone.
// Searchable, filterable list of LPs/allocators with fit scores and compliance badges.
import { useState, useMemo } from "react";
import {
  ALLOCATOR_TYPE_LABELS,
  ACCREDITATION_LABELS,
  ACCREDITATION_COLORS,
  formatAUM,
  formatTicketRange,
  fitScoreColor,
} from "@/lib/allocator-directory";
import type { AllocatorType, AccreditationStatus } from "@/lib/allocator-directory";

interface AllocatorEntry {
  id: string;
  name: string;
  allocatorType: AllocatorType;
  aumMin?: number | null;
  aumMax?: number | null;
  ticketMin?: number | null;
  ticketMax?: number | null;
  primaryStrategies: string[];
  geographicFocus: string[];
  accreditationStatus: AccreditationStatus;
  kycStatus: "not_started" | "in_progress" | "verified" | "expired";
  hqCity?: string;
  hqCountry?: string;
  fitScore?: number; // 0-100 from thesis matching
  temperature?: "cold" | "warm" | "active" | "committed";
  lastContactDays?: number | null;
  commitmentAmount?: number | null;
}

const TEMP_COLORS: Record<string, string> = {
  cold: "text-slate-400 border-slate-500/30",
  warm: "text-blue-400 border-blue-500/30",
  active: "text-amber-400 border-amber-500/40",
  committed: "text-emerald-400 border-emerald-500/40",
};

function AllocatorRow({ entry }: { entry: AllocatorEntry }) {
  const fitColor = entry.fitScore !== undefined ? fitScoreColor(entry.fitScore) : "";
  const tempColor = entry.temperature ? TEMP_COLORS[entry.temperature] : "";

  return (
    <div className="group flex items-center gap-4 border-b border-line px-4 py-3 last:border-0 transition hover:bg-surface-2/40">
      {/* Name + type */}
      <div className="min-w-[200px] flex-1">
        <p className="text-sm font-medium text-fg-primary">{entry.name}</p>
        <p className="mt-0.5 font-mono text-[10px] text-fg-muted">
          {ALLOCATOR_TYPE_LABELS[entry.allocatorType]}
          {entry.hqCity && ` · ${entry.hqCity}`}
        </p>
      </div>

      {/* AUM */}
      <div className="hidden w-28 sm:block">
        <p className="font-mono text-xs text-fg-secondary">
          {formatAUM(entry.aumMax ?? entry.aumMin)}
        </p>
        <p className="font-mono text-[10px] text-fg-muted">AUM</p>
      </div>

      {/* Ticket */}
      <div className="hidden w-36 lg:block">
        <p className="font-mono text-xs text-fg-secondary">
          {formatTicketRange(entry.ticketMin ?? null, entry.ticketMax ?? null)}
        </p>
        <p className="font-mono text-[10px] text-fg-muted">Ticket</p>
      </div>

      {/* Strategies */}
      <div className="hidden w-40 xl:flex flex-wrap gap-1">
        {entry.primaryStrategies.slice(0, 2).map((s) => (
          <span key={s} className="rounded-full border border-line bg-surface-2 px-2 py-0.5 font-mono text-[9px] text-fg-muted">
            {s.replace(/_/g, " ")}
          </span>
        ))}
        {entry.primaryStrategies.length > 2 && (
          <span className="font-mono text-[9px] text-fg-muted">+{entry.primaryStrategies.length - 2}</span>
        )}
      </div>

      {/* Accreditation */}
      <div className="hidden w-32 lg:block">
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${ACCREDITATION_COLORS[entry.accreditationStatus]}`}>
          {ACCREDITATION_LABELS[entry.accreditationStatus]}
        </span>
      </div>

      {/* Fit score */}
      {entry.fitScore !== undefined && (
        <div className="hidden w-16 text-right sm:block">
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[10px] font-semibold ${fitColor}`}>
            {entry.fitScore}%
          </span>
        </div>
      )}

      {/* Temperature */}
      {entry.temperature && (
        <div className="hidden w-20 sm:block">
          <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase ${tempColor}`}>
            {entry.temperature}
          </span>
        </div>
      )}

      {/* Last contact */}
      <div className="hidden w-20 text-right lg:block">
        <p className={`font-mono text-[10px] ${entry.lastContactDays && entry.lastContactDays > 60 ? "text-amber-400" : "text-fg-muted"}`}>
          {entry.lastContactDays !== null && entry.lastContactDays !== undefined
            ? `${entry.lastContactDays}d ago`
            : "—"}
        </p>
      </div>
    </div>
  );
}

interface Props {
  entries: AllocatorEntry[];
}

export function AllocatorDirectory({ entries }: Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState<string>("all");
  const [sortBy, setSortBy] = useState<"fit" | "aum" | "last_contact">("fit");

  const filtered = useMemo(() => {
    let list = entries;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (e) =>
          e.name.toLowerCase().includes(q) ||
          e.hqCity?.toLowerCase().includes(q) ||
          e.primaryStrategies.some((s) => s.includes(q)),
      );
    }
    if (typeFilter !== "all") {
      list = list.filter((e) => e.allocatorType === typeFilter);
    }
    return [...list].sort((a, b) => {
      if (sortBy === "fit") return (b.fitScore ?? 0) - (a.fitScore ?? 0);
      if (sortBy === "aum") return (b.aumMax ?? 0) - (a.aumMax ?? 0);
      if (sortBy === "last_contact")
        return (a.lastContactDays ?? 999) - (b.lastContactDays ?? 999);
      return 0;
    });
  }, [entries, search, typeFilter, sortBy]);

  const types = Array.from(new Set(entries.map((e) => e.allocatorType)));

  return (
    <div className="flex flex-col gap-4">
      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search allocators…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[200px] rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-yellow-500/40 focus:outline-none"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary focus:border-yellow-500/40 focus:outline-none"
        >
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{ALLOCATOR_TYPE_LABELS[t]}</option>
          ))}
        </select>
        <select
          value={sortBy}
          onChange={(e) => setSortBy(e.target.value as typeof sortBy)}
          className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary focus:border-yellow-500/40 focus:outline-none"
        >
          <option value="fit">Sort: Fit score</option>
          <option value="aum">Sort: AUM</option>
          <option value="last_contact">Sort: Last contact</option>
        </select>
        <span className="ml-auto font-mono text-[10px] text-fg-muted">
          {filtered.length} of {entries.length} allocators
        </span>
      </div>

      {/* Table */}
      <div className="rounded-xl border border-line bg-surface-1">
        {/* Header */}
        <div className="flex items-center gap-4 border-b border-line bg-surface-2/30 px-4 py-2.5">
          <span className="min-w-[200px] flex-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">Allocator</span>
          <span className="hidden w-28 font-mono text-[10px] uppercase tracking-wider text-fg-muted sm:block">AUM</span>
          <span className="hidden w-36 font-mono text-[10px] uppercase tracking-wider text-fg-muted lg:block">Ticket</span>
          <span className="hidden w-40 font-mono text-[10px] uppercase tracking-wider text-fg-muted xl:block">Strategies</span>
          <span className="hidden w-32 font-mono text-[10px] uppercase tracking-wider text-fg-muted lg:block">Accreditation</span>
          <span className="hidden w-16 text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted sm:block">Fit</span>
          <span className="hidden w-20 font-mono text-[10px] uppercase tracking-wider text-fg-muted sm:block">Status</span>
          <span className="hidden w-20 text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted lg:block">Contact</span>
        </div>
        {filtered.length === 0 ? (
          <div className="px-4 py-8 text-center">
            <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">No allocators match your filters</p>
          </div>
        ) : (
          filtered.map((entry) => <AllocatorRow key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
