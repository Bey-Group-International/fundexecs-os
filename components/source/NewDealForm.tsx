"use client";

// Creating a deal — the pipeline's missing front door.
//
// `POST /api/network/opportunities` shipped with the pipeline and had no caller
// at all, so every deal on the board had to arrive through the API by hand. The
// board could move work it could not create, which makes the whole feature
// unreachable for the person it was built for.
//
// This is also where `fund_id` finally gets set. It has been on the row since
// the workspace migration with no interface able to fill it, which is why
// "pipeline for Fund III" has been unanswerable regardless of how good the
// rollup underneath it was.

import { useCallback, useEffect, useState } from "react";
import {
  OPPORTUNITY_STAGES,
  STAGE_LABEL,
  type OpportunityStage,
} from "@/lib/network-opportunities";
import type { FundOption } from "@/app/api/network/funds/route";

interface CounterpartyOption {
  id: string;
  name: string;
  /** Which column the id belongs in. The roster mixes sources: a row of kind
   *  "investor" carries an investors.id, and sending that as contact_id is an
   *  opaque foreign-key error rather than a deal. */
  kind: "contact" | "investor";
  org: string | null;
}

interface Props {
  owners?: { id: string; name: string }[];
  /** Called with the created deal so the board can show it without a refetch. */
  onCreated?: () => void;
  onCancel?: () => void;
}

/** Stages a deal can be BORN in. Nothing is created already closed. */
const OPENING_STAGES = OPPORTUNITY_STAGES.filter(
  (s) => s !== "committed" && s !== "passed",
);

/**
 * The pipeline's create form — an allocation, its counterparty and its fund.
 *
 * The roster mixes sources, so the chosen id is routed to `contactId` or
 * `investorId` by the row's kind; sending an `investors.id` as a contact is an
 * opaque foreign-key error rather than a visible refusal.
 */
