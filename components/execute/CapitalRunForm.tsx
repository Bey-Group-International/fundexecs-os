"use client";

import { useRef, useState } from "react";
import { planRun, type RunKind, type CommitmentLike } from "@/lib/capital-ops";
import { usd } from "@/lib/format";
import { recordCapitalRun } from "@/components/execute/actions";
import { useToast } from "@/components/shared/CoachingToast";

export interface CommitmentRow extends CommitmentLike {
  investorName: string;
}
export interface FundOption {
  id: string;
  name: string;
}

// Execute › Capital Events: the agent-run capital CALL / DISTRIBUTION. The
// operator picks a fund and amount; the allocation across LPs previews live
// (pro-rata by commitment); confirming books one capital_event per LP and rolls
// the ledger. Capital movement is Tier 3 — this confirm IS the operator sign-off.
export default function CapitalRunForm({
  funds,
  commitmentsByFund,
}: {
  funds: FundOption[];
  commitmentsByFund: Record<string, CommitmentRow[]>;
}) {
  const [open, setOpen] = useState(false);
  const [fundId, setFundId] = useState(funds[0]?.id ?? "");
  const [kind, setKind] = useState<RunKind>("capital_call");
  const [amount, setAmount] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState(false);
  const toast = useToast();
  const formRef = useRef<HTMLFormElement>(null);

  if (funds.length === 0) return null;

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="mb-4 inline-flex items-center gap-1.5 rounded-md border border-gold-500/40 bg-gold-500/10 px-3.5 py-2 text-sm font-medium text-gold-300 transition hover:bg-gold-500/20 hover:text-gold-200"
      >
        <span className="font-mono text-base leading-none">⟳</span>
        Run capital call / distribution
      </button>
    );
  }

  const commitments = commitmentsByFund[fundId] ?? [];
  const nameById = new Map(commitments.map((c) => [c.id, c.investorName]));
  const plan = planRun(kind, commitments, Number.isFinite(amount) ? amount : 0);
  const active = plan.allocations.filter((a) => a.allocation > 0);

  return (
    <form
      ref={formRef}
      action={async (fd: FormData) => {
        setPending(true);
        setError(null);
        const result = await recordCapitalRun(fd);
        setPending(false);
        if (!result.ok) {
          const message = result.error ?? "Could not book the run.";
          setError(message);
          toast.error("Run not booked", message);
          return;
        }
        toast.success("Capital run booked");
        formRef.current?.reset();
        setOpen(false);
        setAmount(0);
      }}
      className="mb-4 flex flex-col gap-4 rounded-xl border border-gold-500/30 bg-surface-1 p-5"
    >
      <div className="flex items-center justify-between gap-3">
        <span className="font-mono text-[10px] uppercase tracking-[0.2em] text-gold-400">Capital run</span>
        <span className="rounded-full border border-status-danger/40 bg-status-danger/5 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-status-danger">
          Tier 3 · operator sign-off
        </span>
      </div>

      <input type="hidden" name="fund_id" value={fundId} />
      <input type="hidden" name="kind" value={kind} />
      <input type="hidden" name="amount" value={amount || ""} />

      <div className="grid gap-4 sm:grid-cols-3">
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Fund</span>
          <select
            value={fundId}
            onChange={(e) => setFundId(e.target.value)}
            className="rounded-md border border-line bg-surface-0 px-3 py-2 text-fg-primary outline-none focus:border-gold-500"
          >
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
              </option>
            ))}
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Type</span>
          <select
            value={kind}
            onChange={(e) => setKind(e.target.value as RunKind)}
            className="rounded-md border border-line bg-surface-0 px-3 py-2 text-fg-primary outline-none focus:border-gold-500"
          >
            <option value="capital_call">Capital call</option>
            <option value="distribution">Distribution</option>
          </select>
        </label>
        <label className="flex flex-col gap-1.5 text-sm">
          <span className="text-fg-secondary">Total amount</span>
          <input
            type="number"
            step="any"
            value={amount || ""}
            onChange={(e) => setAmount(Number(e.target.value))}
            className="rounded-md border border-line bg-surface-0 px-3 py-2 font-mono text-fg-primary outline-none focus:border-gold-500"
          />
        </label>
      </div>

      <label className="flex flex-col gap-1.5 text-sm">
        <span className="text-fg-secondary">Reference</span>
        <input
          name="reference"
          placeholder={kind === "capital_call" ? "e.g. Call #3" : "e.g. Q2 distribution"}
          className="rounded-md border border-line bg-surface-0 px-3 py-2 text-fg-primary outline-none focus:border-gold-500"
        />
      </label>

      {/* Live allocation preview */}
      {amount > 0 && commitments.length > 0 ? (
        <div className="overflow-hidden rounded-lg border border-line">
          <div className="flex items-center justify-between bg-surface-2/80 px-4 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            <span>Allocation preview · {active.length} LPs</span>
            <span>
              {usd(plan.totalAllocated)} allocated
              {plan.shortfall > 0 ? ` · ${usd(plan.shortfall)} uncallable` : ""}
            </span>
          </div>
          {active.map((a, i) => (
            <div
              key={a.commitmentId}
              className={`flex items-center justify-between gap-3 bg-surface-1 px-4 py-2 text-sm ${i > 0 ? "border-t border-line/50" : ""}`}
            >
              <span className="min-w-0 truncate text-fg-secondary">{nameById.get(a.commitmentId) ?? "—"}</span>
              <span className="font-mono text-fg-primary">{usd(a.allocation)}</span>
            </div>
          ))}
          {plan.shortfall > 0 ? (
            <div className="border-t border-line/50 bg-surface-1 px-4 py-2 font-mono text-[11px] text-status-danger">
              {usd(plan.shortfall)} could not be called — exceeds unfunded commitments.
            </div>
          ) : null}
        </div>
      ) : (
        <p className="rounded-lg border border-dashed border-line bg-surface-1 px-4 py-3 text-center text-xs text-fg-muted">
          Enter an amount to preview the per-LP allocation.
        </p>
      )}

      {error ? (
        <p className="rounded-lg border border-status-danger/40 bg-status-danger/5 px-4 py-2.5 text-xs text-status-danger">
          {error}
        </p>
      ) : null}

      <div className="flex items-center gap-2">
        <button
          type="submit"
          disabled={pending || !(amount > 0 && plan.totalAllocated > 0)}
          className="rounded-md bg-gold-400 px-4 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300 disabled:cursor-not-allowed disabled:opacity-40"
        >
          {pending ? "Booking…" : `Confirm & book ${kind === "capital_call" ? "call" : "distribution"}`}
        </button>
        <button
          type="button"
          onClick={() => setOpen(false)}
          className="rounded-md border border-line px-4 py-2 text-sm text-fg-secondary transition hover:bg-surface-2"
        >
          Cancel
        </button>
      </div>
    </form>
  );
}
