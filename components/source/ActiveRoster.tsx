"use client";

// The active-network roster — the working list of who is in the operator's
// orbit right now. Fed first-party Source-hub data (investors, contacts,
// partners, providers); no imported address book. Wraps that roster in the
// connection-management systems operators expect: a count header, sort
// controls, name search + advanced filters, per-person actions (message +
// more-actions menu), an "Added {date}" stamp, and infinite scroll.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
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

type TempFilter = "all" | Temperature;
type SortKey = "warmth" | "recent" | "first" | "last" | "touch";

const SORTS: { key: SortKey; label: string }[] = [
  { key: "warmth", label: "Warmth" },
  { key: "recent", label: "Recently added" },
  { key: "first", label: "First name" },
  { key: "last", label: "Last name" },
  { key: "touch", label: "Last touch" },
];

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const PAGE = 30;

function initials(name: string): string {
  return name
    .split(/\s+/)
    .map((n) => n[0])
    .filter(Boolean)
    .slice(0, 2)
    .join("")
    .toUpperCase();
}

function firstName(n: string): string {
  return n.trim().split(/\s+/)[0]?.toLowerCase() || n.toLowerCase();
}
function lastName(n: string): string {
  const parts = n.trim().split(/\s+/);
  return (parts.length > 1 ? parts[parts.length - 1] : parts[0] ?? n).toLowerCase();
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
  category: string | "all";
  committedOnly: boolean;
  introOnly: boolean;
}

const DEFAULT_FILTERS: Filters = {
  temp: "all",
  kind: "all",
  category: "all",
  committedOnly: false,
  introOnly: false,
};

