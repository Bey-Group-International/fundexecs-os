"use client";

import { Fragment, useState } from "react";
import Link from "next/link";
import { RecordLifecycleActions } from "@/components/RecordLifecycleActions";

interface Column {
  key: string;
  label: string;
}

type Row = Record<string, unknown> & { id?: string };

function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return "—";
  return String(value);
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

function humanize(key: string): string {
  return key
    .split("_")
    .filter(Boolean)
    .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
    .join(" ");
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

// Table-backed module list with inline verification + lifecycle management.
// Live rows show by default; archived rows are revealed by a toggle and can be
// restored or permanently deleted. Every row can be verified (with an optional
// evidence note) so AI-sourced and imported records carry an explicit, audited
// confirmation before they're trusted downstream.
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

      <div className="overflow-hidden rounded-xl border border-line">
        <table className="w-full text-sm">
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
              const detailEntries = Object.entries(row).filter(
                ([k, v]) => !HIDDEN_FIELDS.has(k) && !isEmpty(v),
              );
              return (
                <Fragment key={id || JSON.stringify(row)}>
                  <tr
                    onClick={() => setExpanded(isOpen ? null : id)}
                    className={`cursor-pointer border-b border-line/60 transition hover:bg-surface-2 ${
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
                              Evidence:{" "}
                              <span className="text-fg-secondary">{row.verification_note}</span>
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
                      </td>
                    </tr>
                  ) : null}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
