"use client";

// components/source/MarketIntelBoard.tsx
// Market Intelligence directory — presentational client board. Takes a ranked
// IntelRecord set from MarketIntelModule and layers on interactive search,
// filter chips (kind / sector / momentum), a sortable table, and expandable
// per-row detail. All filtering runs client-side through the pure searchIntel;
// column sorting re-orders in place. Styling mirrors ContractStatusBoard and the
// other Source directory components (surface/line/gold/fg + status tokens).
import { Fragment, useMemo, useState } from "react";
import {
  searchIntel,
  distinctSectors,
  distinctKinds,
  type IntelRecord,
  type IntelKind,
  type Momentum,
} from "@/lib/market-intel";

type SortKey = "name" | "kind" | "sector" | "size_usd" | "relevance";
type SortDir = "asc" | "desc";

const KIND_META: Record<IntelKind, { label: string; cls: string }> = {
  investor: { label: "Investor", cls: "border-blue-500/40 bg-blue-500/10 text-blue-300" },
  deal: { label: "Deal", cls: "border-gold-500/40 bg-gold-500/10 text-gold-300" },
  fund: { label: "Fund", cls: "border-emerald-500/40 bg-emerald-500/10 text-emerald-300" },
  partner: { label: "Partner", cls: "border-slate-500/40 bg-slate-500/10 text-slate-300" },
};

const MOMENTUM_META: Record<Momentum, { label: string; cls: string }> = {
  hot: { label: "Hot", cls: "border-status-danger/40 bg-status-danger/10 text-status-danger" },
  warm: { label: "Warm", cls: "border-status-warning/40 bg-status-warning/10 text-status-warning" },
  cool: { label: "Cool", cls: "border-status-info/40 bg-status-info/10 text-status-info" },
};

const MOMENTA: Momentum[] = ["hot", "warm", "cool"];

function formatUsd(v: number | null): string {
  if (v == null) return "—";
  const abs = Math.abs(v);
  if (abs >= 1e9) return `$${(v / 1e9).toFixed(1)}B`;
  if (abs >= 1e6) return `$${(v / 1e6).toFixed(1)}M`;
  if (abs >= 1e3) return `$${(v / 1e3).toFixed(0)}K`;
  return `$${v}`;
}

function Chip({
  active,
  onClick,
  children,
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={`rounded-full border px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider transition focus:outline-none focus-visible:ring-1 focus-visible:ring-gold-400/50 ${
        active
          ? "border-gold-500/50 bg-gold-500/15 text-gold-300"
          : "border-line bg-surface-2/40 text-fg-muted hover:text-fg-secondary"
      }`}
    >
      {children}
    </button>
  );
}

