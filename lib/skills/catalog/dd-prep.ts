// lib/skills/catalog/dd-prep.ts
// Native skill: prepare a sequenced diligence WORKPLAN for a deal. Pure,
// deterministic core — it organizes the standard DD workstreams into a
// prioritized, phased agenda, merges the caller's SUPPLIED known items and focus
// areas, and flags coverage gaps. It PREPARES the plan; it never performs
// diligence, draws conclusions, or SENDS a request (sending is a separate Tier-2
// action, `send_diligence_request`, prohibited here).
//
// Distinct from `dd-checklist`: that skill assembles the REQUEST LIST (the items
// to ask a target for); this skill sequences the WORKPLAN (owners, status, phase,
// priority) — the prioritized agenda a deal team works through. Supplied item
// status/owner are `fact` sources; template items default to status "not_started",
// which is labelled an `assumption` (a plan default), never a fact.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export type ItemStatus = "not_started" | "in_progress" | "complete";

export interface DdPrepDeal {
  name: string;
  sector?: string;
  dealType?: string;
}

export interface DdPrepKnownItem {
  workstream: string;
  item: string;
  status?: ItemStatus;
  owner?: string;
}

export interface DdPrepInput {
  deal: DdPrepDeal;
  /** Workstreams to prioritize — bumps their priority to high. */
  focusAreas?: string[];
  /** Caller-supplied known items, merged into the plan (status/owner are facts). */
  knownItems?: DdPrepKnownItem[];
  /** Overall DD window in weeks — used to phase items; no dates are fabricated. */
  timelineWeeks?: number;
}

export type WorkstreamPriority = "high" | "medium" | "standard";

export interface DdPrepPlanItem {
  item: string;
  status: ItemStatus;
  owner: string | null;
}

export interface DdPrepWorkstream {
  workstream: string;
  priority: WorkstreamPriority;
  /** Coarse phase 1/2/3 by priority when a timeline is supplied; null otherwise. */
  phase: number | null;
  items: DdPrepPlanItem[];
}

export interface DdPrepOutput {
  workstreams: DdPrepWorkstream[];
  totalItems: number;
  /** Count of items sitting in high-priority workstreams — the sequence-first set. */
  highPriorityCount: number;
  /** Workstreams with no started work, and focus areas not represented. */
  coverageGaps: string[];
  recommendedAction: string;
  /** Material context that was absent (flagged, never invented). */
  missingContext: string[];
}

// ---------------------------------------------------------------------------
// Standard workplan template — the 8 canonical DD workstreams, each with a few
// canonical items. These are the sequencing scaffold; item statuses default to
// "not_started" (a plan ASSUMPTION), not a fact about work already done.
// ---------------------------------------------------------------------------

interface WorkstreamSpec {
  key: string;
  label: string;
  items: string[];
}

// Canonical order is the source of truth for output ordering.
const TEMPLATE: WorkstreamSpec[] = [
  {
    key: "commercial",
    label: "Commercial",
    items: [
      "Market sizing and competitive landscape review",
      "Customer concentration and retention analysis",
      "Pipeline, pricing, and win/loss review",
    ],
  },
  {
    key: "financial",
    label: "Financial",
    items: [
      "Quality of earnings review",
      "Working capital and net debt analysis",
      "Historical financials and forecast validation",
    ],
  },
  {
    key: "legal",
    label: "Legal",
    items: [
      "Corporate structure and material contracts review",
      "Litigation, claims, and disputes review",
      "Permits, licenses, and consents review",
    ],
  },
  {
    key: "tax",
    label: "Tax",
    items: [
      "Tax compliance and exposure review",
      "Tax structuring and attributes review",
    ],
  },
  {
    key: "technology",
    label: "Technology",
    items: [
      "Technology architecture and systems review",
      "Product roadmap and technical-debt review",
      "Cybersecurity posture review",
    ],
  },
  {
    key: "hr_org",
    label: "HR & Org",
    items: [
      "Organizational structure and headcount review",
      "Key employee and retention review",
      "Compensation and benefits review",
    ],
  },
  {
    key: "operations",
    label: "Operations",
    items: [
      "Supply chain and procurement review",
      "Facilities and capacity review",
      "Operational KPI and process review",
    ],
  },
  {
    key: "esg",
    label: "ESG",
    items: [
      "ESG policy and reporting review",
      "Environmental and sustainability review",
    ],
  },
];

// Structurally core workstreams start "medium"; the rest start "standard". Focus
// areas and supplied gaps bump a workstream to "high".
const CORE = new Set<string>(["financial", "legal", "commercial", "tax"]);

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const lc = (s: string) => s.toLowerCase().trim();

/** Coarse phase from priority — only when a timeline anchors the sequencing. */
function phaseFor(priority: WorkstreamPriority, hasTimeline: boolean): number | null {
  if (!hasTimeline) return null;
  if (priority === "high") return 1;
  if (priority === "medium") return 2;
  return 3;
}

