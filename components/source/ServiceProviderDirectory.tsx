"use client";

// components/source/ServiceProviderDirectory.tsx
// Rich service provider directory with core bench coverage and filtering.
import { useState, useMemo } from "react";

const PROVIDER_TYPE_LABELS: Record<string, string> = {
  legal: "Legal",
  audit: "Audit",
  tax: "Tax",
  fund_admin: "Fund Admin",
  placement: "Placement",
  bank: "Bank",
  other: "Other",
};

const PROVIDER_TYPE_COLORS: Record<string, string> = {
  legal: "text-gold-300 border-gold-500/30 bg-gold-500/5",
  audit: "text-gold-300 border-gold-500/30 bg-gold-500/5",
  tax: "text-gold-300 border-gold-500/30 bg-gold-500/5",
  fund_admin: "text-gold-300 border-gold-500/30 bg-gold-500/5",
  placement: "text-blue-300 border-blue-500/30 bg-blue-500/5",
  bank: "text-blue-300 border-blue-500/30 bg-blue-500/5",
  other: "text-fg-muted border-line bg-surface-2",
};

const STATUS_COLORS: Record<string, string> = {
  active: "text-emerald-400 border-emerald-500/40",
  prospective: "text-amber-400 border-amber-500/40",
  former: "text-slate-500 border-slate-600/30",
};

const CORE_BENCH: Array<{ key: string; label: string }> = [
  { key: "legal", label: "Legal" },
  { key: "audit", label: "Audit" },
  { key: "tax", label: "Tax" },
  { key: "fund_admin", label: "Fund Admin" },
];

export interface ProviderEntry {
  id: string;
  name: string;
  providerType: string;
  contactName: string | null;
  contactEmail: string | null;
  status: string;
  notes: string | null;
}

