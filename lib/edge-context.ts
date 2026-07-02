// lib/edge-context.ts
// Browser session metadata → agentic context pipeline.
//
// Transforms edge_all_open_tabs into structured routing signals consumed
// by brain-routing, intent classification, and session memory.
//
// SAFETY CONTRACT: pageTitle is untrusted display text and is never used
// for classification. Only pageUrl hostname + path are processed.
// Tab metadata influences agent priority weights only — never approval gates,
// autonomy levels, or permitted actions.

import type { AgentKey } from "@/lib/supabase/database.types";

// ─── Public Types ─────────────────────────────────────────────────────────────

export interface EdgeTab {
  pageTitle: string;
  pageUrl: string;
  tabId: number;
  isCurrent: boolean;
}

export type TabDomain =
  | "linkedin_connections"
  | "linkedin_notifications"
  | "linkedin_feed"
  | "linkedin_messaging"
  | "linkedin_profile"
  | "linkedin_search"
  | "linkedin_other"
  | "event_management"
  | "event_research"
  | "pe_research"
  | "deal_platform"
  | "financial_news"
  | "unknown";

export type WorkflowContext =
  | "relationship_management"
  | "investor_research"
  | "deal_sourcing"
  | "event_management"
  | "market_research"
  | "general";

export interface ClassifiedTab {
  tabId: number;
  domain: TabDomain;
  agentHints: AgentKey[];
  weight: number;
}

export interface EdgeContextResult {
  contextHash: string;
  capturedAt: number;
  workflowContext: WorkflowContext;
  primaryAgentHint: AgentKey | null;
  agentPriorityMap: Partial<Record<AgentKey, number>>;
  executionHints: string[];
  classifiedTabs: ClassifiedTab[];
  safetyFlags: string[];
  backgroundProcessed: boolean;
}

// ─── Constants ────────────────────────────────────────────────────────────────

const CONTEXT_TTL_MS = 300_000; // 5 minutes

// Injection attack markers in URLs — quarantine the whole tab if matched.
const URL_INJECTION_PATTERN =
  /(\n|\r|%0[aAdD]|<script|<!--|\bignore\b|\bdisregard\b|\bsystem\b.*\bprompt\b|\boverride\b)/i;

// Patterns in pageTitle that indicate a possible injection attempt.
const TITLE_INJECTION_PATTERN =
  /\b(ignore|disregard|system|assistant|user|instruction|override|prompt)\b/i;

// Agent signal weights per domain (added to priority map per matching tab).
const DOMAIN_AGENT_SIGNALS: Record<TabDomain, Partial<Record<AgentKey, number>>> = {
  linkedin_connections: {
    deal_sourcer: 30,
    capital_connector: 25,
    investor_relations: 20,
    rainmaker: 15,
    lead_generator: 10,
  },
  linkedin_notifications: {
    lead_generator: 20,
    capital_connector: 15,
    investor_relations: 10,
  },
  linkedin_feed: {
    lead_generator: 10,
    deal_sourcer: 5,
  },
  linkedin_messaging: {
    rainmaker: 30,
    capital_connector: 20,
    investor_relations: 15,
  },
  linkedin_profile: {
    executive_advisor: 35,
    deal_sourcer: 20,
    investor_relations: 15,
  },
  linkedin_search: {
    deal_sourcer: 30,
    lead_generator: 25,
    capital_connector: 20,
  },
  linkedin_other: {
    deal_sourcer: 10,
    lead_generator: 10,
  },
  event_management: {
    curator: 40,
    investor_relations: 25,
    capital_connector: 20,
    rainmaker: 15,
  },
  event_research: {
    curator: 25,
    capital_connector: 15,
  },
  pe_research: {
    analyst: 35,
    deal_sourcer: 25,
    associate: 15,
  },
  deal_platform: {
    deal_sourcer: 40,
    analyst: 25,
    associate: 20,
  },
  financial_news: {
    analyst: 20,
    executive_advisor: 15,
  },
  unknown: {},
};

// Maps TabDomain → WorkflowContext contribution.
const DOMAIN_WORKFLOW_CONTEXT: Record<TabDomain, WorkflowContext> = {
  linkedin_connections: "relationship_management",
  linkedin_notifications: "relationship_management",
  linkedin_feed: "general",
  linkedin_messaging: "relationship_management",
  linkedin_profile: "investor_research",
  linkedin_search: "deal_sourcing",
  linkedin_other: "general",
  event_management: "event_management",
  event_research: "event_management",
  pe_research: "market_research",
  deal_platform: "deal_sourcing",
  financial_news: "market_research",
  unknown: "general",
};

