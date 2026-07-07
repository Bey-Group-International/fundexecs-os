"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { RecordLifecycleActions } from "@/components/RecordLifecycleActions";
import { humanize, humanizeEnumValue } from "@/lib/humanize";

interface Column {
  key: string;
  label: string;
}

type Row = Record<string, unknown> & { id?: string };

function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return "—";
  // Enum-shaped strings (`ic_review`, `fund_of_funds`) render as labels;
  // real content (names, emails, URLs, numbers) passes through untouched.
  return typeof value === "string" ? humanizeEnumValue(value) : String(value);
}

// Provenance + verification + archive are surfaced and managed here; never shown
// as plain detail fields.
const HIDDEN_FIELDS = new Set([
  "id",
  "organization_id",
  "updated_at",
  "verification_status",
  "verified_at",
  "verified_by",
  "verification_note",
  "provenance",
  "archived_at",
]);

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function relativeTime(iso: unknown): string | null {
  if (typeof iso !== "string") return null;
  const t = Date.parse(iso);
  if (Number.isNaN(t)) return null;
  const days = Math.floor((Date.now() - t) / 86_400_000);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  if (days < 30) return `${days}d ago`;
  if (days < 365) return `${Math.floor(days / 30)}mo ago`;
  return `${Math.floor(days / 365)}y ago`;
}

function VerifyBadge({ row }: { row: Row }) {
  const verified = row.verification_status === "verified";
  const ai = row.provenance === "ai";
  return (
    <div className="flex items-center justify-end gap-1.5">
      {ai ? (
        <span className="rounded-full border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-300">
          AI Sourced
        </span>
      ) : (
        <span className="rounded-full border border-line px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
          Manual
        </span>
      )}
      {verified ? (
        <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-status-success">
          ✓ Verified
        </span>
      ) : (
        <span className="flex items-center gap-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          <span className="h-1.5 w-1.5 rounded-full border border-fg-muted" aria-hidden /> Unverified
        </span>
      )}
    </div>
  );
}

// The expanded record body — full detail fields, the LP drill-down, provenance
// meta, and lifecycle actions. Shared verbatim between the desktop table row
// and the mobile card so behavior never diverges.
function RowDetails({
  row,
  id,
  archived,
  hub,
  module,
  table,
}: {
  row: Row;
  id: string;
  archived: boolean;
  hub: string;
  module: string;
  table: string;
}) {
  const detailEntries = Object.entries(row).filter(
    ([k, v]) => !HIDDEN_FIELDS.has(k) && !isEmpty(v),
  );
  return (
    <>
      <dl className="grid grid-cols-1 gap-x-8 gap-y-3 sm:grid-cols-2 lg:grid-cols-3">
        {detailEntries.map(([k, v]) => (
          <div key={k} className="flex flex-col gap-0.5">
            <dt className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
              {humanize(k)}
            </dt>
            <dd className="text-sm text-fg-primary">{cell(v)}</dd>
          </div>
        ))}
      </dl>

      {/* Drill-down to the LP war room (investors only). */}
      {table === "investors" ? (
        <Link
          href={`/investor/${id}`}
          className="mt-3 inline-flex items-center gap-1.5 rounded-md border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
        >
          → Open LP war room
        </Link>
      ) : null}

      {/* Provenance + verification meta */}
      <div className="mt-4 flex flex-wrap items-center gap-x-4 gap-y-1 border-t border-line/60 pt-3 text-[11px] text-fg-muted">
        <span>
          Origin:{" "}
          <span className="text-fg-secondary">
            {row.provenance === "ai"
              ? "AI-sourced"
              : row.provenance === "import"
                ? "Imported"
                : "Manual"}
          </span>
        </span>
        {row.verification_status === "verified" ? (
          <span className="text-status-success">
            Verified {relativeTime(row.verified_at) ?? ""}
          </span>
        ) : null}
        {typeof row.verification_note === "string" && row.verification_note ? (
          <span>
            Evidence: <span className="text-fg-secondary">{row.verification_note}</span>
          </span>
        ) : null}
      </div>

      {/* Actions */}
      <RecordLifecycleActions
        hub={hub}
        module={module}
        table={table}
        id={id}
        archived={archived}
        verificationStatus={String(row.verification_status ?? "")}
        showVerify
        className="mt-3"
      />
    </>
  );
}

