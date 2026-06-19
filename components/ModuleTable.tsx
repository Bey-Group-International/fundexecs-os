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
    <div className="overflow-hidden rounded-xl border border-line shadow-[0_1px_0_0_rgba(0,0,0,0.4)]">
      <table className="w-full border-collapse text-sm">
        <thead>
          <tr className="border-b border-line bg-surface-2/80 text-left backdrop-blur">
            <th className="w-9 px-4 py-3" aria-hidden />
            {columns.map((c) => (
              <th
                key={c.key}
                className="px-4 py-3 font-mono text-[10px] font-medium uppercase tracking-wider text-fg-muted"
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
                  className={`group cursor-pointer border-b border-line/50 transition-colors last:border-0 ${
                    isOpen ? "bg-surface-2" : "bg-surface-1 hover:bg-surface-2/70"
                  }`}
                >
                  <td className="px-4 py-3">
                    <span
                      className={`inline-block font-mono text-[11px] text-fg-muted transition-transform duration-200 group-hover:text-gold-400 ${
                        isOpen ? "rotate-90 text-gold-400" : ""
                      }`}
                    >
                      ▸
                    </span>
                  </td>
                  {columns.map((c, ci) => (
                    <td
                      key={c.key}
                      className={`px-4 py-3 ${ci === 0 ? "font-medium text-fg-primary" : "text-fg-secondary"}`}
                    >
                      {cell(row[c.key])}
                    </td>
                  ))}
                </tr>
                {isOpen ? (
                  <tr className="bg-surface-2">
                    <td colSpan={columns.length + 1} className="border-b border-line px-4 py-5">
                      <div className="border-l-2 border-gold-500/40 pl-4">
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
                      </div>
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
