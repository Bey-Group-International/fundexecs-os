"use client";

// The table view — the roster as a grid you can edit in place.
//
// The roster list is good for reading one relationship at a time. It is bad for
// the thing an operator actually does with a book: sweep down a column and fix
// twenty rows. This is that surface — built-in columns plus whatever columns the
// org defined for itself, each cell editable where the underlying field is.
//
// Every edit writes through PATCH /api/network/contacts/[id], the same route
// the record page uses, so stage and owner changes still land on the timeline
// and in the audit log. A cell shows its own pending and failed state rather
// than blocking the grid, and a failed write reverts just that cell.

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { CONTACT_STAGES, STAGE_LABEL, type ContactStage } from "@/lib/network-stages";
import type { FieldDef } from "@/lib/network-fields";
import type { ActiveNetworkPerson } from "@/lib/network-active";

export interface OwnerOption {
  id: string;
  name: string;
}

type ColumnKind = "identity" | "stage" | "owner" | "warmth" | "lastActivity" | "tags" | "custom";

interface Column {
  id: string;
  label: string;
  kind: ColumnKind;
  /** Only contacts carry the CRM spine, so only they are editable. */
  editable: boolean;
  def?: FieldDef;
  width: string;
}

const BASE_COLUMNS: Column[] = [
  { id: "name", label: "Name", kind: "identity", editable: false, width: "minmax(220px,1.6fr)" },
  { id: "stage", label: "Stage", kind: "stage", editable: true, width: "minmax(130px,0.8fr)" },
  { id: "owner", label: "Owner", kind: "owner", editable: true, width: "minmax(140px,0.9fr)" },
  { id: "warmth", label: "Warmth", kind: "warmth", editable: false, width: "minmax(90px,0.5fr)" },
  { id: "lastActivity", label: "Last activity", kind: "lastActivity", editable: false, width: "minmax(120px,0.7fr)" },
  { id: "tags", label: "Tags", kind: "tags", editable: true, width: "minmax(160px,1fr)" },
];

function formatDay(iso: string | null): string {
  if (!iso) return "—";
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return "—";
  return new Date(ms).toLocaleDateString(undefined, { month: "short", day: "numeric", year: "numeric" });
}

function formatCustom(def: FieldDef, value: unknown): string {
  if (value === null || value === undefined || value === "") return "";
  switch (def.type) {
    case "currency": {
      const n = Number(value);
      if (!Number.isFinite(n)) return String(value);
      if (Math.abs(n) >= 1e9) return `$${(n / 1e9).toFixed(1)}B`;
      if (Math.abs(n) >= 1e6) return `$${(n / 1e6).toFixed(1)}M`;
      if (Math.abs(n) >= 1e3) return `$${Math.round(n / 1e3)}K`;
      return `$${n}`;
    }
    case "percent":
      return `${value}%`;
    case "boolean":
      return value ? "Yes" : "No";
    case "multi_select":
      return Array.isArray(value) ? value.join(", ") : String(value);
    case "date":
      return formatDay(String(value));
    default:
      return String(value);
  }
}

interface Props {
  rows: ActiveNetworkPerson[];
  fieldDefs: FieldDef[];
  owners: OwnerOption[];
  /** Called after a successful write so the parent can refresh derived counts. */
  onChanged?: () => void;
}

