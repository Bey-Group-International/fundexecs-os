"use client";

import { useMemo, useState } from "react";
import type { SignupRow } from "@/lib/admin/reports";

type SortKey =
  | "createdAt"
  | "lastActiveAt"
  | "email"
  | "orgName"
  | "sessionsStarted"
  | "auditActions";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

function relative(iso: string | null): string {
  if (!iso) return "never";
  const diff = Date.now() - new Date(iso).getTime();
  const day = 86_400_000;
  if (diff < day) return "today";
  const days = Math.floor(diff / day);
  if (days === 1) return "1d ago";
  if (days < 30) return `${days}d ago`;
  const months = Math.floor(days / 30);
  return months === 1 ? "1mo ago" : `${months}mo ago`;
}

export function SignupsTable({ rows }: { rows: SignupRow[] }) {
  const [query, setQuery] = useState("");
  const [sortKey, setSortKey] = useState<SortKey>("createdAt");
  const [asc, setAsc] = useState(false);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const base = q
      ? rows.filter(
          (r) =>
            r.email.toLowerCase().includes(q) ||
            (r.fullName ?? "").toLowerCase().includes(q) ||
            (r.orgName ?? "").toLowerCase().includes(q),
        )
      : rows;

    const dir = asc ? 1 : -1;
    return [...base].sort((a, b) => {
      const av = a[sortKey];
      const bv = b[sortKey];
      if (av == null && bv == null) return 0;
      if (av == null) return 1; // nulls last regardless of direction
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, query, sortKey, asc]);

  function toggleSort(key: SortKey) {
    if (key === sortKey) {
      setAsc((v) => !v);
    } else {
      setSortKey(key);
      setAsc(false);
    }
  }

  const arrow = (key: SortKey) =>
    key === sortKey ? (asc ? " ↑" : " ↓") : "";

  return (
    <div className="space-y-3">
      <input
        type="search"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        placeholder="Search name, email, or org…"
        className="w-full max-w-xs rounded-lg border border-line/80 bg-surface-1/70 px-3 py-1.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/40 focus:outline-none"
      />

      <div className="fx-card overflow-x-auto">
        <table className="w-full min-w-[720px] text-left text-sm">
          <thead>
            <tr className="border-b border-line/70 font-mono text-[10px] uppercase tracking-[0.12em] text-fg-muted">
              <Th onClick={() => toggleSort("email")}>User{arrow("email")}</Th>
              <Th onClick={() => toggleSort("orgName")}>Org{arrow("orgName")}</Th>
              <Th>Role</Th>
              <Th onClick={() => toggleSort("createdAt")}>
                Signed up{arrow("createdAt")}
              </Th>
              <Th onClick={() => toggleSort("sessionsStarted")} numeric>
                Sessions{arrow("sessionsStarted")}
              </Th>
              <Th onClick={() => toggleSort("auditActions")} numeric>
                Actions{arrow("auditActions")}
              </Th>
              <Th onClick={() => toggleSort("lastActiveAt")}>
                Last active{arrow("lastActiveAt")}
              </Th>
            </tr>
          </thead>
          <tbody>
            {filtered.map((r) => (
              <tr
                key={r.id}
                className="border-b border-line/40 transition hover:bg-surface-2/40"
              >
                <td className="px-3 py-2.5">
                  <p className="text-fg-primary">{r.fullName || "—"}</p>
                  <p className="font-mono text-[11px] text-fg-muted">
                    {r.email}
                  </p>
                </td>
                <td className="px-3 py-2.5 text-fg-secondary">
                  {r.orgName || (
                    <span className="text-fg-muted">No org</span>
                  )}
                </td>
                <td className="px-3 py-2.5 font-mono text-[11px] text-fg-muted">
                  {r.role || "—"}
                </td>
                <td className="px-3 py-2.5 text-fg-secondary">
                  {fmtDate(r.createdAt)}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-fg-secondary">
                  {r.sessionsStarted}
                </td>
                <td className="px-3 py-2.5 text-right tabular-nums text-fg-secondary">
                  {r.auditActions}
                </td>
                <td className="px-3 py-2.5">
                  <span
                    className={
                      r.lastActiveAt
                        ? "text-fg-secondary"
                        : "text-fg-muted"
                    }
                  >
                    {relative(r.lastActiveAt)}
                  </span>
                </td>
              </tr>
            ))}
            {filtered.length === 0 ? (
              <tr>
                <td
                  colSpan={7}
                  className="px-3 py-8 text-center text-sm text-fg-muted"
                >
                  {rows.length === 0
                    ? "No signups yet."
                    : "No users match your search."}
                </td>
              </tr>
            ) : null}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function Th({
  children,
  onClick,
  numeric,
}: {
  children: React.ReactNode;
  onClick?: () => void;
  numeric?: boolean;
}) {
  return (
    <th
      onClick={onClick}
      className={`px-3 py-2.5 font-medium ${numeric ? "text-right" : ""} ${
        onClick ? "cursor-pointer select-none hover:text-fg-secondary" : ""
      }`}
    >
      {children}
    </th>
  );
}