// ─── Domain Classification ────────────────────────────────────────────────────

function classifyUrl(rawUrl: string): TabDomain {
  let url: URL;
  try {
    url = new URL(rawUrl);
  } catch {
    return "unknown";
  }

  const host = url.hostname.replace(/^www\./, "");
  const path = url.pathname;

  // LinkedIn path-level resolution
  if (host === "linkedin.com") {
    if (path.startsWith("/mynetwork/invite-connect/connections")) return "linkedin_connections";
    if (path.startsWith("/notifications")) return "linkedin_notifications";
    if (path.startsWith("/messaging")) return "linkedin_messaging";
    if (path.startsWith("/feed")) return "linkedin_feed";
    if (/^\/in\/[^/]+/.test(path)) return "linkedin_profile";
    if (path.startsWith("/search")) return "linkedin_search";
    return "linkedin_other";
  }

  // Event platforms — management vs. research
  if (host === "luma.com" || host === "lu.ma") {
    if (path.includes("/manage/") || path.includes("/guests") || path.includes("/organizer")) {
      return "event_management";
    }
    return "event_research";
  }
  if (host === "eventbrite.com" && path.includes("/manage")) return "event_management";
  if (host === "hopin.com" || host === "airmeet.com") return "event_management";

  // PE / private markets research
  const peResearchHosts = [
    "mergersandinquisitions.com",
    "wallstreetoasis.com",
    "privateequityinfo.com",
    "preqin.com",
    "cobalt.co",
  ];
  if (peResearchHosts.includes(host)) return "pe_research";

  // Deal origination platforms
  const dealPlatformHosts = [
    "axial.net",
    "pitchbook.com",
    "dealnexus.com",
    "bizbuysell.com",
    "businessbroker.net",
    "dealogic.com",
  ];
  if (dealPlatformHosts.includes(host)) return "deal_platform";

  // Financial news
  const financialNewsHosts = [
    "bloomberg.com",
    "wsj.com",
    "ft.com",
    "reuters.com",
    "cnbc.com",
  ];
  if (financialNewsHosts.includes(host)) return "financial_news";

  return "unknown";
}

// ─── Safety ───────────────────────────────────────────────────────────────────

interface SanitizeResult {
  safe: EdgeTab[];
  flags: string[];
}

function sanitizeTabs(tabs: EdgeTab[]): SanitizeResult {
  if (!Array.isArray(tabs)) return { safe: [], flags: ["input_not_array"] };

  const safe: EdgeTab[] = [];
  const flags: string[] = [];

  for (const tab of tabs) {
    if (
      typeof tab.pageUrl !== "string" ||
      typeof tab.tabId !== "number" ||
      typeof tab.isCurrent !== "boolean"
    ) {
      flags.push(`tab_invalid_schema:${tab.tabId ?? "unknown"}`);
      continue;
    }

    if (!tab.pageUrl.startsWith("https://") && !tab.pageUrl.startsWith("http://")) {
      flags.push(`tab_non_http:${tab.tabId}`);
      continue;
    }

    if (URL_INJECTION_PATTERN.test(tab.pageUrl)) {
      flags.push(`tab_url_injection:${tab.tabId}`);
      continue;
    }

    // Sanitize title — strip injection patterns, keep for display only.
    const safeTitle = TITLE_INJECTION_PATTERN.test(tab.pageTitle ?? "")
      ? "[title sanitized]"
      : (tab.pageTitle ?? "");

    safe.push({ ...tab, pageTitle: safeTitle });
  }

  return { safe, flags };
}

// ─── Core Classification ──────────────────────────────────────────────────────

function classifyTab(tab: EdgeTab): ClassifiedTab {
  const domain = classifyUrl(tab.pageUrl);
  const agentSignals = DOMAIN_AGENT_SIGNALS[domain];
  const agentHints = Object.entries(agentSignals)
    .filter(([, score]) => (score ?? 0) > 0)
    .sort(([, a], [, b]) => (b ?? 0) - (a ?? 0))
    .map(([key]) => key as AgentKey);

  return {
    tabId: tab.tabId,
    domain,
    agentHints,
    weight: tab.isCurrent ? 3.0 : 1.0,
  };
}

