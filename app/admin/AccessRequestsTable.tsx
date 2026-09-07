"use client";

import { useState, useTransition } from "react";
import type { AccessRequestRow } from "@/lib/access-requests";
import {
  APPLICANT_TYPE_LABEL,
  AUM_OPTIONS,
  STRATEGY_OPTIONS,
  labelForDetail,
  labelForDetailKey,
} from "@/lib/access-request-fields";
import { approveAccessRequest, declineAccessRequest } from "./actions";

function fmtDate(iso: string | null): string {
  if (!iso) return "—";
  return new Date(iso).toLocaleDateString("en-US", {
    month: "short",
    day: "numeric",
    year: "numeric",
  });
}

/** Label a stored option value, falling back to the raw value. */
function optionLabel(
  options: { value: string; label: string }[],
  value: string | null,
): string | null {
  if (!value) return null;
  return options.find((o) => o.value === value)?.label ?? value;
}

/**
 * The applicant's answers as [label, value] pairs, in review order. Only
 * answers they actually gave — a field their type never asked for is absent,
 * not blank.
 */
function profileChips(row: AccessRequestRow): [string, string][] {
  const chips: [string, string][] = [];
  if (row.hqLocation) chips.push(["Location", row.hqLocation]);
  const aum = optionLabel(AUM_OPTIONS, row.aumRange);
  if (aum) chips.push(["AUM", aum]);
  if (row.fundCount != null) chips.push(["Funds", String(row.fundCount)]);
  const strategy = optionLabel(STRATEGY_OPTIONS, row.primaryStrategy);
  if (strategy) chips.push(["Strategy", strategy]);
  for (const [key, value] of Object.entries(row.details)) {
    chips.push([labelForDetailKey(key), labelForDetail(key, value)]);
  }
  if (row.website) chips.push(["Web", row.website]);
  if (row.phone) chips.push(["Phone", row.phone]);
  return chips;
}

const STATUS_STYLE: Record<AccessRequestRow["status"], string> = {
  pending: "border-gold-500/30 bg-gold-500/10 text-gold-300",
  approved: "border-emerald-500/30 bg-emerald-500/10 text-emerald-300",
  declined: "border-line bg-surface-2 text-fg-muted",
};

/**
 * The invite-only queue. Approving stamps the request AND, when the person
 * already has an auth account, unblocks their next sign-in; the approval email
 * goes out server-side. Decisions are reversible — approve a declined request
 * and it flips back — so neither button is destructive.
 */
export function AccessRequestsTable({ rows }: { rows: AccessRequestRow[] }) {
  const [pending, startTransition] = useTransition();
  const [busyId, setBusyId] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  function act(id: string, decision: "approved" | "declined") {
    setError(null);
    setBusyId(id);
    startTransition(async () => {
      const result =
        decision === "approved"
          ? await approveAccessRequest(id)
          : await declineAccessRequest(id);
      setBusyId(null);
      if (result.error) setError(result.error);
    });
  }

  if (rows.length === 0) {
    return (
      <div className="fx-card p-5 text-sm text-fg-muted">
        No access requests yet. New operators land here from{" "}
        <span className="font-mono text-fg-secondary">/request-access</span>.
      </div>
    );
  }

  return (
    <div className="space-y-3">
      {error ? (
        <p className="rounded-md border border-red-500/20 bg-red-500/10 px-3 py-2 text-sm text-red-400">
          {error}
        </p>
      ) : null}

      <div className="fx-card divide-y divide-line/60">
        {rows.map((row) => (
          <div key={row.id} className="flex flex-wrap items-start gap-4 p-3.5">
            <div className="min-w-0 flex-1">
              <div className="flex flex-wrap items-center gap-2">
                <p className="truncate text-sm text-fg-primary">
                  {row.fullName || row.email}
                </p>
                <span
                  className={`rounded-md border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-[0.12em] ${STATUS_STYLE[row.status]}`}
                >
                  {row.status}
                </span>
                {row.applicantType ? (
                  <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-fg-secondary">
                    {APPLICANT_TYPE_LABEL[row.applicantType]}
                  </span>
                ) : null}
                {row.hasAccount ? (
                  <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
                    has account
                  </span>
                ) : null}
                {row.decidedVia === "email" ? (
                  <span className="rounded-md border border-line px-1.5 py-0.5 font-mono text-[11px] text-fg-muted">
                    via email
                  </span>
                ) : null}
              </div>
              <p className="mt-0.5 truncate font-mono text-[11px] text-fg-muted">
                {row.email}
                {row.organizationName ? ` · ${row.organizationName}` : ""}
                {row.role ? ` · ${row.role}` : ""}
              </p>
              {/* Everything their type was asked for. Rendered as chips rather
                  than a fixed column set: which answers exist depends on who
                  they are, and an empty column reads like a missing answer. */}
              {profileChips(row).length > 0 ? (
                <div className="mt-1.5 flex flex-wrap gap-1">
                  {profileChips(row).map(([label, value]) => (
                    <span
                      key={label}
                      className="rounded border border-line/70 px-1.5 py-0.5 font-mono text-[10px] text-fg-secondary"
                    >
                      {label}: {value}
                    </span>
                  ))}
                </div>
              ) : null}
              {row.note ? (
                <p className="mt-2 border-l-2 border-gold-500/40 pl-3 text-sm text-fg-secondary">
                  {row.note}
                </p>
              ) : null}
            </div>

            <div className="shrink-0 text-right">
              <p className="font-mono text-[11px] text-fg-muted">
                {fmtDate(row.createdAt)}
              </p>
              {row.reviewedAt ? (
                <p className="font-mono text-[11px] text-fg-muted">
                  reviewed {fmtDate(row.reviewedAt)}
                </p>
              ) : null}
            </div>

            <div className="flex shrink-0 items-center gap-2">
              {row.status !== "approved" ? (
                <button
                  onClick={() => act(row.id, "approved")}
                  disabled={pending && busyId === row.id}
                  className="rounded-md bg-gold-400 px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-on-gold transition hover:opacity-90 disabled:opacity-50"
                >
                  Approve
                </button>
              ) : null}
              {row.status !== "declined" ? (
                <button
                  onClick={() => act(row.id, "declined")}
                  disabled={pending && busyId === row.id}
                  className="rounded-md border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-[0.12em] text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary disabled:opacity-50"
                >
                  Decline
                </button>
              ) : null}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
