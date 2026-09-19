"use client";

// The active-network roster — the working list of who is in the operator's
// orbit right now, fed by first-party Source-hub data (investors, contacts,
// partners, providers) plus the CRM spine (stage, owner, timeline recency).
//
// The roster is SERVER-PAGED. This component used to receive every person in
// the org and do all the filtering, sorting, and paging in the browser; now it
// holds one page at a time and asks /api/network/roster for the next. Filter
// and sort state lives in the query it sends, so the counts on the chips come
// from the same pass that produced the rows rather than from a second count
// computed over a different array.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import type { ActiveNetworkPerson, PersonKind, Temperature } from "@/lib/network-active";
// Value imports come from network-stages, not network-active: the latter pulls
// the capital map and the Anthropic SDK, which must not reach a client bundle.
import { CONTACT_STAGES, STAGE_LABEL, type ContactStage } from "@/lib/network-stages";
import type { RosterFacets, RosterPage, RosterSort } from "@/lib/network-roster";

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

type TempFilter = "all" | Temperature;

const SORTS: { key: RosterSort; label: string }[] = [
  { key: "warmth", label: "Warmth" },
  { key: "recent", label: "Recently added" },
  { key: "first", label: "First name" },
  { key: "last", label: "Last name" },
  { key: "touch", label: "Last touch" },
  { key: "stale", label: "Quietest first" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const SEARCH_DEBOUNCE_MS = 280;

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

function formatAdded(iso: string | null): string | null {
  if (!iso) return null;
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const d = new Date(ms);
  return `Added ${MONTHS[d.getUTCMonth()]} ${d.getUTCDate()}, ${d.getUTCFullYear()}`;
}

function humanizeCategory(c: string): string {
  return c.replace(/_/g, " ").replace(/\b\w/g, (m) => m.toUpperCase());
}

interface Filters {
  temp: TempFilter;
  kind: PersonKind | "all";
  stage: ContactStage | "all";
  owner: string;
  category: string;
  committedOnly: boolean;
  introOnly: boolean;
  needsAttention: boolean;
}

const DEFAULT_FILTERS: Filters = {
  temp: "all",
  kind: "all",
  stage: "all",
  owner: "all",
  category: "all",
  committedOnly: false,
  introOnly: false,
  needsAttention: false,
};

export interface OwnerOption {
  id: string;
  name: string;
}

function buildQuery(filters: Filters, sort: RosterSort, q: string, offset: number, limit: number) {
  const params = new URLSearchParams();
  if (q.trim()) params.set("q", q.trim());
  if (filters.temp !== "all") params.set("temp", filters.temp);
  if (filters.kind !== "all") params.set("kind", filters.kind);
  if (filters.stage !== "all") params.set("stage", filters.stage);
  if (filters.owner !== "all") params.set("owner", filters.owner);
  if (filters.category !== "all") params.set("category", filters.category);
  if (filters.committedOnly) params.set("committed", "1");
  if (filters.introOnly) params.set("intro", "1");
  if (filters.needsAttention) params.set("attention", "1");
  params.set("sort", sort);
  params.set("offset", String(offset));
  params.set("limit", String(limit));
  return params;
}

interface Props {
  initialPage: RosterPage;
  owners?: OwnerOption[];
  pageSize?: number;
  onSelect?: (person: ActiveNetworkPerson) => void;
}

export function ActiveRoster({ initialPage, owners = [], pageSize = 30, onSelect }: Props) {
  const [rows, setRows] = useState<ActiveNetworkPerson[]>(initialPage.rows);
  const [total, setTotal] = useState(initialPage.total);
  const [nextOffset, setNextOffset] = useState<number | null>(initialPage.nextOffset);
  const [facets, setFacets] = useState<RosterFacets>(initialPage.facets);
  const [orbitTotal] = useState(initialPage.pulse.people);

  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<RosterSort>("warmth");
  const [sortMenu, setSortMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [loading, setLoading] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [note, setNote] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const sentinelRef = useRef<HTMLDivElement | null>(null);
  // Guards against a slow early request overwriting a later, faster one.
  const requestSeq = useRef(0);
  // The first render already has server-rendered rows; don't refetch them.
  const firstRender = useRef(true);

  const fetchPage = useCallback(
    async (offset: number, mode: "replace" | "append") => {
      const seq = ++requestSeq.current;
      mode === "append" ? setLoadingMore(true) : setLoading(true);
      try {
        const params = buildQuery(filters, sort, query, offset, pageSize);
        const res = await fetch(`/api/network/roster?${params}`, { cache: "no-store" });
        if (!res.ok) throw new Error(String(res.status));
        const page = (await res.json()) as RosterPage;
        // A newer request already landed — discard this one.
        if (seq !== requestSeq.current) return;
        setRows((prev) => (mode === "append" ? [...prev, ...page.rows] : page.rows));
        setTotal(page.total);
        setNextOffset(page.nextOffset);
        setFacets(page.facets);
        setError(null);
      } catch {
        if (seq === requestSeq.current) {
          setError("Couldn't load the roster. Check your connection and try again.");
        }
      } finally {
        if (seq === requestSeq.current) {
          setLoading(false);
          setLoadingMore(false);
        }
      }
    },
    [filters, sort, query, pageSize],
  );

  // Refetch from the top whenever the query shape changes. The search box is
  // debounced; filter and sort changes are deliberate, so they go immediately.
  useEffect(() => {
    if (firstRender.current) {
      firstRender.current = false;
      return;
    }
    const t = setTimeout(() => {
      setSelected(new Set());
      void fetchPage(0, "replace");
    }, query ? SEARCH_DEBOUNCE_MS : 0);
    return () => clearTimeout(t);
  }, [fetchPage, query]);

  // Infinite scroll — ask for the next page as the sentinel nears the viewport.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el || nextOffset === null) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting && !loadingMore && !loading) {
          void fetchPage(nextOffset, "append");
        }
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
  }, [nextOffset, loadingMore, loading, fetchPage]);

  useEffect(() => {
    if (!openMenu && !sortMenu) return;
    const close = () => {
      setOpenMenu(null);
      setSortMenu(false);
    };
    document.addEventListener("click", close);
    return () => document.removeEventListener("click", close);
  }, [openMenu, sortMenu]);

  const activeFilterCount =
    (filters.kind !== "all" ? 1 : 0) +
    (filters.stage !== "all" ? 1 : 0) +
    (filters.owner !== "all" ? 1 : 0) +
    (filters.category !== "all" ? 1 : 0) +
    (filters.committedOnly ? 1 : 0) +
    (filters.introOnly ? 1 : 0) +
    (filters.needsAttention ? 1 : 0);

  // Only contacts carry the CRM spine, so only they can be bulk-edited. A
  // selection of investors would have nothing to write to.
  const selectableRows = useMemo(() => rows.filter((p) => p.kind === "contact"), [rows]);
  const selectedIds = useMemo(() => [...selected], [selected]);

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  }, []);

  const handleArchive = useCallback(async (p: ActiveNetworkPerson) => {
    setOpenMenu(null);
    const before = rows;
    setRows((prev) => prev.filter((r) => r.id !== p.id));
    setTotal((t) => Math.max(0, t - 1));
    try {
      const res = await fetch("/api/network/contacts/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: p.id }),
      });
      if (!res.ok) throw new Error("archive failed");
      setNote(`Removed ${p.name} from your active network.`);
    } catch {
      setRows(before);
      setTotal((t) => t + 1);
      setNote(`Couldn't remove ${p.name}. Please try again.`);
    }
  }, [rows]);

  const handleCopyEmail = useCallback(async (p: ActiveNetworkPerson) => {
    setOpenMenu(null);
    if (!p.email) return;
    try {
      await navigator.clipboard.writeText(p.email);
      setNote(`Copied ${p.email}`);
    } catch {
      setNote("Couldn't copy to clipboard.");
    }
  }, []);

  const runBulk = useCallback(
    async (patch: Record<string, unknown>, describe: (n: number) => string) => {
      if (selectedIds.length === 0) return;
      setBusy(true);
      try {
        const res = await fetch("/api/network/contacts/bulk", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ contactIds: selectedIds, ...patch }),
        });
        const body = (await res.json().catch(() => null)) as { updated?: number; error?: string } | null;
        if (!res.ok) throw new Error(body?.error ?? "bulk failed");
        setNote(describe(body?.updated ?? selectedIds.length));
        setSelected(new Set());
        await fetchPage(0, "replace");
      } catch (err) {
        setNote(err instanceof Error && err.message !== "bulk failed" ? err.message : "Bulk update failed.");
      } finally {
        setBusy(false);
      }
    },
    [selectedIds, fetchPage],
  );

  const exportCsv = useCallback(() => {
    const params = buildQuery(filters, sort, query, 0, 1);
    params.delete("offset");
    params.delete("limit");
    if (selectedIds.length > 0) params.set("ids", selectedIds.join(","));
    window.location.href = `/api/network/export?${params}`;
  }, [filters, sort, query, selectedIds]);

  const TEMP_CHIPS: { key: TempFilter; label: string; count: number }[] = [
    { key: "all", label: "All", count: total },
    { key: "committed", label: "Committed", count: facets.temperature.committed },
    { key: "active", label: "Active", count: facets.temperature.active },
    { key: "warm", label: "Warm", count: facets.temperature.warm },
    { key: "cold", label: "Cold", count: facets.temperature.cold },
  ];

  const hasAnyone = orbitTotal > 0;
  if (!hasAnyone) {
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
      {/* Count header */}
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-fg-secondary">
          <span className="font-display text-lg font-semibold tabular-nums text-fg-primary">
            {total.toLocaleString()}
          </span>{" "}
          {total === orbitTotal ? "in your active network" : `of ${orbitTotal.toLocaleString()} shown`}
        </p>

        <div className="flex items-center gap-3">
          <button
            onClick={exportCsv}
            className="text-xs text-fg-muted transition hover:text-fg-primary"
            title="Download the current view as CSV"
          >
            Export
          </button>
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                setSortMenu((s) => !s);
              }}
              className="flex items-center gap-1 text-xs text-fg-muted transition hover:text-fg-primary"
            >
              <span className="text-fg-muted/70">Sort:</span>
              <span className="font-medium text-fg-secondary">
                {SORTS.find((s) => s.key === sort)?.label}
              </span>
              <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                <path d="m6 9 6 6 6-6" />
              </svg>
            </button>
            {sortMenu && (
              <div className="fx-card absolute right-0 z-20 mt-1 w-44 overflow-hidden p-1 shadow-lg">
                {SORTS.map((s) => (
                  <button
                    key={s.key}
                    onClick={() => {
                      setSort(s.key);
                      setSortMenu(false);
                    }}
                    className={`block w-full rounded-md px-3 py-1.5 text-left text-xs transition hover:bg-surface-2 ${
                      sort === s.key ? "font-medium text-fg-primary" : "text-fg-secondary"
                    }`}
                  >
                    {s.label}
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Search + temperature chips + filters toggle */}
      <div className="flex flex-wrap items-center gap-2">
        <div className="relative min-w-[180px] flex-1 sm:max-w-xs">
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
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search by name, firm, role…"
            className="fx-focus w-full rounded-lg border border-line bg-surface-1 py-1.5 pl-8 pr-3 text-xs text-fg-primary placeholder:text-fg-muted"
          />
          {loading && (
            <span className="absolute right-2.5 top-1/2 h-3 w-3 -translate-y-1/2 animate-spin rounded-full border-2 border-gold-400/40 border-t-gold-400" />
          )}
        </div>

        <div className="fx-segment inline-flex flex-wrap gap-0.5 font-mono text-[11px] uppercase tracking-wider">
          {TEMP_CHIPS.map((f) => (
            <button
              key={f.key}
              onClick={() => setFilters((prev) => ({ ...prev, temp: f.key }))}
              className={`rounded-md px-2.5 py-1 transition ${
                filters.temp === f.key ? "bg-surface-2 text-fg-primary" : "text-fg-muted hover:text-fg-primary"
              }`}
            >
              {f.label}
              <span className="ml-1 text-fg-muted/70">{f.count}</span>
            </button>
          ))}
        </div>

        {/* The one filter worth a dedicated control: engaged relationships that
            have gone quiet are the thing an operator loses money by missing. */}
        <button
          onClick={() => setFilters((p) => ({ ...p, needsAttention: !p.needsAttention }))}
          className={`fx-focus flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
            filters.needsAttention
              ? "border-rose-500/40 bg-rose-500/10 text-rose-300"
              : "border-line text-fg-muted hover:text-fg-primary"
          }`}
        >
          Needs attention
          <span className="rounded-full bg-rose-400/20 px-1.5 text-[11px] font-semibold text-rose-300">
            {facets.needsAttention}
          </span>
        </button>

        <button
          onClick={() => setShowFilters((s) => !s)}
          className={`fx-focus flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs transition ${
            showFilters || activeFilterCount > 0
              ? "border-gold-500/40 bg-gold-500/10 text-gold-300"
              : "border-line text-fg-muted hover:text-fg-primary"
          }`}
        >
          <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
            <path d="M22 3H2l8 9.46V19l4 2v-8.54z" />
          </svg>
          Filters
          {activeFilterCount > 0 && (
            <span className="rounded-full bg-gold-400/20 px-1.5 text-[11px] font-semibold text-gold-300">
              {activeFilterCount}
            </span>
          )}
        </button>
      </div>

      {/* Advanced filters panel */}
      {showFilters && (
        <div className="fx-card flex flex-col gap-3 p-4">
          <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
            <FilterSelect
              label="Type"
              value={filters.kind}
              onChange={(v) => setFilters((p) => ({ ...p, kind: v as PersonKind | "all" }))}
              options={[
                { value: "all", label: "All types" },
                ...(Object.keys(KIND_LABEL) as PersonKind[])
                  .filter((k) => facets.kind[k] > 0)
                  .map((k) => ({ value: k, label: `${KIND_LABEL[k]} (${facets.kind[k]})` })),
              ]}
            />
            <FilterSelect
              label="Stage"
              value={filters.stage}
              onChange={(v) => setFilters((p) => ({ ...p, stage: v as ContactStage | "all" }))}
              options={[
                { value: "all", label: "All stages" },
                ...CONTACT_STAGES.map((s) => ({
                  value: s,
                  label: `${STAGE_LABEL[s]} (${facets.stage[s]})`,
                })),
              ]}
            />
            {owners.length > 0 && (
              <FilterSelect
                label="Owner"
                value={filters.owner}
                onChange={(v) => setFilters((p) => ({ ...p, owner: v }))}
                options={[
                  { value: "all", label: "Anyone" },
                  { value: "unassigned", label: "Unassigned" },
                  ...owners.map((o) => ({ value: o.id, label: o.name })),
                ]}
              />
            )}
            {facets.categories.length > 0 && (
              <FilterSelect
                label="Capital role"
                value={filters.category}
                onChange={(v) => setFilters((p) => ({ ...p, category: v }))}
                options={[
                  { value: "all", label: "All roles" },
                  ...facets.categories.map((c) => ({
                    value: c.value,
                    label: `${humanizeCategory(c.value)} (${c.count})`,
                  })),
                ]}
              />
            )}
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <input
                type="checkbox"
                checked={filters.committedOnly}
                onChange={(e) => setFilters((p) => ({ ...p, committedOnly: e.target.checked }))}
                className="fx-focus h-3.5 w-3.5 rounded border-line accent-gold-400"
              />
              Committed capital only
            </label>
            <label className="flex items-center gap-2 text-xs text-fg-secondary">
              <input
                type="checkbox"
                checked={filters.introOnly}
                onChange={(e) => setFilters((p) => ({ ...p, introOnly: e.target.checked }))}
                className="fx-focus h-3.5 w-3.5 rounded border-line accent-gold-400"
              />
              Has warm-intro path
            </label>
          </div>
          {activeFilterCount > 0 && (
            <button
              onClick={() => setFilters((p) => ({ ...DEFAULT_FILTERS, temp: p.temp }))}
              className="self-start text-xs text-fg-muted underline-offset-2 transition hover:text-fg-primary hover:underline"
            >
              Clear filters
            </button>
          )}
        </div>
      )}

      {/* Bulk action bar */}
      {selected.size > 0 && (
        <BulkBar
          count={selected.size}
          owners={owners}
          busy={busy}
          onStage={(stage) => runBulk({ stage }, (n) => `Moved ${n} to ${STAGE_LABEL[stage]}.`)}
          onOwner={(ownerId) =>
            runBulk({ ownerId }, (n) =>
              ownerId === null ? `Unassigned ${n} relationships.` : `Assigned ${n} relationships.`,
            )
          }
          onArchive={() => runBulk({ archive: true }, (n) => `Archived ${n} contacts.`)}
          onExport={exportCsv}
          onClear={() => setSelected(new Set())}
        />
      )}

      {(note || error) && (
        <div
          className={`flex items-center gap-2 rounded-lg border px-3 py-2 text-xs ${
            error ? "border-rose-500/30 bg-rose-500/10 text-rose-200" : "border-line bg-surface-1 text-fg-secondary"
          }`}
        >
          {error ?? note}
          <button
            onClick={() => (error ? setError(null) : setNote(null))}
            className="ml-auto text-fg-muted hover:text-fg-primary"
          >
            ×
          </button>
        </div>
      )}

      {/* Roster */}
      {rows.length === 0 && !loading ? (
        <p className="py-8 text-center text-sm text-fg-muted">No one matches those filters.</p>
      ) : (
        <div className="flex flex-col divide-y divide-line/60 overflow-hidden rounded-2xl border border-line/80 bg-surface-1/40">
          {selectableRows.length > 0 && (
            <div className="flex items-center gap-2 bg-surface-2/30 px-4 py-2">
              <input
                type="checkbox"
                aria-label="Select every contact on this page"
                checked={selectableRows.length > 0 && selectableRows.every((p) => selected.has(p.id))}
                onChange={(e) =>
                  setSelected(e.target.checked ? new Set(selectableRows.map((p) => p.id)) : new Set())
                }
                className="fx-focus h-3.5 w-3.5 rounded border-line accent-gold-400"
              />
              <span className="text-[11px] text-fg-muted">
                Select the {selectableRows.length} contact{selectableRows.length === 1 ? "" : "s"} on this page
              </span>
            </div>
          )}
          {rows.map((p) => (
            <PersonRow
              key={`${p.kind}:${p.id}`}
              person={p}
              selectable={p.kind === "contact"}
              selected={selected.has(p.id)}
              onToggleSelect={() => toggleSelect(p.id)}
              onSelect={onSelect}
              menuOpen={openMenu === p.id}
              onToggleMenu={() => setOpenMenu((cur) => (cur === p.id ? null : p.id))}
              onArchive={() => handleArchive(p)}
              onCopyEmail={() => handleCopyEmail(p)}
            />
          ))}
        </div>
      )}

      {nextOffset !== null && (
        <div ref={sentinelRef} className="flex justify-center py-3 text-xs text-fg-muted">
          {loadingMore ? (
            <span className="flex items-center gap-2">
              <span className="h-3 w-3 animate-spin rounded-full border-2 border-gold-400/40 border-t-gold-400" />
              Loading more…
            </span>
          ) : (
            <button
              onClick={() => void fetchPage(nextOffset, "append")}
              className="text-fg-muted transition hover:text-fg-primary"
            >
              Load more
            </button>
          )}
        </div>
      )}
    </div>
  );
}

function BulkBar({
  count,
  owners,
  busy,
  onStage,
  onOwner,
  onArchive,
  onExport,
  onClear,
}: {
  count: number;
  owners: OwnerOption[];
  busy: boolean;
  onStage: (stage: ContactStage) => void;
  onOwner: (ownerId: string | null) => void;
  onArchive: () => void;
  onExport: () => void;
  onClear: () => void;
}) {
  return (
    <div className="flex flex-wrap items-center gap-3 rounded-xl border border-gold-500/30 bg-gold-500/10 px-4 py-2.5">
      <span className="text-xs font-medium text-gold-200">
        {count} selected
      </span>
      <FilterSelect
        label="Stage"
        value=""
        placeholder="Move to…"
        disabled={busy}
        onChange={(v) => v && onStage(v as ContactStage)}
        options={CONTACT_STAGES.map((s) => ({ value: s, label: STAGE_LABEL[s] }))}
      />
      <FilterSelect
        label="Owner"
        value=""
        placeholder="Assign to…"
        disabled={busy}
        onChange={(v) => onOwner(v === "unassigned" ? null : v)}
        options={[
          { value: "unassigned", label: "Unassigned" },
          ...owners.map((o) => ({ value: o.id, label: o.name })),
        ]}
      />
      <button
        onClick={onExport}
        disabled={busy}
        className="text-xs text-fg-secondary transition hover:text-fg-primary disabled:opacity-50"
      >
        Export selected
      </button>
      <button
        onClick={onArchive}
        disabled={busy}
        className="text-xs text-rose-300 transition hover:text-rose-200 disabled:opacity-50"
      >
        Archive
      </button>
      <button onClick={onClear} className="ml-auto text-xs text-fg-muted transition hover:text-fg-primary">
        Clear
      </button>
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
  placeholder,
  disabled,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
  placeholder?: string;
  disabled?: boolean;
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-fg-muted">
      {placeholder ? <span className="sr-only">{label}</span> : label}
      <select
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(e.target.value)}
        className="fx-focus rounded-md border border-line bg-surface-1 px-2 py-1 text-xs text-fg-primary disabled:opacity-50"
      >
        {placeholder && <option value="">{placeholder}</option>}
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

function PersonRow({
  person: p,
  selectable,
  selected,
  onToggleSelect,
  onSelect,
  menuOpen,
  onToggleMenu,
  onArchive,
  onCopyEmail,
}: {
  person: ActiveNetworkPerson;
  selectable: boolean;
  selected: boolean;
  onToggleSelect: () => void;
  onSelect?: (person: ActiveNetworkPerson) => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onArchive: () => void;
  onCopyEmail: () => void;
}) {
  const temp = p.temperature ? TEMP[p.temperature] : TEMP.cold;
  const subtitle = [p.role, p.org].filter(Boolean).join(" · ");
  const added = formatAdded(p.addedAt);
  // Only contacts have a record page; the rest are managed in the Source hub.
  const href = p.kind === "contact" ? `/network/${p.id}` : null;

  return (
    <div className="group flex items-start gap-3 px-4 py-3 transition hover:bg-surface-2/40">
      {selectable ? (
        <input
          type="checkbox"
          aria-label={`Select ${p.name}`}
          checked={selected}
          onChange={onToggleSelect}
          className="fx-focus mt-3 h-3.5 w-3.5 shrink-0 rounded border-line accent-gold-400"
        />
      ) : (
        <span className="mt-3 h-3.5 w-3.5 shrink-0" aria-hidden />
      )}

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
          {href ? (
            <Link
              href={href}
              className="truncate text-sm font-medium text-fg-primary underline-offset-2 hover:underline"
            >
              {p.name}
            </Link>
          ) : (
            <span className="truncate text-sm font-medium text-fg-primary">{p.name}</span>
          )}
          <span className={`shrink-0 rounded-full border px-1.5 py-px text-[11px] font-medium ${temp.chip}`}>
            {temp.label}
          </span>
          {p.stage && (
            <span className="shrink-0 rounded-full border border-line bg-surface-2 px-1.5 py-px text-[11px] text-fg-secondary">
              {STAGE_LABEL[p.stage]}
            </span>
          )}
          <span className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-fg-muted/70">
            {KIND_LABEL[p.kind]}
          </span>
          {p.visibility === "private" && (
            <span
              className="shrink-0 font-mono text-[11px] uppercase tracking-wider text-fg-muted/70"
              title="Private — visible to the owner and org admins only"
            >
              Private
            </span>
          )}
        </div>
        {subtitle && <p className="mt-0.5 truncate text-xs text-fg-muted">{subtitle}</p>}
        <p className="mt-0.5 text-[11px] text-fg-muted/70">
          {[added, p.ownerName ? `Owner ${p.ownerName}` : null].filter(Boolean).join(" · ")}
        </p>

        {/* Next action + intro path */}
        {p.nextAction && (
          <p className="mt-1.5 flex items-center gap-1.5 text-xs text-fg-secondary">
            <svg className="h-3 w-3 shrink-0 text-gold-300" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
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

        {/* Actions — message + more */}
        <div className="mt-2 flex items-center gap-2">
          {onSelect && (
            <button
              onClick={() => onSelect(p)}
              className="fx-focus rounded-lg border border-accent-400/40 bg-accent-400/10 px-3 py-1 text-xs font-medium text-accent-300 transition hover:bg-accent-400/20"
            >
              Message
            </button>
          )}
          {href && (
            <Link
              href={href}
              className="fx-focus rounded-lg border border-line px-3 py-1 text-xs text-fg-secondary transition hover:text-fg-primary"
            >
              Open record
            </Link>
          )}
          <div className="relative">
            <button
              onClick={(e) => {
                e.stopPropagation();
                onToggleMenu();
              }}
              aria-label={`More actions for ${p.name}`}
              className="fx-focus flex h-6 w-8 items-center justify-center rounded-lg border border-line text-fg-muted transition hover:text-fg-primary"
            >
              <svg className="h-4 w-4" fill="currentColor" viewBox="0 0 24 24">
                <circle cx="5" cy="12" r="1.6" />
                <circle cx="12" cy="12" r="1.6" />
                <circle cx="19" cy="12" r="1.6" />
              </svg>
            </button>
            {menuOpen && (
              <div
                className="fx-card absolute left-0 z-20 mt-1 w-48 overflow-hidden p-1 shadow-lg"
                onClick={(e) => e.stopPropagation()}
              >
                {onSelect && <MenuItem onClick={() => onSelect(p)} label="Draft warm intro" />}
                {p.email && <MenuItem onClick={onCopyEmail} label="Copy email" />}
                {p.kind === "contact" && <MenuItem onClick={onArchive} label="Remove from network" danger />}
                {!p.email && p.kind !== "contact" && (
                  <p className="px-3 py-1.5 text-xs text-fg-muted">Manage in Source hub</p>
                )}
              </div>
            )}
          </div>
        </div>
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
        {p.openTasks > 0 && (
          <span className="text-[11px] font-medium text-gold-300">
            {p.openTasks} open task{p.openTasks === 1 ? "" : "s"}
          </span>
        )}
        {p.committedAmount > 0 && (
          <span className="text-[11px] font-medium text-emerald-300">
            {p.thesisFitScore !== null ? `Fit ${p.thesisFitScore}` : "Committed"}
          </span>
        )}
      </div>
    </div>
  );
}

function MenuItem({
  onClick,
  label,
  danger,
}: {
  onClick: () => void;
  label: string;
  danger?: boolean;
}) {
  return (
    <button
      onClick={onClick}
      className={`block w-full rounded-md px-3 py-1.5 text-left text-xs transition hover:bg-surface-2 ${
        danger ? "text-rose-300 hover:text-rose-200" : "text-fg-secondary hover:text-fg-primary"
      }`}
    >
      {label}
    </button>
  );
}