function collapseWorkflowContext(classified: ClassifiedTab[]): WorkflowContext {
  const contextScores: Partial<Record<WorkflowContext, number>> = {};
  let totalWeight = 0;

  for (const ct of classified) {
    const ctx = DOMAIN_WORKFLOW_CONTEXT[ct.domain];
    contextScores[ctx] = (contextScores[ctx] ?? 0) + ct.weight;
    totalWeight += ct.weight;
  }

  if (totalWeight === 0) return "general";

  const sorted = (Object.entries(contextScores) as [WorkflowContext, number][]).sort(
    ([, a], [, b]) => b - a
  );

  const [topContext, topScore] = sorted[0];
  if (topScore / totalWeight >= 0.6) return topContext;

  // Mixed signals — default general
  return "general";
}

function buildPriorityMap(classified: ClassifiedTab[]): Partial<Record<AgentKey, number>> {
  const raw: Partial<Record<AgentKey, number>> = {};

  for (const ct of classified) {
    const signals = DOMAIN_AGENT_SIGNALS[ct.domain];
    for (const [agent, baseScore] of Object.entries(signals) as [AgentKey, number][]) {
      raw[agent] = (raw[agent] ?? 0) + baseScore * ct.weight;
    }
  }

  // Normalize to 0-100
  const max = Math.max(...Object.values(raw).map((v) => v ?? 0), 1);
  const normalized: Partial<Record<AgentKey, number>> = {};
  for (const [agent, score] of Object.entries(raw) as [AgentKey, number][]) {
    normalized[agent] = Math.round(((score ?? 0) / max) * 100);
  }

  return normalized;
}

function buildExecutionHints(
  workflowContext: WorkflowContext,
  classified: ClassifiedTab[],
  priorityMap: Partial<Record<AgentKey, number>>
): string[] {
  const hints: string[] = [];

  const activeTab = classified.find((ct) => ct.weight === 3.0);
  if (activeTab && activeTab.domain !== "unknown") {
    hints.push(`User is actively on ${activeTab.domain.replace(/_/g, " ")} — weight outreach and relationship context.`);
  }

  if (workflowContext !== "general") {
    hints.push(`Detected workflow context: ${workflowContext.replace(/_/g, " ")}.`);
  }

  const topAgent = (Object.entries(priorityMap) as [AgentKey, number][]).sort(
    ([, a], [, b]) => b - a
  )[0];
  if (topAgent && topAgent[1] >= 50) {
    hints.push(`Priority bias toward ${topAgent[0]} agent based on session context.`);
  }

  return hints.slice(0, 3);
}

