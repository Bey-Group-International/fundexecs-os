"use client";

import { Fragment, useState } from "react";

interface Column {
  key: string;
  label: string;
}

function cell(value: unknown): string {
  if (value === null || value === undefined || value === "") return "—";
  if (typeof value === "boolean") return value ? "Yes" : "No";
  if (typeof value === "object") return "—";
  return String(value);
}

// Fields that are internal noise and never shown in the detail panel.
const HIDDEN_FIELDS = new Set(["id", "organization_id", "updated_at"]);

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

export default function ModuleTable({
  columns,
  rows,
}: {
  columns: Column[];
  rows: Record<string, unknown>[];
}) {
  const [expanded, setExpanded] = useState<number | null>(null);

  return (
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
          </tr>
        </thead>
        <tbody>
          {rows.map((row, i) => {
            const isOpen = expanded === i;
            const detailEntries = Object.entries(row).filter(
              ([k, v]) => !HIDDEN_FIELDS.has(k) && !isEmpty(v),
            );
            return (
              <Fragment key={i}>
                <tr
                  onClick={() => setExpanded(isOpen ? null : i)}
                  className="cursor-pointer border-b border-line/60 bg-surface-1 transition hover:bg-surface-2"
                >
                  <td className="px-4 py-2.5 font-mono text-[11px] text-fg-muted">
                    {isOpen ? "▾" : "▸"}
                  </td>
                  {columns.map((c) => (
                    <td key={c.key} className="px-4 py-2.5 text-fg-secondary">
                      {cell(row[c.key])}
                    </td>
                  ))}
                </tr>
                {isOpen ? (
                  <tr className="bg-surface-2">
                    <td colSpan={columns.length + 1} className="border-t border-line px-4 py-4">
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
                    </td>
                  </tr>
                ) : null}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