export function ContactTable({ rows, fieldDefs, owners, onChanged }: Props) {
  const [people, setPeople] = useState(rows);
  const [pending, setPending] = useState<Set<string>>(() => new Set());
  const [failed, setFailed] = useState<Map<string, string>>(() => new Map());
  const [hidden, setHidden] = useState<Set<string>>(() => new Set());
  const [showColumns, setShowColumns] = useState(false);

  // Keep in step when the parent re-fetches (filter change, new page).
  useEffect(() => setPeople(rows), [rows]);

  // A column sweep saves many cells in quick succession. Refetching the roster
  // after each one meant a page-0 response could land while another cell was
  // still in flight, replace `people`, and take that cell's optimistic value
  // with it — the edit looked accepted and then reverted on screen. So the
  // refresh is deferred until nothing is pending, and coalesced into one.
  const refreshNeeded = useRef(false);

  useEffect(() => {
    if (pending.size === 0 && refreshNeeded.current) {
      refreshNeeded.current = false;
      onChanged?.();
    }
  }, [pending, onChanged]);

  const columns = useMemo<Column[]>(
    () => [
      ...BASE_COLUMNS,
      ...fieldDefs.map<Column>((def) => ({
        id: `custom:${def.key}`,
        label: def.label,
        kind: "custom",
        editable: true,
        def,
        width: "minmax(140px,0.9fr)",
      })),
    ],
    [fieldDefs],
  );

  const visible = useMemo(() => columns.filter((c) => !hidden.has(c.id)), [columns, hidden]);
  const template = useMemo(() => visible.map((c) => c.width).join(" "), [visible]);
  const stageColumn = columns.find((c) => c.kind === "stage");
  const ownerColumn = columns.find((c) => c.kind === "owner");

  const cellKey = (personId: string, columnId: string) => `${personId}::${columnId}`;

  const save = useCallback(
    async (person: ActiveNetworkPerson, column: Column, value: unknown) => {
      const key = cellKey(person.id, column.id);
      // Only what THIS cell is about to change, so a failure here cannot undo a
      // different cell's edit that landed while this request was in flight.
      // Cells save independently, including two cells on the same row.
      const previous =
        column.kind === "stage"
          ? person.stage
          : column.kind === "owner"
            ? { ownerId: person.ownerId, ownerName: person.ownerName }
            : column.kind === "tags"
              ? person.tags
              : person.custom?.[column.def!.key];

      setPending((p) => new Set(p).add(key));
      setFailed((f) => {
        const next = new Map(f);
        next.delete(key);
        return next;
      });

      // Optimistic, per cell.
      setPeople((prev) =>
        prev.map((p) => {
          if (p.id !== person.id) return p;
          switch (column.kind) {
            case "stage":
              return { ...p, stage: value as ContactStage };
            case "owner":
              return {
                ...p,
                ownerId: (value as string | null) ?? null,
                ownerName: owners.find((o) => o.id === value)?.name ?? null,
              };
            case "tags":
              return { ...p, tags: value as string[] };
            case "custom":
              return { ...p, custom: { ...p.custom, [column.def!.key]: value } };
            default:
              return p;
          }
        }),
      );

      const body: Record<string, unknown> =
        column.kind === "custom"
          ? { custom: { [column.def!.key]: value } }
          : column.kind === "owner"
            ? { ownerId: value }
            : { [column.kind]: value };

      try {
        const res = await fetch(`/api/network/contacts/${person.id}`, {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        });
        const json = (await res.json().catch(() => null)) as { error?: string } | null;
        if (!res.ok) throw new Error(json?.error ?? "Couldn't save that.");
        // Ask for a refresh, but let the effect above decide when: firing it
        // here would race the saves still in flight.
        refreshNeeded.current = true;
      } catch (err) {
        // Revert only this cell, and say why on the cell itself — a grid that
        // silently drops an edit is how data quietly goes wrong.
        setPeople((current) =>
          current.map((p) => {
            if (p.id !== person.id) return p;
            switch (column.kind) {
              case "stage":
                return { ...p, stage: previous as ContactStage };
              case "owner": {
                const o = previous as { ownerId: string | null; ownerName: string | null };
                return { ...p, ownerId: o.ownerId, ownerName: o.ownerName };
              }
              case "tags":
                return { ...p, tags: previous as string[] };
              case "custom":
                return { ...p, custom: { ...p.custom, [column.def!.key]: previous } };
              default:
                return p;
            }
          }),
        );
        setFailed((f) => {
          const next = new Map(f);
          next.set(key, err instanceof Error ? err.message : "Save failed");
          return next;
        });
      } finally {
        setPending((p) => {
          const next = new Set(p);
          next.delete(key);
          return next;
        });
      }
    },
    // onChanged is no longer called here — the effect above fires it once the
    // pending set empties — so keeping it as a dependency would rebuild this
    // callback for nothing.
    [owners],
  );

  if (people.length === 0) {
    return <p className="py-8 text-center text-sm text-fg-muted">No one matches those filters.</p>;
  }

  return (
    <div className="flex flex-col gap-2">
      {/* Column visibility */}
      <div className="flex items-center gap-2">
        <div className="relative ml-auto">
          <button
            onClick={() => setShowColumns((s) => !s)}
            className="fx-focus rounded-lg border border-line px-2.5 py-1 text-xs text-fg-muted transition hover:text-fg-primary"
          >
            Columns {hidden.size > 0 && <span className="text-gold-300">({visible.length})</span>}
          </button>
          {showColumns && (
            <div className="fx-card absolute right-0 z-30 mt-1 max-h-72 w-56 overflow-y-auto p-1 shadow-lg">
              {columns.map((c) => (
                <label
                  key={c.id}
                  className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1 text-xs text-fg-secondary transition hover:bg-surface-2"
                >
                  <input
                    type="checkbox"
                    checked={!hidden.has(c.id)}
                    onChange={(e) =>
                      setHidden((h) => {
                        const next = new Set(h);
                        // The name column is the row's identity; hiding it
                        // leaves a grid of values with nothing to attach them to.
                        if (c.id === "name") return next;
                        e.target.checked ? next.delete(c.id) : next.add(c.id);
                        return next;
                      })
                    }
                    disabled={c.id === "name"}
                    className="fx-focus h-3.5 w-3.5 rounded border-line accent-gold-400 disabled:opacity-40"
                  />
                  {c.label}
                </label>
              ))}
            </div>
          )}
        </div>
      </div>

      <div className="space-y-2 md:hidden">
        {people.map((person) => (
          <article key={`${person.kind}:${person.id}`} className="rounded-2xl border border-line/70 bg-surface-1 p-3.5">
            <div className="min-w-0">
              {person.kind === "contact" ? (
                <Link
                  href={`/network/${person.id}`}
                  className="block truncate text-[15px] font-semibold text-fg-primary underline-offset-2 hover:underline"
                >
                  {person.name}
                </Link>
              ) : (
                <p className="truncate text-[15px] font-semibold text-fg-primary">{person.name}</p>
              )}
              <p className="mt-0.5 truncate text-xs text-fg-muted">
                {[person.role, person.org].filter(Boolean).join(" · ") || "Relationship"}
              </p>
            </div>

            <dl className="mt-3 grid grid-cols-2 gap-x-3 gap-y-2 text-xs">
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">Warmth</dt>
                <dd className="mt-0.5 font-mono text-fg-secondary">{person.warmth}</dd>
              </div>
              <div>
                <dt className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">Last touch</dt>
                <dd className="mt-0.5 text-fg-secondary">{formatDay(person.lastActivityAt ?? person.lastContactAt)}</dd>
              </div>
            </dl>

            <div className="mt-3 grid gap-2">
              {stageColumn && person.kind === "contact" ? (
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">Stage</span>
                  <select
                    value={person.stage ?? "prospect"}
                    disabled={pending.has(cellKey(person.id, stageColumn.id))}
                    onChange={(e) => void save(person, stageColumn, e.target.value)}
                    className="fx-focus w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary"
                  >
                    {CONTACT_STAGES.map((s) => (
                      <option key={s} value={s}>
                        {STAGE_LABEL[s]}
                      </option>
                    ))}
                  </select>
                  {failed.get(cellKey(person.id, stageColumn.id)) && (
                    <span className="text-[11px] text-status-danger">{failed.get(cellKey(person.id, stageColumn.id))}</span>
                  )}
                </label>
              ) : (
                <div>
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">Stage</span>
                  <p className="mt-0.5 text-sm text-fg-secondary">{person.stage ? STAGE_LABEL[person.stage] : "—"}</p>
                </div>
              )}

              {ownerColumn && person.kind === "contact" ? (
                <label className="flex flex-col gap-1">
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">Owner</span>
                  <select
                    value={person.ownerId ?? ""}
                    disabled={pending.has(cellKey(person.id, ownerColumn.id))}
                    onChange={(e) => void save(person, ownerColumn, e.target.value || null)}
                    className="fx-focus w-full rounded-lg border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary"
                  >
                    <option value="">Unassigned</option>
                    {owners.map((o) => (
                      <option key={o.id} value={o.id}>
                        {o.name}
                      </option>
                    ))}
                  </select>
                  {failed.get(cellKey(person.id, ownerColumn.id)) && (
                    <span className="text-[11px] text-status-danger">{failed.get(cellKey(person.id, ownerColumn.id))}</span>
                  )}
                </label>
              ) : (
                <div>
                  <span className="font-mono text-[11px] uppercase tracking-[0.16em] text-fg-muted">Owner</span>
                  <p className="mt-0.5 text-sm text-fg-secondary">{person.ownerName ?? "—"}</p>
                </div>
              )}
            </div>

            {person.tags.length > 0 ? (
              <div className="mt-3 flex flex-wrap gap-1.5">
                {person.tags.map((tag) => (
                  <span key={tag} className="rounded-full border border-line bg-surface-0 px-2 py-0.5 text-[11px] text-fg-secondary">
                    {tag}
                  </span>
                ))}
              </div>
            ) : null}
          </article>
        ))}
      </div>

      <div className="hidden overflow-x-auto rounded-xl border border-line/80 md:block">
        <div role="table" className="min-w-full">
          <div
            role="row"
            className="sticky top-0 z-10 grid gap-px border-b border-line bg-surface-2/80 backdrop-blur"
            style={{ gridTemplateColumns: template }}
          >
            {visible.map((c) => (
              <div
                key={c.id}
                role="columnheader"
                className="truncate px-3 py-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted"
                title={c.def?.helpText ?? undefined}
              >
                {c.label}
              </div>
            ))}
          </div>

          {people.map((person) => (
            <div
              key={`${person.kind}:${person.id}`}
              role="row"
              className="grid gap-px border-b border-line/40 transition last:border-b-0 hover:bg-surface-2/30"
              style={{ gridTemplateColumns: template }}
            >
              {visible.map((column) => (
                <Cell
                  key={column.id}
                  person={person}
                  column={column}
                  owners={owners}
                  pending={pending.has(cellKey(person.id, column.id))}
                  error={failed.get(cellKey(person.id, column.id)) ?? null}
                  onSave={(value) => void save(person, column, value)}
                />
              ))}
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function Cell({
  person,
  column,
  owners,
  pending,
  error,
  onSave,
}: {
  person: ActiveNetworkPerson;
  column: Column;
  owners: OwnerOption[];
  pending: boolean;
  error: string | null;
  onSave: (value: unknown) => void;
}) {
  // Only contacts have a record to write to; the other kinds are composed from
  // the Source hub and are read-only here.
  const editable = column.editable && person.kind === "contact";

  const base = `px-3 py-2 text-xs ${pending ? "opacity-60" : ""}`;

  if (column.kind === "identity") {
    return (
      <div role="cell" className={`${base} min-w-0`}>
        {person.kind === "contact" ? (
          <Link
            href={`/network/${person.id}`}
            className="block truncate font-medium text-fg-primary underline-offset-2 hover:underline"
          >
            {person.name}
          </Link>
        ) : (
          <span className="block truncate font-medium text-fg-primary">{person.name}</span>
        )}
        <span className="block truncate text-[11px] text-fg-muted">
          {[person.role, person.org].filter(Boolean).join(" · ")}
        </span>
      </div>
    );
  }

  if (column.kind === "warmth") {
    return (
      <div role="cell" className={`${base} font-mono tabular-nums text-fg-secondary`}>
        {person.warmth}
      </div>
    );
  }

  if (column.kind === "lastActivity") {
    return (
      <div role="cell" className={`${base} text-fg-muted`}>
        {formatDay(person.lastActivityAt ?? person.lastContactAt)}
      </div>
    );
  }

  if (!editable) {
    const readOnly =
      column.kind === "stage"
        ? person.stage
          ? STAGE_LABEL[person.stage]
          : "—"
        : column.kind === "owner"
          ? (person.ownerName ?? "—")
          : column.kind === "tags"
            ? person.tags.join(", ") || "—"
            : column.def
              ? formatCustom(column.def, person.custom?.[column.def.key]) || "—"
              : "—";
    return (
      <div role="cell" className={`${base} truncate text-fg-muted`} title={String(readOnly)}>
        {readOnly}
      </div>
    );
  }

  const wrap = (children: React.ReactNode) => (
    <div role="cell" className={`${base} min-w-0`}>
      {children}
      {error && <p className="mt-0.5 truncate text-[11px] text-status-danger" title={error}>{error}</p>}
    </div>
  );

  if (column.kind === "stage") {
    return wrap(
      <select
        value={person.stage ?? "prospect"}
        disabled={pending}
        onChange={(e) => onSave(e.target.value)}
        aria-label={`Stage for ${person.name}`}
        className="fx-focus w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-fg-secondary transition hover:border-line focus:border-line"
      >
        {CONTACT_STAGES.map((s) => (
          <option key={s} value={s}>
            {STAGE_LABEL[s]}
          </option>
        ))}
      </select>,
    );
  }

  if (column.kind === "owner") {
    return wrap(
      <select
        value={person.ownerId ?? ""}
        disabled={pending}
        onChange={(e) => onSave(e.target.value || null)}
        aria-label={`Owner for ${person.name}`}
        className="fx-focus w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-fg-secondary transition hover:border-line focus:border-line"
      >
        <option value="">Unassigned</option>
        {owners.map((o) => (
          <option key={o.id} value={o.id}>
            {o.name}
          </option>
        ))}
      </select>,
    );
  }

  if (column.kind === "tags") {
    return wrap(
      <TextCell
        value={person.tags.join(", ")}
        placeholder="—"
        disabled={pending}
        ariaLabel={`Tags for ${person.name}`}
        onCommit={(raw) =>
          onSave(
            [...new Set(raw.split(",").map((t) => t.trim()).filter(Boolean))],
          )
        }
      />,
    );
  }

  // Custom column.
  const def = column.def!;
  const value = person.custom?.[def.key];

  if (def.type === "boolean") {
    return wrap(
      <input
        type="checkbox"
        checked={value === true}
        disabled={pending}
        aria-label={`${def.label} for ${person.name}`}
        onChange={(e) => onSave(e.target.checked)}
        className="fx-focus h-3.5 w-3.5 rounded border-line accent-gold-400"
      />,
    );
  }

  if (def.type === "select") {
    return wrap(
      <select
        value={typeof value === "string" ? value : ""}
        disabled={pending}
        aria-label={`${def.label} for ${person.name}`}
        onChange={(e) => onSave(e.target.value || null)}
        className="fx-focus w-full rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-fg-secondary transition hover:border-line focus:border-line"
      >
        <option value="">—</option>
        {def.options.map((o) => (
          <option key={o} value={o}>
            {o}
          </option>
        ))}
      </select>,
    );
  }

  return wrap(
    <TextCell
      value={
        def.type === "date"
          ? (typeof value === "string" ? value.slice(0, 10) : "")
          : value === null || value === undefined
            ? ""
            : String(value)
      }
      type={def.type === "date" ? "date" : "text"}
      placeholder="—"
      disabled={pending}
      ariaLabel={`${def.label} for ${person.name}`}
      onCommit={(raw) => onSave(raw === "" ? null : raw)}
    />,
  );
}

/**
 * A text cell that commits on blur or Enter and abandons on Escape.
 *
 * It holds a local draft so typing is not fighting a round trip, and resyncs
 * when the row's value changes underneath it (an optimistic revert, or another
 * member's edit arriving on a refetch).
 */
function TextCell({
  value,
  onCommit,
  placeholder,
  disabled,
  ariaLabel,
  type = "text",
}: {
  value: string;
  onCommit: (value: string) => void;
  placeholder?: string;
  disabled?: boolean;
  ariaLabel: string;
  type?: "text" | "date";
}) {
  const [draft, setDraft] = useState(value);
  const committed = useRef(value);

  useEffect(() => {
    setDraft(value);
    committed.current = value;
  }, [value]);

  const commit = () => {
    if (draft === committed.current) return;
    committed.current = draft;
    onCommit(draft);
  };

  return (
    <input
      type={type}
      value={draft}
      disabled={disabled}
      aria-label={ariaLabel}
      placeholder={placeholder}
      onChange={(e) => setDraft(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        if (e.key === "Enter") {
          e.preventDefault();
          commit();
          (e.target as HTMLInputElement).blur();
        } else if (e.key === "Escape") {
          setDraft(committed.current);
          (e.target as HTMLInputElement).blur();
        }
      }}
      className="fx-focus w-full truncate rounded border border-transparent bg-transparent px-1 py-0.5 text-xs text-fg-secondary transition hover:border-line focus:border-line placeholder:text-fg-muted/50"
    />
  );
}