// Table-backed module list with inline verification + lifecycle management.
// Live rows show by default; archived rows are revealed by a toggle and can be
// restored or permanently deleted. Every row can be verified (with an optional
// evidence note) so AI-sourced and imported records carry an explicit, audited
// confirmation before they're trusted downstream.
//
// Responsive: at `md` and up this is the classic dense table. Below `md` it
// becomes a card list — no horizontal scroll, thumb-sized tap targets — so the
// same pipeline / CRM / partner records are usable one-handed on a phone. Both
// surfaces share the expand / verify / archive state and the RowDetails body.
export default function ModuleTable({
  columns,
  rows,
  archivedRows = [],
  hub,
  module,
  table,
}: {
  columns: Column[];
  rows: Row[];
  archivedRows?: Row[];
  hub: string;
  module: string;
  table: string;
}) {
  const [expanded, setExpanded] = useState<string | null>(null);
  const [showArchived, setShowArchived] = useState(false);

  const visible: Row[] = showArchived ? [...rows, ...archivedRows] : rows;
  const colSpan = columns.length + 2; // chevron + status columns
  const [primary, ...restColumns] = columns;

  function toggle(id: string) {
    setExpanded((cur) => (cur === id ? null : id));
  }

  return (
    <div>
      {archivedRows.length > 0 ? (
        <div className="mb-2 flex items-center justify-between">
          <span />
          <button
            type="button"
            onClick={() => setShowArchived((v) => !v)}
            className="font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary"
          >
            {showArchived ? "Hide archived" : `Show archived (${archivedRows.length})`}
          </button>
        </div>
      ) : null}

      {/* Desktop / tablet — the dense table (unchanged). */}
      <div className="hidden overflow-x-auto rounded-xl border border-line md:block">
        <table className="w-full min-w-[560px] text-sm">
          <thead>
            <tr className="border-b border-line bg-surface-2 text-left">
              <th className="w-8 px-4 py-2.5" aria-hidden />
              {columns.map((c) => (
                <th
                  key={c.key}
                  className="px-4 py-2.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted"
                >
                  {c.label}
                </th>
              ))}
              <th className="px-4 py-2.5" aria-hidden />
            </tr>
          </thead>
          <tbody>
            {visible.map((row) => {
              const id = String(row.id ?? "");
              const isOpen = expanded === id;
              const archived = !isEmpty(row.archived_at);
              return (
                <Fragment key={id || JSON.stringify(row)}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : id)}
                    // The expandable row is the gate to every record action
                    // (verify, archive, detail), so it must be operable from
                    // the keyboard, not just the mouse.
                    tabIndex={0}
                    role="button"
                    aria-expanded={isOpen}
                    onKeyDown={(event) => {
                      if (event.key === "Enter" || event.key === " ") {
                        event.preventDefault();
                        setExpanded(isOpen ? null : id);
                      }
                    }}
                    className={`cursor-pointer border-b border-line/60 transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-gold-400 ${
                      archived ? "bg-surface-1/40 opacity-60" : "bg-surface-1"
                    }`}
                  >
                    <td className="px-4 py-2.5 font-mono text-[11px] text-fg-muted">
                      {isOpen ? "▾" : "▸"}
                    </td>
                    {columns.map((c) => (
                      <td key={c.key} className="px-4 py-2.5 text-fg-secondary">
                        {cell(row[c.key])}
                      </td>
                    ))}
                    <td className="px-4 py-2.5">
                      {archived ? (
                        <span className="block text-right font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                          Archived
                        </span>
                      ) : (
                        <VerifyBadge row={row} />
                      )}
                    </td>
                  </tr>
                  {isOpen ? (
                    <tr className="bg-surface-2">
                      <td colSpan={colSpan} className="border-t border-line px-4 py-4">
                        <RowDetails
                          row={row}
                          id={id}
                          archived={archived}
                          hub={hub}
                          module={module}
                          table={table}
                        />
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Mobile — card list. No horizontal scroll; large tap targets. */}
      <ul className="flex flex-col gap-2.5 md:hidden">
        {visible.map((row) => {
          const id = String(row.id ?? "");
          const isOpen = expanded === id;
          const archived = !isEmpty(row.archived_at);
          const title = cell(row[primary?.key]);
          const facets = restColumns
            .map((c) => ({ label: c.label, value: cell(row[c.key]) }))
            .filter((f) => f.value !== "—");
          return (
            <li key={id || JSON.stringify(row)}>
              <div
                onClick={() => toggle(id)}
                tabIndex={0}
                role="button"
                aria-expanded={isOpen}
                onKeyDown={(event) => {
                  if (event.key === "Enter" || event.key === " ") {
                    event.preventDefault();
                    toggle(id);
                  }
                }}
                className={`fx-tap cursor-pointer rounded-2xl border p-3.5 transition focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 ${
                  archived
                    ? "border-line/50 bg-surface-1/40 opacity-70"
                    : "border-line/60 bg-surface-1 active:bg-surface-2"
                }`}
              >
                <div className="flex items-start justify-between gap-3">
                  <p className="min-w-0 flex-1 truncate text-[15px] font-semibold leading-tight text-fg-primary">
                    {title}
                  </p>
                  <span aria-hidden className="mt-0.5 shrink-0 font-mono text-[11px] text-fg-muted">
                    {isOpen ? "▾" : "▸"}
                  </span>
                </div>

                {facets.length > 0 && (
                  <dl className="mt-2 grid grid-cols-2 gap-x-3 gap-y-2">
                    {facets.slice(0, isOpen ? facets.length : 4).map((f) => (
                      <div key={f.label} className="min-w-0">
                        <dt className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                          {f.label}
                        </dt>
                        <dd className="truncate text-[13px] text-fg-secondary">{f.value}</dd>
                      </div>
                    ))}
                  </dl>
                )}

                <div className="mt-2.5 flex items-center justify-between gap-2">
                  {archived ? (
                    <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                      Archived
                    </span>
                  ) : (
                    <VerifyBadge row={row} />
                  )}
                </div>

                {isOpen ? (
                  <div
                    // Stop the expanded body's interactive controls (verify,
                    // archive, links) from collapsing the card when tapped.
                    onClick={(e) => e.stopPropagation()}
                    onKeyDown={(e) => e.stopPropagation()}
                    className="mt-3 border-t border-line/60 pt-3"
                  >
                    <RowDetails
                      row={row}
                      id={id}
                      archived={archived}
                      hub={hub}
                      module={module}
                      table={table}
                    />
                  </div>
                ) : null}
              </div>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
