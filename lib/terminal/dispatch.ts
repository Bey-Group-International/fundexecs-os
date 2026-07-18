// lib/terminal/dispatch.ts
// The command → plan resolver. Given raw command-bar text it produces a
// CommandPlan: what the command will do, how it is authorized (via the action
// contract), which pane (if any) it opens, and a human-readable summary the bar
// previews BEFORE anything executes. Pure + dependency-free + fully tested — both
// the client command bar and the server action consume the same decision so the
// preview shown and the run recorded can never disagree.
//
// This is the "parse → preview the plan → dispatch through the action contract"
// spine: navigation opens a pane immediately (read-only, Tier-1); analysis/draft
// runs immediately; anything gated (Tier-2/Tier-3) previews and requires approval,
// with capital-binding staying human-non-delegable exactly as the contract says.

import { parseCommand, isComplete } from "./parse";
import type { ParsedCommand } from "./types";
import { classifySideEffect, type ActionClassification } from "./action-contract";
import type { PaneType } from "./layout";

export type PlanKind =
  | "navigate" // opens a read-only pane
  | "analyze" // runs an analysis into a pane (Tier-1 compute)
  | "workflow" // a workflow action (Tier-1 write, or Tier-2/3 gated)
  | "ask-earn" // hand the raw text to Earn to plan
  | "incomplete" // recognized verb, missing a required arg
  | "unknown"; // not a command — fall back to the NL path

export interface CommandPlan {
  raw: string;
  parsed: ParsedCommand | null;
  kind: PlanKind;
  classification: ActionClassification | null;
  /** The pane this command opens, when it is a pane-producing command. */
  pane: { paneType: PaneType; title: string; entityLabel?: string } | null;
  /** A one-line description of what pressing Enter will do. */
  summary: string;
  /** True when the command cannot execute without an approval step. */
  requiresApproval: boolean;
  /** True when approval can never be delegated/automated (capital-binding). */
  nonDelegable: boolean;
  /** True when a preview/dry-run must be shown before execution. */
  requiresPreview: boolean;
  /** Missing required argument names (kind === "incomplete"). */
  missing: string[];
  /** Best-effort deep link into the corresponding full FundExecs surface. */
  deepLink: string | null;
}

// Which navigation/analysis verbs open which pane type.
const PANE_FOR_VERB: Record<string, PaneType> = {
  DEAL: "deal",
  FUND: "fund",
  LP: "lp",
  GP: "gp",
  COMPANY: "company",
  PERSON: "person",
  LENDER: "company",
  PORT: "portfolio",
  PIPE: "pipeline",
  REL: "relationship",
  RELGRAPH: "relationship",
  DOC: "document",
  ROOM: "dataroom",
  WATCH: "watchlist",
  ALERTS: "alerts",
  // analysis verbs render into an analysis pane
  LBO: "analysis",
  VAL: "analysis",
  COMPS: "analysis",
  RETURNS: "analysis",
  EXPOSURE: "analysis",
  SCENARIO: "analysis",
  RISK: "analysis",
  IC: "analysis",
  WATERFALL: "analysis",
  CAPTABLE: "analysis",
  BENCHMARK: "analysis",
};

// Best-effort deep links into existing surfaces (index routes; the pane binds the
// specific record once resolved). Only where a clear route exists today.
const DEEP_LINK_FOR_VERB: Record<string, string> = {
  DEAL: "/deals",
  PIPE: "/deals",
  FUND: "/portfolio",
  PORT: "/portfolio",
  LP: "/investor",
  REL: "/relationship",
  RELGRAPH: "/graph",
  DOC: "/document",
  ROOM: "/dataroom",
  WATCH: "/signals",
  ALERTS: "/signals",
};

const CATEGORY_KIND: Record<string, PlanKind> = {
  navigation: "navigate",
  analysis: "analyze",
  workflow: "workflow",
};