/** Resolve a caller-supplied workstream string to a template key, else null. */
function matchWorkstream(raw: string): string | null {
  const v = lc(raw);
  if (!v) return null;
  for (const w of TEMPLATE) {
    if (v === w.key || v === lc(w.label)) return w.key;
  }
  // Looser containment match (e.g. "hr" → hr_org, "technology stack" → technology).
  for (const w of TEMPLATE) {
    if (w.key.includes(v) || v.includes(w.key) || lc(w.label).includes(v) || v.includes(lc(w.label))) return w.key;
  }
  return null;
}

interface WorkItem {
  item: string;
  status: ItemStatus;
  owner: string | null;
  supplied: boolean;
  statusSupplied: boolean;
}

const run: SkillCore<DdPrepInput, DdPrepOutput> = (input): SkillCoreResult<DdPrepOutput> => {
  const { deal } = input;
  const focusAreas = input.focusAreas ?? [];
  const knownItems = input.knownItems ?? [];
  const hasTimeline = input.timelineWeeks != null;

  // Start from a deep copy of the template so module state is never mutated.
  const byKey = new Map<string, { label: string; items: WorkItem[] }>();
  const order: string[] = [];
  for (const w of TEMPLATE) {
    byKey.set(w.key, {
      label: w.label,
      items: w.items.map((item) => ({ item, status: "not_started", owner: null, supplied: false, statusSupplied: false })),
    });
    order.push(w.key);
  }

  // Which workstreams a focus area asks to prioritize, and which don't map.
  const focusKeys = new Set<string>();
  const unmatchedFocus: string[] = [];
  for (const fa of focusAreas) {
    const key = matchWorkstream(fa);
    if (key) focusKeys.add(key);
    else if (fa.trim() && !unmatchedFocus.includes(fa.trim())) unmatchedFocus.push(fa.trim());
  }

  // Merge supplied known items — dedupe by workstream+item (case-insensitive).
  const gapKeys = new Set<string>(); // workstreams carrying a supplied not_started (known-but-unstarted) gap.
  for (const ki of knownItems) {
    if (!ki || !ki.item || !ki.item.trim()) continue;
    let key = matchWorkstream(ki.workstream ?? "");
    if (!key) {
      // Never drop supplied data — attach it to a new workstream keyed by its label.
      key = lc(ki.workstream ?? "other") || "other";
      if (!byKey.has(key)) {
        byKey.set(key, { label: (ki.workstream ?? "Other").trim() || "Other", items: [] });
        order.push(key);
      }
    }
    const bucket = byKey.get(key)!;
    const status: ItemStatus = ki.status ?? "not_started";
    const statusSupplied = ki.status != null;
    const owner = ki.owner ?? null;
    if (statusSupplied && status === "not_started") gapKeys.add(key);

    const existing = bucket.items.find((it) => lc(it.item) === lc(ki.item));
    if (existing) {
      existing.status = status;
      existing.statusSupplied = statusSupplied;
      existing.owner = owner ?? existing.owner;
      existing.supplied = true;
    } else {
      bucket.items.push({ item: ki.item.trim(), status, owner, supplied: true, statusSupplied });
    }
  }

  // Build the sourced, prioritized, phased workstreams.
  const sources: SkillSource[] = [];
  const workstreams: DdPrepWorkstream[] = [];
  const coverageGaps: string[] = [];
  let totalItems = 0;
  let highPriorityCount = 0;

  for (const key of order) {
    const bucket = byKey.get(key)!;
    const isCore = CORE.has(key);
    const priority: WorkstreamPriority = focusKeys.has(key) || gapKeys.has(key) ? "high" : isCore ? "medium" : "standard";
    const phase = phaseFor(priority, hasTimeline);

    const items: DdPrepPlanItem[] = bucket.items.map((it) => {
      // Epistemics: supplied status/owner are FACTS; template defaults are ASSUMPTIONS.
      if (it.statusSupplied) {
        sources.push({ label: `${bucket.label}: ${it.item} — status`, kind: "fact", value: it.status });
      } else {
        sources.push({ label: `${bucket.label}: ${it.item} — status`, kind: "assumption", value: it.status, ref: "template default" });
      }
      if (it.owner != null) {
        sources.push({ label: `${bucket.label}: ${it.item} — owner`, kind: "fact", value: it.owner });
      }
      return { item: it.item, status: it.status, owner: it.owner };
    });

    totalItems += items.length;
    if (priority === "high") highPriorityCount += items.length;

    // Coverage gap: a workstream with no items, or with no work started at all.
    const anyStarted = bucket.items.some((it) => it.status === "in_progress" || it.status === "complete");
    if (items.length === 0 || !anyStarted) coverageGaps.push(bucket.label);

    workstreams.push({ workstream: bucket.label, priority, phase, items });
  }

  // A focus area that maps to no workstream is an explicit coverage gap.
  for (const fa of unmatchedFocus) coverageGaps.push(`${fa} (focus area not represented in the standard workplan)`);

  // Missing-context — surfaced, never invented.
  const missingContext: string[] = [];
  if (focusAreas.length === 0) missingContext.push("No focus areas supplied — no workstream prioritized above the standard template.");
  if (knownItems.length === 0) missingContext.push("No known items supplied — every item defaults to not_started (a plan assumption, not recorded progress).");
  if (!hasTimeline) missingContext.push("No timeline supplied — items are not phased and no due dates are inferred.");
  if (!deal.sector) missingContext.push("Deal sector not provided — workplan is not sector-tailored.");
  if (!deal.dealType) missingContext.push("Deal type not provided — workplan is not structure-tailored.");

  const recommendedAction =
    highPriorityCount > 0
      ? `Sequence the ${highPriorityCount} high-priority item(s) first${hasTimeline ? " (phase 1)" : ""}; sending diligence requests is a separate gated step (Tier-2).`
      : "No high-priority items — supply focus areas or known gaps to prioritize; sending diligence requests is a separate gated step (Tier-2).";

  const structured: DdPrepOutput = {
    workstreams,
    totalItems,
    highPriorityCount,
    coverageGaps,
    recommendedAction,
    missingContext,
  };

  // Completeness reflects how much planning context was supplied (3 optional signals).
  const providedContext = [focusAreas.length > 0, knownItems.length > 0, hasTimeline].filter(Boolean).length;
  const completeness = Math.round((providedContext / 3) * 100) / 100;
  const confidence = Math.max(0.4, Math.min(0.9, 0.5 + completeness * 0.3));

  const narrative =
    `Diligence workplan for ${deal.name}: ${workstreams.length} workstream(s), ${totalItems} item(s), ` +
    `${highPriorityCount} in high-priority workstream(s). ` +
    `${hasTimeline ? `Phased across a ${input.timelineWeeks}-week window (no dates fabricated). ` : "Not phased (no timeline supplied). "}` +
    `${coverageGaps.length ? `${coverageGaps.length} coverage gap(s) flagged. ` : ""}` +
    "This PREPARES the plan only — it does not perform diligence or send any request. " +
    `Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: [...missingContext] };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  required: ["deal"],
  properties: {
    deal: {
      type: "object",
      required: ["name"],
      properties: {
        name: { type: "string", minLength: 1 },
        sector: { type: "string" },
        dealType: { type: "string" },
      },
    },
    focusAreas: { type: "array", items: { type: "string" } },
    knownItems: {
      type: "array",
      items: {
        type: "object",
        required: ["workstream", "item"],
        properties: {
          workstream: { type: "string", minLength: 1 },
          item: { type: "string", minLength: 1 },
          status: { type: "string", enum: ["not_started", "in_progress", "complete"] },
          owner: { type: "string" },
        },
      },
    },
    timelineWeeks: { type: "number", minimum: 0 },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["workstreams", "totalItems", "highPriorityCount", "coverageGaps", "recommendedAction"],
  properties: {
    workstreams: {
      type: "array",
      items: {
        type: "object",
        required: ["workstream", "priority", "items"],
        properties: {
          workstream: { type: "string" },
          priority: { type: "string", enum: ["high", "medium", "standard"] },
          phase: { type: "number", minimum: 1 },
          items: {
            type: "array",
            items: {
              type: "object",
              required: ["item", "status"],
              properties: {
                item: { type: "string" },
                status: { type: "string", enum: ["not_started", "in_progress", "complete"] },
                owner: { type: "string" },
              },
            },
          },
        },
      },
    },
    totalItems: { type: "number", minimum: 0 },
    highPriorityCount: { type: "number", minimum: 0 },
    coverageGaps: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
    missingContext: { type: "array", items: { type: "string" } },
  },
};

export const ddPrepManifest: SkillManifest = {
  id: "dd-prep",
  name: "Diligence Prep Workplan",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["diligence"],
  supportedEntityTypes: ["deal", "company", "diligence_request"],
  requiredInputs: ["deal.name"],
  optionalInputs: ["deal.sector", "deal.dealType", "focusAreas", "knownItems", "timelineWeeks"],
  outputs: ["workstreams", "totalItems", "highPriorityCount", "coverageGaps", "recommendedAction", "missingContext"],
  artifactTypes: ["analysis"],
  dataPermissions: ["deal:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "supplied item status/owner labelled fact; template default status labelled assumption",
  ],
  evaluationCriteria: [
    "standard 8-workstream workplan produced by default",
    "focus areas bump the named workstream to high priority",
    "supplied known items merged (their status/owner are facts, deduped by workstream+item)",
    "coverage gaps surfaced, including focus areas not represented",
    "no timeline supplied → phase left null, never a fabricated date",
    "prepares the plan only; never performs diligence or sends a request",
  ],
  providerCapabilities: ["structured_extraction"],
  allowedDownstreamSkills: ["dd-checklist", "ic-memo"],
  prohibitedActions: ["send_diligence_request", "send_outreach", "sign_document"],
  inputSchema,
  outputSchema,
};

export const ddPrep: SkillDefinition<DdPrepInput, DdPrepOutput> = {
  manifest: ddPrepManifest,
  run,
};
