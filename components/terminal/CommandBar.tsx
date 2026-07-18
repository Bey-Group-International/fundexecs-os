"use client";

import { useMemo, useRef, useState } from "react";
import { planCommand, type CommandPlan } from "@/lib/terminal/dispatch";

// The command bar: parse → preview the plan → dispatch. As the operator types, the
// plan is previewed live (what it opens, how it's authorized) BEFORE anything
// runs. Enter dispatches; a gated command (Tier-2/3) is previewed and handed to
// the approval path, never executed inline — capital-binding stays human.

export function CommandBar({ onDispatch }: { onDispatch: (plan: CommandPlan) => void }) {
  const [value, setValue] = useState("");
  const inputRef = useRef<HTMLInputElement | null>(null);

  const plan = useMemo(() => planCommand(value), [value]);
  const showPreview = value.trim().length > 0;

  const dispatch = () => {
    if (plan.kind === "incomplete") return; // keep focus; the hint tells them what's missing
    onDispatch(plan);
    setValue("");
  };

  return (
    <div className="relative">
      <div className="flex items-center gap-2 rounded-lg border border-line/70 bg-surface-1 px-3 py-2 focus-within:border-gold-400/60">
        <span className="select-none font-mono text-xs text-gold-400">›</span>
        <input
          ref={inputRef}
          value={value}
          onChange={(e) => setValue(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              dispatch();
            } else if (e.key === "Escape") {
              setValue("");
            }
          }}
          placeholder="Command or question — e.g. DEAL Maple Street · LBO Acme · CAPCALL Fund II · or ask Earn anything"
          spellCheck={false}
          autoComplete="off"
          className="w-full bg-transparent font-mono text-sm text-fg-primary outline-none placeholder:text-fg-muted"
          aria-label="Terminal command"
        />
        {showPreview ? <TierChip plan={plan} /> : null}
      </div>

      {showPreview && plan.summary ? (
        <div className="mt-1.5 flex items-start gap-2 rounded-md border border-line/60 bg-surface-0/70 px-3 py-2 text-xs">
          <span className="mt-0.5 shrink-0 rounded border border-line/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
            {kindLabel(plan)}
          </span>
          <span className={plan.nonDelegable ? "text-status-danger" : "text-fg-secondary"}>
            {plan.summary}
          </span>
        </div>
      ) : null}
    </div>
  );
}

function kindLabel(plan: CommandPlan): string {
  switch (plan.kind) {
    case "navigate":
      return "open";
    case "analyze":
      return "analyze";
    case "workflow":
      return plan.requiresApproval ? "approval" : "run";
    case "ask-earn":
      return "ask earn";
    case "incomplete":
      return "needs input";
    default:
      return "ask earn";
  }
}

function TierChip({ plan }: { plan: CommandPlan }) {
  if (!plan.classification) {
    return (
      <span className="shrink-0 rounded border border-line/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
        NL
      </span>
    );
  }
  const tier = plan.classification.tier;
  const cls =
    tier === 3
      ? "border-status-danger/50 text-status-danger"
      : tier === 2
        ? "border-status-warning/50 text-status-warning"
        : "border-status-success/50 text-status-success";
  return (
    <span className={`shrink-0 rounded border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${cls}`}>
      T{tier}
    </span>
  );
}
