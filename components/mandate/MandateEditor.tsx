"use client";

import { useState } from "react";
import type { ActionKind, BlastRadius, GateTier } from "@/lib/gates";
import { MANDATE_ACTION_OPTIONS } from "@/lib/mandate-options";
import { saveMandate } from "@/app/(app)/settings/mandate/actions";

interface MandateEditorProps {
  // The Tier-2 kinds currently pre-authorized by the active mandate.
  autoApprove: ActionKind[];
  // The active mandate's autonomy ceiling (1 = draft only, 2 = act within mandate).
  autonomyCeiling: GateTier;
  // Free-text scope: which hubs, counterparty classes, deal sizes this covers.
  scope?: string;
  // Ordered list of free-text guardrails Earn must respect.
  guardrails?: string[];
  // Hard limits on Earn's automated footprint.
  blastRadius?: BlastRadius;
}

const CEILING_OPTIONS: { value: 1 | 2; label: string; hint: string }[] = [
  {
    value: 1,
    label: "Draft only",
    hint: "Earn prepares everything but holds at the line — you press send.",
  },
  {
    value: 2,
    label: "Act within mandate",
    hint: "Earn runs the actions you've authorized below without waiting for you.",
  },
];

export function MandateEditor({
  autoApprove,
  autonomyCeiling,
  scope = "",
  guardrails = [],
  blastRadius = {},
}: MandateEditorProps) {
  const [selected, setSelected] = useState<Set<ActionKind>>(new Set(autoApprove));
  // The DB caps the ceiling at 2; clamp the seed defensively for the radios.
  const [ceiling, setCeiling] = useState<1 | 2>(autonomyCeiling >= 2 ? 2 : 1);

  const toggle = (kind: ActionKind) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(kind)) next.delete(kind);
      else next.add(kind);
      return next;
    });
  };

  const actionsDisabled = ceiling < 2;

  return (
    <form action={saveMandate} className="flex flex-col gap-8">
      {/* Autonomy ceiling */}
      <section>
        <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">
          Autonomy ceiling
        </h3>
        <p className="mt-1 text-sm text-fg-secondary">
          How far Earn may go on external work before it needs you.
        </p>
        <div className="mt-3 grid gap-2 sm:grid-cols-2">
          {CEILING_OPTIONS.map((opt) => {
            const active = ceiling === opt.value;
            return (
              <label
                key={opt.value}
                className={`flex cursor-pointer flex-col gap-1 rounded-xl border p-4 transition ${
                  active
                    ? "border-gold-500/50 bg-gold-500/10"
                    : "border-line bg-surface-1 hover:bg-surface-2"
                }`}
              >
                <div className="flex items-center gap-2">
                  <input
                    type="radio"
                    name="autonomy_ceiling"
                    value={opt.value}
                    checked={active}
                    onChange={() => setCeiling(opt.value)}
                    className="sr-only"
                  />
                  <span
                    className={`flex h-4 w-4 items-center justify-center rounded-full border ${
                      active ? "border-gold-400" : "border-line"
                    }`}
                    aria-hidden
                  >
                    {active ? <span className="h-2 w-2 rounded-full bg-gold-400" /> : null}
                  </span>
                  <span
                    className={`text-sm font-medium ${
                      active ? "text-gold-300" : "text-fg-primary"
                    }`}
                  >
                    {opt.label}
                  </span>
                </div>
                <span className="pl-6 text-xs leading-snug text-fg-secondary">{opt.hint}</span>
              </label>
            );
          })}
        </div>
      </section>

      {/* Tier 2 — toggleable external actions */}
      <section>
        <div className="flex items-baseline justify-between gap-3">
          <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">
            External actions Earn may run
          </h3>
          <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Tier 2
          </span>
        </div>
        <p className="mt-1 text-sm text-fg-secondary">
          Each toggle pre-authorizes one counterparty-facing action. Everything off the list still
          waits for your sign-off.
        </p>

        <div
          className={`mt-3 flex flex-col gap-2 transition ${
            actionsDisabled ? "pointer-events-none opacity-50" : ""
          }`}
        >
          {actionsDisabled ? (
            <p className="rounded-lg border border-dashed border-line bg-surface-1 px-3 py-2 text-xs text-fg-muted">
              Raise the ceiling to “Act within mandate” to authorize individual actions.
            </p>
          ) : null}
          {MANDATE_ACTION_OPTIONS.map((opt) => {
            const on = selected.has(opt.kind);
            return (
              <label
                key={opt.kind}
                className={`flex cursor-pointer items-start gap-3 rounded-xl border p-3.5 transition ${
                  on
                    ? "border-gold-500/50 bg-gold-500/10"
                    : "border-line bg-surface-1 hover:bg-surface-2"
                }`}
              >
                <input
                  type="checkbox"
                  name="auto_approve"
                  value={opt.kind}
                  checked={on}
                  disabled={actionsDisabled}
                  onChange={() => toggle(opt.kind)}
                  className="sr-only"
                />
                <span
                  className={`mt-0.5 flex h-4 w-4 shrink-0 items-center justify-center rounded border ${
                    on ? "border-gold-400 bg-gold-400/20" : "border-line"
                  }`}
                  aria-hidden
                >
                  {on ? (
                    <svg viewBox="0 0 12 12" className="h-3 w-3 text-gold-300" fill="none">
                      <path
                        d="M2.5 6.2 4.8 8.5 9.5 3.5"
                        stroke="currentColor"
                        strokeWidth="1.6"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  ) : null}
                </span>
                <span className="min-w-0">
                  <span
                    className={`block text-sm font-medium ${
                      on ? "text-gold-300" : "text-fg-primary"
                    }`}
                  >
                    {opt.label}
                  </span>
                  <span className="mt-0.5 block text-xs leading-snug text-fg-secondary">
                    {opt.description}
                  </span>
                </span>
              </label>
            );
          })}
        </div>
      </section>

      {/* Scope — free-text description of what the mandate covers */}
      <section>
        <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">Scope</h3>
        <p className="mt-1 text-sm text-fg-secondary">
          What this mandate covers — which hubs, counterparty classes, and deal sizes. Earn keeps
          its work inside this scope.
        </p>
        <textarea
          name="scope"
          defaultValue={scope}
          rows={2}
          placeholder="e.g. Sourcing and LP outreach for value-add multifamily, $5–25M checks, US Sun Belt."
          className="mt-3 w-full rounded-xl border border-line bg-surface-1 px-3.5 py-2.5 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/50 focus:outline-none"
        />
      </section>

      {/* Guardrails — free-text constraints Earn must respect */}
      <section>
        <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">Guardrails</h3>
        <p className="mt-1 text-sm text-fg-secondary">
          Explicit constraints Earn must respect during execution — one per line. These are folded
          into Earn&apos;s context on every reply.
        </p>
        <textarea
          name="guardrails"
          defaultValue={guardrails.join("\n")}
          rows={4}
          placeholder={"Never contact a counterparty before I review the draft.\nAlways disclose we are an LP, not a direct buyer."}
          className="mt-3 w-full rounded-xl border border-line bg-surface-1 px-3.5 py-2.5 text-sm leading-relaxed text-fg-primary placeholder:text-fg-muted focus:border-gold-500/50 focus:outline-none"
        />
      </section>

      {/* Blast radius — hard limits on the automated footprint */}
      <section>
        <h3 className="font-mono text-[11px] uppercase tracking-[0.2em] text-fg-muted">
          Blast-radius limits
        </h3>
        <p className="mt-1 text-sm text-fg-secondary">
          Hard ceilings on Earn&apos;s automated footprint. A pre-authorized action that would breach
          one of these still falls back to your sign-off.
        </p>
        <div className="mt-3 grid gap-3 sm:grid-cols-2">
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-secondary">Max automated sends / day</span>
            <input
              type="number"
              name="max_outreach_per_day"
              min={0}
              step={1}
              defaultValue={blastRadius.maxOutreachPerDay ?? ""}
              placeholder="e.g. 25"
              className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/50 focus:outline-none"
            />
          </label>
          <label className="flex flex-col gap-1">
            <span className="text-xs font-medium text-fg-secondary">Max $ per action</span>
            <input
              type="number"
              name="max_dollar_per_action"
              min={0}
              step={1000}
              defaultValue={blastRadius.maxDollarPerAction ?? ""}
              placeholder="e.g. 50000"
              className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/50 focus:outline-none"
            />
          </label>
        </div>
        <label className="mt-3 flex flex-col gap-1">
          <span className="text-xs font-medium text-fg-secondary">
            Do-not-contact domains (one per line)
          </span>
          <textarea
            name="forbidden_domains"
            defaultValue={(blastRadius.forbiddenDomains ?? []).join("\n")}
            rows={2}
            placeholder={"competitor.com\nblacklisted-fund.com"}
            className="rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/50 focus:outline-none"
          />
        </label>
      </section>

      {/* Tier 1 — always-on informational note */}
      <section className="rounded-xl border border-line bg-surface-1 p-4">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-fg-primary">Internal work product</span>
          <span className="rounded-full border border-emerald-500/30 bg-emerald-500/10 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-emerald-300">
            Always on
          </span>
        </div>
        <p className="mt-1 text-xs leading-snug text-fg-secondary">
          Drafts, research, scoring, and pipeline updates always run — internal work product never
          leaves the building, so Earn proceeds on its own.
        </p>
      </section>

      {/* Tier 3 — locked */}
      <section className="rounded-xl border border-line bg-surface-1 p-4 opacity-80">
        <div className="flex items-center justify-between gap-3">
          <span className="text-sm font-medium text-fg-primary">Capital- &amp; compliance-binding</span>
          <span className="rounded-full border border-line bg-surface-0 px-2 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
            🔒 Always you
          </span>
        </div>
        <p className="mt-1 text-xs leading-snug text-fg-secondary">
          Signing, term sheets, capital calls, and moving money create a binding obligation. These
          are never delegable — they always require you.
        </p>
      </section>

      <div className="flex items-center gap-3 border-t border-line pt-5">
        <button
          type="submit"
          className="rounded-md border border-gold-500/40 bg-gold-500/10 px-4 py-2 text-sm font-medium text-gold-300 transition hover:bg-gold-500/20"
        >
          Save mandate
        </button>
        <span className="text-xs text-fg-muted">
          {selected.size && ceiling >= 2
            ? `${selected.size} action${selected.size === 1 ? "" : "s"} pre-authorized`
            : "No external actions pre-authorized — everything waits for you"}
        </span>
      </div>
    </form>
  );
}