export function ActiveRoster({
  people,
  onSelect,
}: {
  people: ActiveNetworkPerson[];
  onSelect?: (person: ActiveNetworkPerson) => void;
}) {
  const [query, setQuery] = useState("");
  const [sort, setSort] = useState<SortKey>("warmth");
  const [sortMenu, setSortMenu] = useState(false);
  const [showFilters, setShowFilters] = useState(false);
  const [filters, setFilters] = useState<Filters>(DEFAULT_FILTERS);
  const [shown, setShown] = useState(PAGE);
  const [openMenu, setOpenMenu] = useState<string | null>(null);
  const [archived, setArchived] = useState<Set<string>>(() => new Set());
  const [note, setNote] = useState<string | null>(null);
  const sentinelRef = useRef<HTMLDivElement | null>(null);

  // The roster minus anything archived this session — the basis for counts and
  // filter options so they stay in step with the visible rows.
  const livePeople = useMemo(() => people.filter((p) => !archived.has(p.id)), [people, archived]);

  const tempCounts = useMemo(() => {
    const c: Record<TempFilter, number> = { all: livePeople.length, committed: 0, active: 0, warm: 0, cold: 0 };
    for (const p of livePeople) if (p.temperature) c[p.temperature] += 1;
    return c;
  }, [livePeople]);

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const p of livePeople) if (p.category) set.add(p.category);
    return [...set].sort();
  }, [livePeople]);

  const kinds = useMemo(() => {
    const set = new Set<PersonKind>();
    for (const p of livePeople) set.add(p.kind);
    return [...set];
  }, [livePeople]);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const rows = people.filter((p) => {
      if (archived.has(p.id)) return false;
      if (filters.temp !== "all" && p.temperature !== filters.temp) return false;
      if (filters.kind !== "all" && p.kind !== filters.kind) return false;
      if (filters.category !== "all" && p.category !== filters.category) return false;
      if (filters.committedOnly && p.committedAmount <= 0) return false;
      if (filters.introOnly && !(p.introPath && p.introPath.length > 1)) return false;
      if (!q) return true;
      return (
        p.name.toLowerCase().includes(q) ||
        (p.org ?? "").toLowerCase().includes(q) ||
        (p.role ?? "").toLowerCase().includes(q)
      );
    });
    const sorted = [...rows];
    sorted.sort((a, b) => {
      switch (sort) {
        case "recent": {
          const ta = a.addedAt ? Date.parse(a.addedAt) : 0;
          const tb = b.addedAt ? Date.parse(b.addedAt) : 0;
          return tb - ta;
        }
        case "first":
          return firstName(a.name).localeCompare(firstName(b.name));
        case "last":
          return lastName(a.name).localeCompare(lastName(b.name));
        case "touch": {
          const da = a.lastContactDays ?? Number.MAX_SAFE_INTEGER;
          const db = b.lastContactDays ?? Number.MAX_SAFE_INTEGER;
          return da - db;
        }
        default:
          return b.warmth - a.warmth;
      }
    });
    return sorted;
  }, [people, query, sort, filters, archived]);

  // Reset the visible window whenever the result set changes shape.
  useEffect(() => {
    setShown(PAGE);
  }, [query, sort, filters]);

  // Infinite scroll — grow the window as the sentinel nears the viewport.
  useEffect(() => {
    const el = sentinelRef.current;
    if (!el) return;
    const io = new IntersectionObserver(
      (entries) => {
        if (entries[0]?.isIntersecting) setShown((s) => (s < filtered.length ? s + PAGE : s));
      },
      { rootMargin: "300px" },
    );
    io.observe(el);
    return () => io.disconnect();
    // `shown` is included so the observer is recreated when the sentinel
    // re-mounts after the window resets on a filter/sort change.
  }, [filtered.length, shown]);

  // Close menus on any outside click.
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
    (filters.category !== "all" ? 1 : 0) +
    (filters.committedOnly ? 1 : 0) +
    (filters.introOnly ? 1 : 0);

  const handleArchive = useCallback(async (p: ActiveNetworkPerson) => {
    setOpenMenu(null);
    setArchived((prev) => new Set(prev).add(p.id)); // optimistic
    try {
      const res = await fetch("/api/network/contacts/archive", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ contactId: p.id }),
      });
      if (!res.ok) throw new Error("archive failed");
      setNote(`Removed ${p.name} from your active network.`);
    } catch {
      setArchived((prev) => {
        const next = new Set(prev);
        next.delete(p.id);
        return next;
      });
      setNote(`Couldn't remove ${p.name}. Please try again.`);
    }
  }, []);

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

  const visible = filtered.slice(0, shown);

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

  const TEMP_CHIPS: { key: TempFilter; label: string }[] = [
    { key: "all", label: "All" },
    { key: "committed", label: "Committed" },
    { key: "active", label: "Active" },
    { key: "warm", label: "Warm" },
    { key: "cold", label: "Cold" },
  ];

  return (
    <div className="flex flex-col gap-4">
      {/* Count header — the connection-count banner. */}
      <div className="flex items-baseline justify-between gap-3">
        <p className="text-sm text-fg-secondary">
          <span className="font-display text-lg font-semibold tabular-nums text-fg-primary">
            {filtered.length.toLocaleString()}
          </span>{" "}
          {filtered.length === livePeople.length
            ? "in your active network"
            : `of ${livePeople.length.toLocaleString()} shown`}
        </p>

        {/* Sort control */}
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
              <span className="ml-1 text-fg-muted/70">{tempCounts[f.key]}</span>
            </button>
          ))}
        </div>

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
            <span className="rounded-full bg-gold-400/20 px-1.5 text-[10px] font-semibold text-gold-300">
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
              options={[{ value: "all", label: "All types" }, ...kinds.map((k) => ({ value: k, label: KIND_LABEL[k] }))]}
            />
            {categories.length > 0 && (
              <FilterSelect
                label="Capital role"
                value={filters.category}
                onChange={(v) => setFilters((p) => ({ ...p, category: v }))}
                options={[
                  { value: "all", label: "All roles" },
                  ...categories.map((c) => ({ value: c, label: humanizeCategory(c) })),
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

      {note && (
        <div className="flex items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 py-2 text-xs text-fg-secondary">
          {note}
          <button onClick={() => setNote(null)} className="ml-auto text-fg-muted hover:text-fg-primary">
            ×
          </button>
        </div>
      )}

      {/* Roster */}
      {filtered.length === 0 ? (
        <p className="py-8 text-center text-sm text-fg-muted">No one matches those filters.</p>
      ) : (
        <div className="flex flex-col divide-y divide-line/60 overflow-hidden rounded-2xl border border-line/80 bg-surface-1/40">
          {visible.map((p) => (
            <PersonRow
              key={`${p.kind}:${p.id}`}
              person={p}
              onSelect={onSelect}
              menuOpen={openMenu === p.id}
              onToggleMenu={() => setOpenMenu((cur) => (cur === p.id ? null : p.id))}
              onArchive={() => handleArchive(p)}
              onCopyEmail={() => handleCopyEmail(p)}
            />
          ))}
        </div>
      )}

      {/* Infinite-scroll sentinel */}
      {shown < filtered.length && (
        <div ref={sentinelRef} className="flex justify-center py-3 text-xs text-fg-muted">
          <span className="flex items-center gap-2">
            <span className="h-3 w-3 animate-spin rounded-full border-2 border-gold-400/40 border-t-gold-400" />
            Loading more…
          </span>
        </div>
      )}
    </div>
  );
}

function FilterSelect({
  label,
  value,
  onChange,
  options,
}: {
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: { value: string; label: string }[];
}) {
  return (
    <label className="flex items-center gap-2 text-xs text-fg-muted">
      {label}
      <select
        value={value}
        onChange={(e) => onChange(e.target.value)}
        className="fx-focus rounded-md border border-line bg-surface-1 px-2 py-1 text-xs text-fg-primary"
      >
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
  onSelect,
  menuOpen,
  onToggleMenu,
  onArchive,
  onCopyEmail,
}: {
  person: ActiveNetworkPerson;
  onSelect?: (person: ActiveNetworkPerson) => void;
  menuOpen: boolean;
  onToggleMenu: () => void;
  onArchive: () => void;
  onCopyEmail: () => void;
}) {
  const temp = p.temperature ? TEMP[p.temperature] : TEMP.cold;
  const subtitle = [p.role, p.org].filter(Boolean).join(" · ");
  const added = formatAdded(p.addedAt);

  return (
    <div className="group flex items-start gap-3 px-4 py-3 transition hover:bg-surface-2/40">
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
        {added && <p className="mt-0.5 text-[11px] text-fg-muted/70">{added}</p>}

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
                {onSelect && (
                  <MenuItem onClick={() => onSelect(p)} label="Draft warm intro" />
                )}
                {p.email && <MenuItem onClick={onCopyEmail} label="Copy email" />}
                {p.kind === "contact" && (
                  <MenuItem onClick={onArchive} label="Remove from network" danger />
                )}
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
