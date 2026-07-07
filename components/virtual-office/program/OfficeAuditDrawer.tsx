"use client";

import { useState } from "react";
import { RISK_TIERS } from "./officeProgram";
import { useOfficeProgram } from "./useOfficeProgram";

const GOLD = "#c9a84c";

const STATUS_COLOR: Record<string, string> = {
  info: "#64748b",
  pending: "#f59e0b",
  approved: "#22c55e",
  rejected: "#ef4444",
  complete: "#22c55e",
};

/**
 * Audit-ready activity log. Every command, plan, assignment, room
 * activation, meeting, approval, and completion is recorded with
 * timestamp, actor, room, and risk tier. Mirrored best-effort into the
 * append-only office_audit_log table via office-actions.ts when a persistence
 * sink is registered.
 */
export function OfficeAuditDrawer() {
  const s = useOfficeProgram();
  const [open, setOpen] = useState(false);

  return (
    <div
      className="overflow-hidden rounded-lg border"
      style={{ borderColor: "rgba(201,168,76,0.2)", background: "#0a0806" }}
    >
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        className="flex w-full items-center justify-between px-3 py-2 text-left"
      >
        <span className="text-[10px] uppercase tracking-[0.22em]" style={{ color: GOLD, fontFamily: "Georgia, serif" }}>
          Audit Trail
        </span>
        <span className="text-[9px] text-slate-500">
          {s.audit.length} event{s.audit.length === 1 ? "" : "s"} {open ? "▾" : "▸"}
        </span>
      </button>

      {open && (
        <div className="max-h-56 overflow-y-auto border-t" style={{ borderColor: "rgba(201,168,76,0.12)" }}>
          <AuditTable />
        </div>
      )}
    </div>
  );
}

/**
 * The audit events table — the append-only institutional record, newest first.
 * Presentational; reads live audit state. Reused by the status strip's audit
 * dropdown and the standalone drawer.
 */
export function AuditTable() {
  const s = useOfficeProgram();
  const events = [...s.audit].reverse();

  if (events.length === 0) {
    return (
      <p className="px-3 py-3 text-[10px] text-slate-600">
        No audit events yet. Every command and approval will be recorded here.
      </p>
    );
  }
  return (
    <table className="w-full text-left text-[9px]">
      <thead>
        <tr className="text-[8px] uppercase tracking-wider text-slate-600">
          <th className="px-3 pb-1 pt-2 font-normal">Time</th>
          <th className="pb-1 pr-2 pt-2 font-normal">Actor</th>
          <th className="pb-1 pr-2 pt-2 font-normal">Action</th>
          <th className="pb-1 pr-2 pt-2 font-normal">Room</th>
          <th className="pb-1 pr-2 pt-2 font-normal">Tier</th>
          <th className="pb-1 pr-3 pt-2 font-normal">Status</th>
        </tr>
      </thead>
      <tbody>
        {events.map((ev) => (
          <tr key={ev.id} className="border-t align-top" style={{ borderColor: "rgba(255,255,255,0.04)" }}>
            <td className="whitespace-nowrap py-1 pl-3 pr-2 text-slate-600">
              {new Date(ev.ts).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit", second: "2-digit" })}
            </td>
            <td className="whitespace-nowrap py-1 pr-2" style={{ color: GOLD }}>{ev.actor}</td>
            <td className="py-1 pr-2 text-slate-300">{ev.action}</td>
            <td className="whitespace-nowrap py-1 pr-2 text-slate-500">{ev.room}</td>
            <td className="whitespace-nowrap py-1 pr-2">
              {ev.tier ? (
                <span style={{ color: RISK_TIERS[ev.tier].color }}>{RISK_TIERS[ev.tier].short}</span>
              ) : (
                <span className="text-slate-700">—</span>
              )}
            </td>
            <td className="whitespace-nowrap py-1 pr-3 uppercase" style={{ color: STATUS_COLOR[ev.status] }}>
              {ev.status}
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}
