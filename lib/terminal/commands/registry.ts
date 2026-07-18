// lib/terminal/commands/registry.ts
// The terminal command catalog — the initial FundExecs Command Language (System 2).
//
// Each entry is a typed CommandDefinition: its verb/aliases, the argument it takes,
// the permission scopes it needs, its side-effect level (resolved to a gate tier by
// the action contract), and its owning executive. This registry is the pluggable
// seam — a new command (native or extension-contributed) is added by registering a
// definition here (or via the extension platform), exactly as skills register in
// lib/skills/registry.ts. It is pure data + lookup; execution wiring (to war rooms,
// skills, and the engine) is layered on in the terminal runtime.

import type { CommandDefinition } from "../types";

// Every verb is upper-case by convention; aliases are matched case-insensitively.
const ENTITY_ARG = { name: "entity", rest: true, required: true, description: "Entity name or id" } as const;

const COMMANDS: CommandDefinition[] = [
  // --- Navigation / entity research (read-only) ---
  { verb: "DEAL", aliases: [], category: "navigation", description: "Open a deal workspace", example: "DEAL Maple Street", args: [ENTITY_ARG], requiredScopes: ["deals:read"], sideEffect: "read-only", dryRunnable: false },
  { verb: "FUND", aliases: [], category: "navigation", description: "Open a fund workspace", example: "FUND Fund III", args: [ENTITY_ARG], requiredScopes: ["funds:read"], sideEffect: "read-only", dryRunnable: false },
  { verb: "LP", aliases: ["INVESTOR"], category: "navigation", description: "Open an investor/LP workspace", example: "LP Redwood Family Office", args: [ENTITY_ARG], requiredScopes: ["investors:read"], sideEffect: "read-only", dryRunnable: false },
  { verb: "GP", aliases: ["MANAGER"], category: "navigation", description: "Open a GP/manager profile", example: "GP Northwind Capital", args: [ENTITY_ARG], requiredScopes: ["funds:read"], sideEffect: "read-only", dryRunnable: false },
  { verb: "COMPANY", aliases: ["COMP"], category: "navigation", description: "Open a company/target workspace", example: "COMPANY Acme Software", args: [ENTITY_ARG], requiredScopes: ["entities:read"], sideEffect: "read-only", dryRunnable: false },
  { verb: "PERSON", aliases: ["CONTACT"], category: "navigation", description: "Open a person/contact record", example: "PERSON Jane Doe", args: [ENTITY_ARG], requiredScopes: ["relationships:read"], sideEffect: "read-only", dryRunnable: false },
  { verb: "LENDER", aliases: [], category: "navigation", description: "Open a lender/credit provider", example: "LENDER Bridge Debt Partners", args: [ENTITY_ARG], requiredScopes: ["entities:read"], sideEffect: "read-only", dryRunnable: false },
  { verb: "PORT", aliases: ["PORTFOLIO"], category: "navigation", description: "Open a portfolio view", example: "PORT Fund II", args: [{ name: "entity", rest: true, required: false, description: "Portfolio/fund name (optional)" }], requiredScopes: ["funds:read"], sideEffect: "read-only", dryRunnable: false },
  { verb: "PIPE", aliases: ["PIPELINE"], category: "navigation", description: "Open the deal pipeline", example: "PIPE", args: [], requiredScopes: ["deals:read"], sideEffect: "read-only", dryRunnable: false },
  { verb: "REL", aliases: ["RELATIONSHIP"], category: "navigation", description: "Open a relationship record", example: "REL Redwood", args: [ENTITY_ARG], requiredScopes: ["relationships:read"], sideEffect: "read-only", dryRunnable: false },
  { verb: "DOC", aliases: ["DOCUMENT"], category: "navigation", description: "Search documents", example: "DOC purchase agreement", args: [{ name: "query", rest: true, required: true, description: "Search query" }], requiredScopes: ["documents:read"], sideEffect: "read-only", dryRunnable: false },
  { verb: "ROOM", aliases: ["DATAROOM"], category: "navigation", description: "Open a data room", example: "ROOM Maple Street", args: [ENTITY_ARG], requiredScopes: ["documents:read"], sideEffect: "read-only", dryRunnable: false },
  { verb: "WATCH", aliases: ["WATCHLIST"], category: "navigation", description: "Open watchlists", example: "WATCH", args: [], requiredScopes: ["entities:read"], sideEffect: "read-only", dryRunnable: false },
  { verb: "ALERTS", aliases: [], category: "navigation", description: "Open the alerts feed", example: "ALERTS", args: [], requiredScopes: ["entities:read"], sideEffect: "read-only", dryRunnable: false },

  // --- Analysis (capital-analysis: computes, never writes the ledger) ---
  { verb: "LBO", aliases: [], category: "analysis", description: "Run an LBO returns model", example: "LBO Maple Street", args: [ENTITY_ARG], requiredScopes: ["deals:read", "financials:read"], agentOwner: "analyst", sideEffect: "capital-analysis", dryRunnable: true },
  { verb: "VAL", aliases: ["VALUATION"], category: "analysis", description: "Run a valuation", example: "VAL Acme Software", args: [ENTITY_ARG], requiredScopes: ["financials:read"], agentOwner: "analyst", sideEffect: "capital-analysis", dryRunnable: true },
  { verb: "COMPS", aliases: [], category: "analysis", description: "Comparable analysis", example: "COMPS Acme Software", args: [ENTITY_ARG], requiredScopes: ["financials:read"], agentOwner: "analyst", sideEffect: "capital-analysis", dryRunnable: true },
  { verb: "RETURNS", aliases: [], category: "analysis", description: "Returns case (MOIC/IRR)", example: "RETURNS Fund II", args: [ENTITY_ARG], requiredScopes: ["financials:read"], agentOwner: "analyst", sideEffect: "capital-analysis", dryRunnable: true },
  { verb: "EXPOSURE", aliases: [], category: "analysis", description: "Portfolio exposure breakdown", example: "EXPOSURE Fund II", args: [ENTITY_ARG], requiredScopes: ["financials:read"], agentOwner: "portfolio_ops", sideEffect: "capital-analysis", dryRunnable: true },
  { verb: "SCENARIO", aliases: [], category: "analysis", description: "Scenario / stress run", example: "SCENARIO Maple Street", args: [ENTITY_ARG], requiredScopes: ["financials:read"], agentOwner: "analyst", sideEffect: "capital-analysis", dryRunnable: true },
  { verb: "RISK", aliases: [], category: "analysis", description: "Risk register / heatmap", example: "RISK Maple Street", args: [ENTITY_ARG], requiredScopes: ["deals:read"], agentOwner: "risk_compliance", sideEffect: "capital-analysis", dryRunnable: true },
  { verb: "IC", aliases: [], category: "analysis", description: "Assemble an IC memo (draft)", example: "IC Maple Street", args: [ENTITY_ARG], requiredScopes: ["deals:read"], agentOwner: "investment_committee", sideEffect: "local-draft", dryRunnable: true },
  { verb: "WATERFALL", aliases: [], category: "analysis", description: "Distribution waterfall", example: "WATERFALL Fund II", args: [ENTITY_ARG], requiredScopes: ["financials:read"], agentOwner: "fund_admin", sideEffect: "capital-analysis", dryRunnable: true },
  { verb: "CAPTABLE", aliases: [], category: "analysis", description: "Capitalization table", example: "CAPTABLE Acme Software", args: [ENTITY_ARG], requiredScopes: ["financials:read"], agentOwner: "analyst", sideEffect: "capital-analysis", dryRunnable: true },
  { verb: "BENCHMARK", aliases: [], category: "analysis", description: "Benchmark a fund/company", example: "BENCHMARK Fund II", args: [ENTITY_ARG], requiredScopes: ["financials:read"], agentOwner: "research", sideEffect: "capital-analysis", dryRunnable: true },
  { verb: "RELGRAPH", aliases: [], category: "analysis", description: "Relationship graph for an entity", example: "RELGRAPH Redwood", args: [ENTITY_ARG], requiredScopes: ["relationships:read"], sideEffect: "read-only", dryRunnable: false },

  // --- Workflow execution (varied side-effects; capital actions are Tier-3) ---
  { verb: "SOURCE", aliases: [], category: "workflow", description: "Run a sourcing workflow against a mandate", example: "SOURCE software buyouts", args: [{ name: "mandate", rest: true, required: true, description: "Mandate / criteria" }], requiredScopes: ["deals:read", "workflows:execute"], agentOwner: "deal_sourcer", sideEffect: "internal-write", dryRunnable: true },
  { verb: "OUTREACH", aliases: [], category: "workflow", description: "Prepare outreach (draft; sending is gated)", example: "OUTREACH Q3 LP list", args: [{ name: "target", rest: true, required: true, description: "List or campaign" }], requiredScopes: ["communications:draft"], agentOwner: "capital_formation", sideEffect: "external-communication", dryRunnable: true },
  { verb: "CREATE DEAL", aliases: [], category: "workflow", description: "Create a deal record", example: "CREATE DEAL Maple Street", args: [{ name: "name", rest: true, required: true, description: "Deal name" }], requiredScopes: ["deals:write"], sideEffect: "internal-write", dryRunnable: true },
  { verb: "CREATE FUND", aliases: [], category: "workflow", description: "Create a fund record", example: "CREATE FUND Fund IV", args: [{ name: "name", rest: true, required: true, description: "Fund name" }], requiredScopes: ["funds:write"], sideEffect: "internal-write", dryRunnable: true },
  { verb: "CREATE ROOM", aliases: [], category: "workflow", description: "Create a data room", example: "CREATE ROOM Maple Street", args: [{ name: "name", rest: true, required: true, description: "Room name" }], requiredScopes: ["documents:write"], sideEffect: "internal-write", dryRunnable: true },
  { verb: "INGEST", aliases: [], category: "workflow", description: "Ingest a document", example: "INGEST teaser.pdf", args: [{ name: "document", rest: true, required: true, description: "Document" }], requiredScopes: ["documents:write"], sideEffect: "internal-write", dryRunnable: true },
  { verb: "ASSIGN", aliases: [], category: "workflow", description: "Assign work to an executive", example: "ASSIGN analyst", args: [{ name: "agent", rest: true, required: true, description: "Executive" }], requiredScopes: ["workflows:execute"], sideEffect: "internal-write", dryRunnable: false },
  { verb: "APPROVE", aliases: [], category: "workflow", description: "Approve a pending item", example: "APPROVE", args: [{ name: "item", rest: true, required: false, description: "Item id (optional)" }], requiredScopes: ["workflows:execute"], sideEffect: "compliance-sensitive", dryRunnable: false },
  { verb: "REJECT", aliases: [], category: "workflow", description: "Reject a pending item", example: "REJECT", args: [{ name: "item", rest: true, required: false, description: "Item id (optional)" }], requiredScopes: ["workflows:execute"], sideEffect: "internal-write", dryRunnable: false },
  { verb: "CAPCALL", aliases: [], category: "workflow", description: "Prepare a capital call (execution is Tier-3 human)", example: "CAPCALL Fund II", args: [ENTITY_ARG], requiredScopes: ["capital-events:draft"], agentOwner: "investor_relations", sideEffect: "capital-binding", dryRunnable: true },
  { verb: "DISTRIBUTE", aliases: ["DISTRIBUTION"], category: "workflow", description: "Prepare a distribution (execution is Tier-3 human)", example: "DISTRIBUTE Fund II", args: [ENTITY_ARG], requiredScopes: ["capital-events:draft"], agentOwner: "investor_relations", sideEffect: "capital-binding", dryRunnable: true },
  { verb: "REPORT", aliases: [], category: "workflow", description: "Generate a report", example: "REPORT Fund II", args: [ENTITY_ARG], requiredScopes: ["financials:read"], agentOwner: "fund_admin", sideEffect: "local-draft", dryRunnable: true },
  { verb: "EXPORT", aliases: [], category: "workflow", description: "Export the active view", example: "EXPORT pdf", args: [{ name: "format", rest: true, required: false, description: "Format" }], requiredScopes: ["documents:read"], sideEffect: "read-only", dryRunnable: false },
  { verb: "ASK EARN", aliases: ["EARN"], category: "workflow", description: "Ask Earn to plan a workflow from a request", example: "ASK EARN analyze Maple Street and prep an IC memo", args: [{ name: "request", rest: true, required: true, description: "Natural-language request" }], requiredScopes: ["workflows:execute"], agentOwner: "earn", sideEffect: "local-draft", dryRunnable: true },
];

// Build lookup maps. Verbs and aliases are normalized to upper-case.
const BY_VERB = new Map<string, CommandDefinition>();
for (const cmd of COMMANDS) {
  BY_VERB.set(cmd.verb.toUpperCase(), cmd);
  for (const a of cmd.aliases) BY_VERB.set(a.toUpperCase(), cmd);
}

/** Resolve a verb or alias (case-insensitive) to its command, or null. */
export function getCommand(verbOrAlias: string): CommandDefinition | null {
  return BY_VERB.get(verbOrAlias.trim().toUpperCase()) ?? null;
}

/** All registered command definitions (canonical, no alias duplicates). */
export function listCommands(): CommandDefinition[] {
  return [...COMMANDS];
}

/** Every verb + alias token, for the parser's longest-match table. */
export function allVerbTokens(): string[] {
  return [...BY_VERB.keys()];
}