export function NewDealForm({ owners = [], onCreated, onCancel }: Props) {
  const [name, setName] = useState("");
  const [counterparty, setCounterparty] = useState<CounterpartyOption | null>(null);
  const [contactQuery, setContactQuery] = useState("");
  const [matches, setMatches] = useState<CounterpartyOption[]>([]);
  const [fundId, setFundId] = useState("");
  const [funds, setFunds] = useState<FundOption[]>([]);
  const [stage, setStage] = useState<OpportunityStage>("sourced");
  const [targetAmount, setTargetAmount] = useState("");
  const [currency, setCurrency] = useState("USD");
  const [expectedClose, setExpectedClose] = useState("");
  const [ownerId, setOwnerId] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      try {
        const res = await fetch("/api/network/funds");
        const body = (await res.json().catch(() => null)) as { funds?: FundOption[] } | null;
        if (!cancelled && res.ok) setFunds(body?.funds ?? []);
      } catch {
        // A fund is optional on a deal, so failing to load the list is not
        // worth blocking the form for — it just leaves the picker empty.
      }
    })();
    return () => {
      cancelled = true;
    };
  }, []);

  // Contact lookup, debounced. A deal needs a counterparty and the roster is
  // too long to put in a select.
  useEffect(() => {
    const term = contactQuery.trim();
    if (term.length < 2) {
      setMatches([]);
      return;
    }
    let cancelled = false;
    const timer = setTimeout(() => {
      void (async () => {
        try {
          const params = new URLSearchParams({ q: term, limit: "8" });
          const res = await fetch(`/api/network/roster?${params}`);
          const body = (await res.json().catch(() => null)) as
            | { rows?: { id: string; name: string; kind: string; org: string | null }[] }
            | null;
          if (cancelled || !res.ok) return;
          // Only the kinds a deal can actually name. A "partner" or "provider"
          // row has neither a contact nor an investor id and would be refused
          // by the counterparty constraint.
          setMatches(
            (body?.rows ?? [])
              .filter((r) => r.kind === "contact" || r.kind === "investor")
              .map((r) => ({
                id: String(r.id),
                name: String(r.name ?? "Unknown"),
                kind: r.kind === "investor" ? "investor" : "contact",
                org: r.org ?? null,
              })),
          );
        } catch {
          if (!cancelled) setMatches([]);
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [contactQuery]);

  const submit = useCallback(async () => {
    if (!name.trim()) {
      setError("A deal needs a name.");
      return;
    }
    if (!counterparty) {
      setError("Pick the contact or investor this deal is with.");
      return;
    }

    setSaving(true);
    try {
      const res = await fetch("/api/network/opportunities", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: name.trim(),
          // The id goes in whichever column its source belongs to.
          contactId: counterparty.kind === "contact" ? counterparty.id : null,
          investorId: counterparty.kind === "investor" ? counterparty.id : null,
          // Empty string is not "no fund" to a uuid column; send null.
          fundId: fundId || null,
          stage,
          targetAmount: targetAmount.trim() || null,
          currency,
          expectedClose: expectedClose || null,
          ownerId: ownerId || null,
        }),
      });
      const body = (await res.json().catch(() => null)) as { error?: string } | null;
      if (!res.ok) throw new Error(body?.error ?? "Couldn't create that deal.");
      setError(null);
      onCreated?.();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Couldn't create that deal.");
    } finally {
      setSaving(false);
    }
  }, [name, counterparty, fundId, stage, targetAmount, currency, expectedClose, ownerId, onCreated]);

  const field = "w-full rounded-md border border-hairline bg-surface-raised px-2 py-1.5 text-sm text-fg-primary";
  const label = "text-[11px] uppercase tracking-wide text-fg-muted";

  return (
    <form
      className="fx-card flex flex-col gap-3 p-4"
      onSubmit={(e) => {
        e.preventDefault();
        void submit();
      }}
    >
      <div className="flex items-baseline justify-between">
        <h3 className="font-display text-sm font-semibold text-fg-primary">New allocation</h3>
        {onCancel && (
          <button
            type="button"
            onClick={onCancel}
            className="text-xs text-fg-muted hover:text-fg-primary"
          >
            Cancel
          </button>
        )}
      </div>

      <div className="grid gap-3 sm:grid-cols-2">
        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={label}>What it is</span>
          <input
            value={name}
            onChange={(e) => setName(e.target.value)}
            placeholder="Fund III — Meridian Pension"
            className={field}
            required
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>With</span>
          <input
            value={contactQuery}
            onChange={(e) => {
              setContactQuery(e.target.value);
              setCounterparty(null);
            }}
            placeholder="Search the book…"
            className={field}
            aria-describedby="deal-contact-help"
          />
          {matches.length > 0 && !counterparty && (
            <ul className="max-h-36 overflow-auto rounded-md border border-hairline">
              {matches.map((c) => (
                <li key={`${c.kind}-${c.id}`}>
                  <button
                    type="button"
                    onClick={() => {
                      setCounterparty(c);
                      setContactQuery(c.name);
                      setMatches([]);
                    }}
                    className="flex w-full items-baseline gap-2 px-2 py-1.5 text-left text-xs text-fg-secondary hover:bg-fg-primary/5"
                  >
                    <span className="truncate">{c.name}</span>
                    {c.org && <span className="truncate text-fg-muted">{c.org}</span>}
                    <span className="ml-auto shrink-0 text-[10px] uppercase text-fg-muted">
                      {c.kind}
                    </span>
                  </button>
                </li>
              ))}
            </ul>
          )}
          <span id="deal-contact-help" className="text-[11px] text-fg-muted">
            {counterparty
              ? `Selected — ${counterparty.kind}.`
              : "Type at least two letters."}
          </span>
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Into</span>
          <select value={fundId} onChange={(e) => setFundId(e.target.value)} className={field}>
            <option value="">No fund yet</option>
            {funds.map((f) => (
              <option key={f.id} value={f.id}>
                {f.name}
                {f.vintageYear ? ` (${f.vintageYear})` : ""}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Stage</span>
          <select
            value={stage}
            onChange={(e) => setStage(e.target.value as OpportunityStage)}
            className={field}
          >
            {OPENING_STAGES.map((s) => (
              <option key={s} value={s}>
                {STAGE_LABEL[s]}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Owner</span>
          <select value={ownerId} onChange={(e) => setOwnerId(e.target.value)} className={field}>
            <option value="">Me</option>
            {owners.map((o) => (
              <option key={o.id} value={o.id}>
                {o.name}
              </option>
            ))}
          </select>
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Target size</span>
          <input
            value={targetAmount}
            onChange={(e) => setTargetAmount(e.target.value)}
            placeholder="10,000,000"
            inputMode="decimal"
            className={field}
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className={label}>Currency</span>
          <input
            value={currency}
            onChange={(e) => setCurrency(e.target.value.toUpperCase().slice(0, 3))}
            maxLength={3}
            className={`${field} font-mono uppercase`}
          />
        </label>

        <label className="flex flex-col gap-1 sm:col-span-2">
          <span className={label}>Expected close</span>
          <input
            type="date"
            value={expectedClose}
            onChange={(e) => setExpectedClose(e.target.value)}
            className={field}
          />
        </label>
      </div>

      {error && (
        <p className="rounded-lg border border-rose-500/30 bg-rose-500/10 px-3 py-2 text-xs text-rose-200">
          {error}
        </p>
      )}

      <button
        type="submit"
        disabled={saving}
        className="self-start rounded-md bg-accent-300/20 px-3 py-1.5 text-sm text-accent-200 transition hover:bg-accent-300/30 disabled:opacity-50"
      >
        {saving ? "Creating…" : "Create allocation"}
      </button>
    </form>
  );
}