function CoreBenchBar({ providers }: { providers: ProviderEntry[] }) {
  const activeTypes = new Set(
    providers.filter((p) => p.status === "active").map((p) => p.providerType),
  );
  const covered = CORE_BENCH.filter((b) => activeTypes.has(b.key));
  const all = covered.length === CORE_BENCH.length;

  return (
    <div className={`flex items-center gap-3 rounded-xl border px-4 py-3 ${all ? "border-emerald-500/30 bg-emerald-500/5" : "border-amber-500/30 bg-amber-500/5"}`}>
      <span className={`font-mono text-sm font-semibold ${all ? "text-emerald-400" : "text-amber-400"}`}>
        {covered.length}/{CORE_BENCH.length}
      </span>
      <div className="flex flex-1 flex-wrap gap-2">
        {CORE_BENCH.map((b) => {
          const ok = activeTypes.has(b.key);
          return (
            <span
              key={b.key}
              className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${
                ok
                  ? "border-emerald-500/40 bg-emerald-500/10 text-emerald-400"
                  : "border-slate-600/30 text-slate-500"
              }`}
            >
              {ok ? "✓ " : "○ "}{b.label}
            </span>
          );
        })}
      </div>
      <span className={`hidden font-mono text-[10px] sm:block ${all ? "text-emerald-400/60" : "text-amber-400/60"}`}>
        {all ? "Institutional bench complete" : "Core bench incomplete"}
      </span>
    </div>
  );
}

function ProviderCard({ provider }: { provider: ProviderEntry }) {
  const typeColor = PROVIDER_TYPE_COLORS[provider.providerType] ?? PROVIDER_TYPE_COLORS.other;
  const statusColor = STATUS_COLORS[provider.status] ?? STATUS_COLORS.former;
  const typeLabel = PROVIDER_TYPE_LABELS[provider.providerType] ?? provider.providerType;
  const statusLabel = provider.status.charAt(0).toUpperCase() + provider.status.slice(1);

  return (
    <div className="flex flex-col gap-3 rounded-xl border border-line bg-surface-1 p-4 transition hover:border-line/80">
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0 flex-1">
          <p className="truncate text-sm font-medium text-fg-primary">{provider.name}</p>
        </div>
        <span className={`shrink-0 rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${typeColor}`}>
          {typeLabel}
        </span>
      </div>

      {(provider.contactName || provider.contactEmail) && (
        <div>
          {provider.contactName && (
            <p className="font-mono text-[10px] text-fg-secondary">{provider.contactName}</p>
          )}
          {provider.contactEmail && (
            <a
              href={`mailto:${provider.contactEmail}`}
              className="font-mono text-[10px] text-fg-muted transition hover:text-gold-300"
              onClick={(e) => e.stopPropagation()}
            >
              {provider.contactEmail}
            </a>
          )}
        </div>
      )}

      {provider.notes && (
        <p className="line-clamp-2 text-[11px] text-fg-muted">{provider.notes}</p>
      )}

      <div className="flex items-center justify-end">
        <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${statusColor}`}>
          {statusLabel}
        </span>
      </div>
    </div>
  );
}

interface Props {
  providers: ProviderEntry[];
}

export function ServiceProviderDirectory({ providers }: Props) {
  const [search, setSearch] = useState("");
  const [typeFilter, setTypeFilter] = useState("all");
  const [statusFilter, setStatusFilter] = useState("active");

  const filtered = useMemo(() => {
    let list = providers;
    if (search.trim()) {
      const q = search.toLowerCase();
      list = list.filter(
        (p) =>
          p.name.toLowerCase().includes(q) ||
          p.contactName?.toLowerCase().includes(q) ||
          p.notes?.toLowerCase().includes(q),
      );
    }
    if (typeFilter !== "all") {
      list = list.filter((p) => p.providerType === typeFilter);
    }
    if (statusFilter !== "all") {
      list = list.filter((p) => p.status === statusFilter);
    }
    return list.sort((a, b) => {
      // Core bench types first, then by name
      const coreA = CORE_BENCH.findIndex((c) => c.key === a.providerType);
      const coreB = CORE_BENCH.findIndex((c) => c.key === b.providerType);
      if (coreA !== coreB) {
        if (coreA === -1) return 1;
        if (coreB === -1) return -1;
        return coreA - coreB;
      }
      return a.name.localeCompare(b.name);
    });
  }, [providers, search, typeFilter, statusFilter]);

  const types = Array.from(new Set(providers.map((p) => p.providerType)));

  return (
    <div className="flex flex-col gap-4">
      {/* Core bench */}
      {providers.length > 0 && <CoreBenchBar providers={providers} />}

      {/* Filter bar */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="search"
          placeholder="Search providers…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="flex-1 min-w-[180px] rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/40 focus:outline-none"
        />
        <select
          value={typeFilter}
          onChange={(e) => setTypeFilter(e.target.value)}
          className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary focus:border-gold-500/40 focus:outline-none"
        >
          <option value="all">All types</option>
          {types.map((t) => (
            <option key={t} value={t}>{PROVIDER_TYPE_LABELS[t] ?? t}</option>
          ))}
        </select>
        <select
          value={statusFilter}
          onChange={(e) => setStatusFilter(e.target.value)}
          className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-secondary focus:border-gold-500/40 focus:outline-none"
        >
          <option value="all">All statuses</option>
          <option value="active">Active</option>
          <option value="prospective">Prospective</option>
          <option value="former">Former</option>
        </select>
        <span className="ml-auto font-mono text-[10px] text-fg-muted">
          {filtered.length} of {providers.length} providers
        </span>
      </div>

      {/* Card grid */}
      {filtered.length === 0 ? (
        <div className="flex flex-col items-center rounded-2xl border border-dashed border-line bg-surface-1 px-8 py-12 text-center">
          <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
            {providers.length === 0
              ? "No service providers yet. Add legal, audit, tax, and fund admin here."
              : "No providers match your filters."}
          </p>
        </div>
      ) : (
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
          {filtered.map((p) => (
            <ProviderCard key={p.id} provider={p} />
          ))}
        </div>
      )}
    </div>
  );
}