/** Resolve raw command-bar text into a plan. Never throws. */
export function planCommand(input: string): CommandPlan {
  const raw = (input ?? "").trim();
  const parsed = parseCommand(raw);

  if (!parsed) {
    // Not a recognized command → the "ask earn" natural-language fallback.
    return {
      raw,
      parsed: null,
      kind: "unknown",
      classification: null,
      pane: null,
      summary: raw ? `Ask Earn: “${raw}”` : "",
      requiresApproval: false,
      nonDelegable: false,
      requiresPreview: false,
      missing: [],
      deepLink: null,
    };
  }

  const cmd = parsed.command;
  const classification = classifySideEffect(cmd.sideEffect);
  const missing = cmd.args
    .filter((a) => a.required && !parsed.args[a.name]?.trim())
    .map((a) => a.name);
  const entityLabel = firstArgValue(parsed);

  if (!isComplete(parsed)) {
    return {
      raw,
      parsed,
      kind: "incomplete",
      classification,
      pane: null,
      summary: `${cmd.verb} needs: ${missing.join(", ")}`,
      requiresApproval: false,
      nonDelegable: false,
      requiresPreview: false,
      missing,
      deepLink: null,
    };
  }

  // The explicit natural-language planner verb.
  if (cmd.verb === "ASK EARN") {
    return {
      raw,
      parsed,
      kind: "ask-earn",
      classification,
      pane: { paneType: "copilot", title: "Earn", entityLabel },
      summary: `Ask Earn to plan: “${parsed.args.request ?? ""}”`,
      requiresApproval: false,
      nonDelegable: false,
      requiresPreview: false,
      missing: [],
      deepLink: "/earn",
    };
  }

  const paneType = PANE_FOR_VERB[cmd.verb];
  const kind: PlanKind = CATEGORY_KIND[cmd.category] ?? "workflow";

  const pane = paneType
    ? { paneType, title: paneTitle(cmd.verb, entityLabel), entityLabel }
    : null;

  return {
    raw,
    parsed,
    kind,
    classification,
    pane,
    summary: summarize(cmd.verb, cmd.description, entityLabel, classification),
    requiresApproval: classification.approval !== "none",
    nonDelegable: classification.approval === "human_nondelegable",
    requiresPreview: classification.requiresPreview,
    missing: [],
    deepLink: DEEP_LINK_FOR_VERB[cmd.verb] ?? null,
  };
}

function firstArgValue(parsed: ParsedCommand): string | undefined {
  const restArg = parsed.command.args.find((a) => a.rest);
  const key = restArg?.name ?? parsed.command.args[0]?.name;
  return key ? parsed.args[key] : undefined;
}

function paneTitle(verb: string, entityLabel?: string): string {
  const label = VERB_LABEL[verb] ?? verb;
  return entityLabel ? `${label}: ${entityLabel}` : label;
}

const VERB_LABEL: Record<string, string> = {
  DEAL: "Deal",
  FUND: "Fund",
  LP: "Investor",
  GP: "Manager",
  COMPANY: "Company",
  PERSON: "Person",
  LENDER: "Lender",
  PORT: "Portfolio",
  PIPE: "Pipeline",
  REL: "Relationship",
  RELGRAPH: "Relationship graph",
  DOC: "Documents",
  ROOM: "Data room",
  WATCH: "Watchlist",
  ALERTS: "Alerts",
  LBO: "LBO",
  VAL: "Valuation",
  COMPS: "Comps",
  RETURNS: "Returns",
  EXPOSURE: "Exposure",
  SCENARIO: "Scenario",
  RISK: "Risk",
  IC: "IC memo",
  WATERFALL: "Waterfall",
  CAPTABLE: "Cap table",
  BENCHMARK: "Benchmark",
};

function summarize(
  verb: string,
  description: string,
  entityLabel: string | undefined,
  c: ActionClassification,
): string {
  const subject = entityLabel ? ` — ${entityLabel}` : "";
  if (c.approval === "human_nondelegable") {
    return `${description}${subject}. Capital-binding: prepares a draft; execution requires human sign-off (Tier 3, non-delegable).`;
  }
  if (c.approval === "operator") {
    return `${description}${subject}. Requires operator approval before it takes effect (Tier 2).`;
  }
  return `${description}${subject}.`;
}