function KindBadge({ kind }: { kind: IntelKind }) {
  const m = KIND_META[kind];
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${m.cls}`}>
      {m.label}
    </span>
  );
}

function MomentumBadge({ momentum }: { momentum: Momentum }) {
  const m = MOMENTUM_META[momentum];
  return (
    <span className={`rounded-full border px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider ${m.cls}`}>
      {m.label}
    </span>
  );
}

function DetailField({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">{label}</dt>
      <dd className="mt-0.5 text-xs text-fg-secondary">{value}</dd>
    </div>
  );
}

function RecordDetail({ rec }: { rec: IntelRecord }) {
  return (
    <div className="border-t border-line bg-surface-2/20 px-4 py-3">
      <dl className="grid grid-cols-2 gap-x-4 gap-y-3 sm:grid-cols-4">
        <DetailField label="Kind" value={KIND_META[rec.kind].label} />
        <DetailField label="Sector" value={rec.sector ?? "—"} />
        <DetailField label="Geography" value={rec.geography ?? "—"} />
        <DetailField label="Size" value={formatUsd(rec.size_usd)} />
        <DetailField label="Stage" value={rec.stage ?? "—"} />
        <DetailField label="Relevance" value={`${rec.relevance} / 100`} />
        <DetailField label="Momentum" value={MOMENTUM_META[rec.momentum].label} />
      </dl>
    </div>
  );
}

const COLUMNS: { key: SortKey; label: string; className?: string }[] = [
  { key: "name", label: "Name" },
  { key: "kind", label: "Kind" },
  { key: "sector", label: "Sector" },
  { key: "size_usd", label: "Size", className: "text-right" },
  { key: "relevance", label: "Relevance", className: "text-right" },
];

export function MarketIntelBoard({ records }: { records: IntelRecord[] }) {
  const [query, setQuery] = useState("");
  const [kinds, setKinds] = useState<Set<IntelKind>>(new Set());
  const [sector, setSector] = useState<string | null>(null);
  const [momentum, setMomentum] = useState<Momentum | null>(null);
  const [sortKey, setSortKey] = useState<SortKey>("relevance");
  const [sortDir, setSortDir] = useState<SortDir>("desc");
  const [openId, setOpenId] = useState<string | null>(null);

  const kindOptions = useMemo(() => distinctKinds(records), [records]);
  const sectorOptions = useMemo(() => distinctSectors(records), [records]);

  const filtered = useMemo(
    () =>
      searchIntel(records, query, {
        kinds: kinds.size > 0 ? Array.from(kinds) : undefined,
        sector,
        momentum,
      }),
    [records, query, kinds, sector, momentum],
  );

  const rows = useMemo(() => {
    const dir = sortDir === "asc" ? 1 : -1;
    return [...filtered].sort((a, b) => {
      let cmp = 0;
      if (sortKey === "size_usd" || sortKey === "relevance") {
        cmp = (a[sortKey] ?? -1) - (b[sortKey] ?? -1);
      } else {
        cmp = String(a[sortKey] ?? "").localeCompare(String(b[sortKey] ?? ""));
      }
      return cmp * dir;
    });
  }, [filtered, sortKey, sortDir]);

  function toggleKind(k: IntelKind) {
    setKinds((prev) => {
      const next = new Set(prev);
      if (next.has(k)) next.delete(k);
      else next.add(k);
      return next;
    });
  }

  function onSort(key: SortKey) {
    if (key === sortKey) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(key);
      setSortDir(key === "size_usd" || key === "relevance" ? "desc" : "asc");
    }
  }

  if (records.length === 0) {
    return (
      <div className="rounded-xl border border-dashed border-line bg-surface-1/50 p-8 text-center">
        <p className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
          No intelligence yet
        </p>
        <p className="mt-1 text-xs text-fg-secondary">
          Add investors, deals, funds, or partners to populate the directory.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Search */}
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name, sector, geography…"
        className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-gold-400/40"
      />

      {/* Filter chips */}
      <div className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted">Kind</span>
          {kindOptions.map((k) => (
            <Chip key={k} active={kinds.has(k)} onClick={() => toggleKind(k)}>
              {KIND_META[k].label}
            </Chip>
          ))}
        </div>
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="mr-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted">Momentum</span>
          {MOMENTA.map((m) => (
            <Chip key={m} active={momentum === m} onClick={() => setMomentum((cur) => (cur === m ? null : m))}>
              {MOMENTUM_META[m].label}
            </Chip>
          ))}
        </div>
        {sectorOptions.length > 0 && (
          <div className="flex flex-wrap items-center gap-1.5">
            <span className="mr-1 font-mono text-[9px] uppercase tracking-wider text-fg-muted">Sector</span>
            {sectorOptions.map((s) => (
              <Chip key={s} active={sector === s} onClick={() => setSector((cur) => (cur === s ? null : s))}>
                {s}
              </Chip>
            ))}
          </div>
        )}
      </div>

      <p className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
        {rows.length} of {records.length} records
      </p>

      {/* Directory table */}
      <div className="overflow-x-auto rounded-xl border border-line bg-surface-1">
        <table className="w-full min-w-[640px] border-collapse text-left">
          <thead>
            <tr className="border-b border-line bg-surface-2/30">
              {COLUMNS.map((col) => (
                <th
                  key={col.key}
                  scope="col"
                  className={`px-4 py-2 font-mono text-[9px] uppercase tracking-wider text-fg-muted ${col.className ?? ""}`}
                >
                  <button
                    type="button"
                    onClick={() => onSort(col.key)}
                    className="inline-flex items-center gap-1 uppercase transition hover:text-fg-secondary focus:outline-none"
                  >
                    {col.label}
                    {sortKey === col.key && <span aria-hidden>{sortDir === "asc" ? "↑" : "↓"}</span>}
                  </button>
                </th>
              ))}
              <th scope="col" className="px-4 py-2 font-mono text-[9px] uppercase tracking-wider text-fg-muted text-right">
                Momentum
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.length === 0 ? (
              <tr>
                <td colSpan={6} className="px-4 py-8 text-center text-xs text-fg-muted">
                  No records match the current filters.
                </td>
              </tr>
            ) : (
              rows.map((rec) => {
                const open = openId === rec.id;
                return (
                  <Fragment key={rec.id}>
                    <tr
                      role="button"
                      tabIndex={0}
                      aria-expanded={open}
                      onClick={() => setOpenId((id) => (id === rec.id ? null : rec.id))}
                      onKeyDown={(e) => {
                        if (e.key === "Enter" || e.key === " ") {
                          e.preventDefault();
                          setOpenId((id) => (id === rec.id ? null : rec.id));
                        }
                      }}
                      className="cursor-pointer border-b border-line transition hover:bg-surface-2/50 focus:outline-none focus-visible:ring-1 focus-visible:ring-gold-400/40 last:border-0"
                    >
                      <td className="px-4 py-3">
                        <span className="text-sm font-medium text-fg-primary">{rec.name}</span>
                        {rec.geography && (
                          <span className="ml-2 font-mono text-[10px] text-fg-muted">{rec.geography}</span>
                        )}
                      </td>
                      <td className="px-4 py-3">
                        <KindBadge kind={rec.kind} />
                      </td>
                      <td className="px-4 py-3 text-xs text-fg-secondary">{rec.sector ?? "—"}</td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-gold-300">
                        {formatUsd(rec.size_usd)}
                      </td>
                      <td className="px-4 py-3 text-right font-mono text-xs text-fg-primary">{rec.relevance}</td>
                      <td className="px-4 py-3 text-right">
                        <MomentumBadge momentum={rec.momentum} />
                      </td>
                    </tr>
                    {open && (
                      <tr>
                        <td colSpan={6} className="p-0">
                          <RecordDetail rec={rec} />
                        </td>
                      </tr>
                    )}
                  </Fragment>
                );
              })
            )}
          </tbody>
        </table>
      </div>
    </div>
  );
}