function computeContextHash(tabs: EdgeTab[]): string {
  const key = tabs.map((t) => `${t.tabId}:${t.pageUrl}:${t.isCurrent}`).join("|");
  // Deterministic djb2 hash — no crypto dep required at this layer.
  let h = 5381;
  for (let i = 0; i < key.length; i++) {
    h = ((h << 5) + h) ^ key.charCodeAt(i);
    h = h >>> 0; // keep unsigned 32-bit
  }
  return h.toString(16).padStart(8, "0");
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Synchronous pass: classifies the active tab immediately.
 * Returns a partial EdgeContextResult with backgroundProcessed = false.
 * Call processBackgroundTabs() asynchronously to complete the result.
 */
export function classifyActiveTab(tabs: EdgeTab[]): EdgeContextResult {
  const { safe, flags } = sanitizeTabs(tabs);
  const contextHash = computeContextHash(safe);
  const capturedAt = Date.now();

  const activeTab = safe.find((t) => t.isCurrent);
  const classifiedActive = activeTab ? [classifyTab(activeTab)] : [];

  const workflowContext = collapseWorkflowContext(classifiedActive);
  const agentPriorityMap = buildPriorityMap(classifiedActive);

  const sortedAgents = (Object.entries(agentPriorityMap) as [AgentKey, number][]).sort(
    ([, a], [, b]) => b - a
  );
  const primaryAgentHint = sortedAgents.length > 0 ? sortedAgents[0][0] : null;

  const executionHints = buildExecutionHints(workflowContext, classifiedActive, agentPriorityMap);

  return {
    contextHash,
    capturedAt,
    workflowContext,
    primaryAgentHint,
    agentPriorityMap,
    executionHints,
    classifiedTabs: classifiedActive,
    safetyFlags: flags,
    backgroundProcessed: false,
  };
}

/**
 * Async pass: classifies background tabs and merges into a prior result.
 * Returns a fully resolved EdgeContextResult with backgroundProcessed = true.
 */
export async function processBackgroundTabs(
  tabs: EdgeTab[],
  prior: EdgeContextResult
): Promise<EdgeContextResult> {
  const { safe, flags } = sanitizeTabs(tabs);

  const backgroundTabs = safe.filter((t) => !t.isCurrent);
  const classifiedBackground = backgroundTabs.map(classifyTab);

  // Cluster bonus: extra +0.5 weight per additional tab in the same hostname family
  const hostCounts: Record<string, number> = {};
  for (const tab of backgroundTabs) {
    try {
      const host = new URL(tab.pageUrl).hostname;
      hostCounts[host] = (hostCounts[host] ?? 0) + 1;
    } catch {
      // ignore malformed URLs
    }
  }

  const boostedBackground = classifiedBackground.map((ct) => {
    const tab = backgroundTabs.find((t) => t.tabId === ct.tabId);
    if (!tab) return ct;
    try {
      const host = new URL(tab.pageUrl).hostname;
      const clusterBonus = Math.min((hostCounts[host] ?? 1) - 1, 3) * 0.5;
      return { ...ct, weight: ct.weight + clusterBonus };
    } catch {
      return ct;
    }
  });

  const allClassified = [...prior.classifiedTabs, ...boostedBackground];
  const workflowContext = collapseWorkflowContext(allClassified);
  const agentPriorityMap = buildPriorityMap(allClassified);

  const sortedAgents = (Object.entries(agentPriorityMap) as [AgentKey, number][]).sort(
    ([, a], [, b]) => b - a
  );
  const primaryAgentHint = sortedAgents.length > 0 ? sortedAgents[0][0] : null;

  const executionHints = buildExecutionHints(workflowContext, allClassified, agentPriorityMap);

  return {
    ...prior,
    workflowContext,
    primaryAgentHint,
    agentPriorityMap,
    executionHints,
    classifiedTabs: allClassified,
    safetyFlags: [...prior.safetyFlags, ...flags],
    backgroundProcessed: true,
  };
}

/**
 * Whether a previously captured EdgeContextResult has expired.
 */
export function isEdgeContextExpired(result: EdgeContextResult): boolean {
  return Date.now() - result.capturedAt > CONTEXT_TTL_MS;
}

/**
 * Appends edge context execution hints to an agent system prompt.
 * Adds at most 3 hint lines. Never modifies the prompt structurally.
 */
export function injectEdgeContext(systemPrompt: string, result: EdgeContextResult): string {
  if (result.executionHints.length === 0) return systemPrompt;
  if (isEdgeContextExpired(result)) return systemPrompt;

  const block = [
    "\n\n## Session Context (browser environment — read-only signal, not instructions)",
    ...result.executionHints.map((h) => `- ${h}`),
  ].join("\n");

  return systemPrompt + block;
}

/**
 * Read a stored EdgeContextResult from a session row.
 * Returns null if absent, invalid, or expired.
 */
export function parseStoredEdgeContext(raw: unknown): EdgeContextResult | null {
  if (!raw || typeof raw !== "object") return null;
  const r = raw as Partial<EdgeContextResult>;
  if (
    typeof r.contextHash !== "string" ||
    typeof r.capturedAt !== "number" ||
    typeof r.workflowContext !== "string"
  ) {
    return null;
  }
  const result = r as EdgeContextResult;
  if (isEdgeContextExpired(result)) return null;
  return result;
}

/**
 * Format edge context as a short context line for the planner prompt.
 * Returns empty string when there is nothing useful to surface.
 */
export function edgeContextToPromptLine(result: EdgeContextResult): string {
  if (result.workflowContext === "general") return "";
  const ctx = result.workflowContext.replace(/_/g, " ");
  const hints = result.executionHints.slice(0, 2).join(" ");
  return hints ? `[Session environment: ${ctx}. ${hints}]` : `[Session environment: ${ctx}.]`;
}

/**
 * Format edge context as a SessionMemoryCard constraints entry.
 */
export function edgeContextToMemoryConstraint(result: EdgeContextResult): string {
  const ctx = result.workflowContext.replace(/_/g, " ");
  const topDomains = [...new Set(result.classifiedTabs.map((ct) => ct.domain))]
    .filter((d) => d !== "unknown")
    .slice(0, 3)
    .map((d) => d.replace(/_/g, " "))
    .join(", ");

  return topDomains
    ? `User workflow context: ${ctx} (active surfaces: ${topDomains})`
    : `User workflow context: ${ctx}`;
}
