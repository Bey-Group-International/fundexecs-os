// lib/network-opportunities.ts
//
// The pipeline: allocations being worked toward a fund.
//
// An opportunity is the stage BEFORE a commitment. commitments (0004_capital)
// records what was signed — unique per (fund, investor), with a real amount. An
// opportunity records the work leading there: a target size, odds, an expected
// close. Keeping them separate is what lets the same LP be in diligence on one
// vehicle and committed to another without the two numbers contradicting.

import type { SupabaseClient } from "@supabase/supabase-js";
import { applyCustomPatch, type FieldDef } from "@/lib/network-fields";

export const OPPORTUNITY_STAGES = [
  "sourced",
  "qualified",
  "diligence",
  "ic_review",
  "legal",
  "committed",
  "passed",
] as const;

export type OpportunityStage = (typeof OPPORTUNITY_STAGES)[number];

export const OPPORTUNITY_STATUSES = ["open", "won", "lost"] as const;
export type OpportunityStatus = (typeof OPPORTUNITY_STATUSES)[number];

export const STAGE_LABEL: Record<OpportunityStage, string> = {
  sourced: "Sourced",
  qualified: "Qualified",
  diligence: "Diligence",
  ic_review: "IC Review",
  legal: "Legal",
  committed: "Committed",
  passed: "Passed",
};

/**
 * The odds a stage implies, used only to seed a NEW deal's probability.
 *
 * It is a starting point, never an override: once someone sets a probability by
 * hand, moving the deal must not silently overwrite their judgement with a
 * default. That is the difference between a forecast and a guess dressed up as
 * one.
 */
export const STAGE_DEFAULT_PROBABILITY: Record<OpportunityStage, number> = {
  sourced: 10,
  qualified: 25,
  diligence: 40,
  ic_review: 60,
  legal: 85,
  committed: 100,
  passed: 0,
};

/** Stages that close a deal, and what they close it as. */
const TERMINAL_STAGE: Partial<Record<OpportunityStage, OpportunityStatus>> = {
  committed: "won",
  passed: "lost",
};

/**
 * The only probability a closed stage can hold, or undefined while it is open.
 *
 * This is an invariant, not a default: the weighted forecast multiplies target
 * amounts by probability, so a won deal below 100 under-counts committed
 * capital and a lost deal above 0 keeps money in a pipeline nobody is working.
 */
export function terminalProbability(stage: OpportunityStage): number | undefined {
  const terminal = TERMINAL_STAGE[stage];
  if (!terminal) return undefined;
  return terminal === "won" ? 100 : 0;
}

/** Narrow an unchecked value from a request body to a known stage. */
export function isOpportunityStage(v: unknown): v is OpportunityStage {
  return typeof v === "string" && (OPPORTUNITY_STAGES as readonly string[]).includes(v);
}

/** Narrow an unchecked value from a request body to a known status. */
export function isOpportunityStatus(v: unknown): v is OpportunityStatus {
  return typeof v === "string" && (OPPORTUNITY_STATUSES as readonly string[]).includes(v);
}

export interface Opportunity {
  id: string;
  name: string;
  stage: OpportunityStage;
  status: OpportunityStatus;
  contactId: string | null;
  contactName: string | null;
  investorId: string | null;
  fundId: string | null;
  fundName: string | null;
  targetAmount: number | null;
  currency: string;
  probability: number;
  /** targetAmount discounted by probability — what the pipeline is worth. */
  weightedAmount: number;
  expectedClose: string | null;
  closedAt: string | null;
  lostReason: string | null;
  commitmentId: string | null;
  ownerId: string | null;
  ownerName: string | null;
  source: string | null;
  notes: string | null;
  tags: string[];
  custom: Record<string, unknown>;
  createdAt: string;
  updatedAt: string;
  /** Past its expected close and still open. */
  overdue: boolean;
}

/**
 * A deal's target size discounted by its odds — what the pipeline is worth.
 *
 * Summed across open deals this is the forecast, which is why a closed stage
 * must carry 100 or 0 rather than whatever it held on the way there.
 */
export function weightedAmount(target: number | null, probability: number): number {
  if (!target || !Number.isFinite(target)) return 0;
  return Math.round(target * (probability / 100));
}

type Row = Record<string, any>;

/**
 * Turn a database row into the client shape, resolving the embedded contact and
 * fund and deriving `weightedAmount` and `overdue` rather than storing either.
 */
export function mapOpportunity(row: Row, ownerNames?: Map<string, string>): Opportunity {
  const contact = Array.isArray(row.network_contacts) ? row.network_contacts[0] : row.network_contacts;
  const fund = Array.isArray(row.funds) ? row.funds[0] : row.funds;
  const target = row.target_amount === null || row.target_amount === undefined
    ? null
    : Number(row.target_amount);
  const probability = typeof row.probability === "number" ? row.probability : 0;
  const expectedClose = row.expected_close ?? null;

  return {
    id: String(row.id),
    name: String(row.name ?? "Untitled"),
    stage: isOpportunityStage(row.stage) ? row.stage : "sourced",
    status: isOpportunityStatus(row.status) ? row.status : "open",
    contactId: row.contact_id ?? null,
    contactName: contact?.full_name ?? null,
    investorId: row.investor_id ?? null,
    fundId: row.fund_id ?? null,
    fundName: fund?.name ?? null,
    targetAmount: target,
    currency: row.currency ?? "USD",
    probability,
    weightedAmount: weightedAmount(target, probability),
    expectedClose,
    closedAt: row.closed_at ?? null,
    lostReason: row.lost_reason ?? null,
    commitmentId: row.commitment_id ?? null,
    ownerId: row.owner_id ?? null,
    ownerName: row.owner_id ? (ownerNames?.get(String(row.owner_id)) ?? null) : null,
    source: row.source ?? null,
    notes: row.notes ?? null,
    tags: Array.isArray(row.tags) ? row.tags : [],
    custom: (row.custom as Record<string, unknown>) ?? {},
    createdAt: String(row.created_at),
    updatedAt: String(row.updated_at),
    overdue:
      row.status === "open" && expectedClose ? Date.parse(expectedClose) < Date.now() : false,
  };
}

export const OPPORTUNITY_SELECT = `
  id, name, stage, status, contact_id, investor_id, fund_id, target_amount, currency,
  probability, expected_close, closed_at, lost_reason, commitment_id, owner_id, source,
  notes, tags, custom, created_at, updated_at,
  network_contacts(full_name), funds(name)
`;

export interface StageTransition {
  stage?: OpportunityStage;
  status?: OpportunityStatus;
  closedAt?: string | null;
  probability?: number;
}

/**
 * Work out what a stage move implies.
 *
 * Moving to a terminal stage closes the deal and stamps the close time, because
 * the `network_opportunities_closed_at` constraint refuses a closed row without
 * one — and because "won last quarter" is otherwise unanswerable. Moving back
 * out of a terminal stage reopens it and clears the stamp, so a mis-click does
 * not leave a permanently closed date on a live deal.
 */
export function resolveStageTransition(
  next: OpportunityStage,
  current: { status: OpportunityStatus; probability: number; closedAt: string | null },
  now = new Date(),
): StageTransition {
  const terminal = TERMINAL_STAGE[next];
  const transition: StageTransition = { stage: next };

  if (terminal) {
    transition.status = terminal;
    transition.closedAt = current.closedAt ?? now.toISOString();
    // A won deal is certain and a lost one is not happening. Leaving the old
    // probability would keep a closed deal in the weighted forecast.
    transition.probability = terminalProbability(next);
  } else {
    transition.status = "open";
    transition.closedAt = null;
    // Reopening a deal that was force-set to 0 or 100 by closing it needs a
    // believable number back; anything the user chose in between is theirs.
    if (current.status !== "open" || current.probability === 0 || current.probability === 100) {
      transition.probability = STAGE_DEFAULT_PROBABILITY[next];
    }
  }

  return transition;
}

export interface OpportunityPatchInput {
  /** Every field here arrives as parsed JSON from a request body, so the types
   *  are a description of what is EXPECTED, not a guarantee. The builder
   *  re-checks each one. */
  name?: unknown;
  stage?: unknown;
  status?: unknown;
  contactId?: string | null;
  investorId?: string | null;
  fundId?: string | null;
  targetAmount?: unknown;
  currency?: unknown;
  probability?: unknown;
  expectedClose?: unknown;
  lostReason?: unknown;
  ownerId?: string | null;
  source?: unknown;
  notes?: unknown;
  tags?: unknown;
  custom?: Record<string, unknown>;
}

export interface BuildPatchResult {
  ok: boolean;
  patch: Record<string, unknown>;
  errors: string[];
  /** Set when the stage changed, for the timeline entry. */
  stageChange: { from: OpportunityStage; to: OpportunityStage } | null;
  /** Custom keys the patch cleared, so the database-side merge knows what to
   *  remove rather than inferring it from the merged object. */
  customRemoved: string[];
}

function parseAmount(raw: unknown): number | null | undefined {
  if (raw === null) return null;
  if (typeof raw === "number") return Number.isFinite(raw) ? raw : undefined;
  if (typeof raw === "string") {
    const cleaned = raw.replace(/[,$\s]/g, "");
    if (cleaned === "") return null;
    const n = Number(cleaned);
    return Number.isFinite(n) ? n : undefined;
  }
  return undefined;
}

/**
 * Build the column patch for an update. Pure, so the stage/close/probability
 * interactions are testable without a database.
 */
export function buildOpportunityPatch(
  input: OpportunityPatchInput,
  current: {
    stage: OpportunityStage;
    status: OpportunityStatus;
    probability: number;
    closedAt: string | null;
    custom: Record<string, unknown>;
  },
  fieldDefs: FieldDef[] = [],
  now = new Date(),
): BuildPatchResult {
  const patch: Record<string, unknown> = {};
  const errors: string[] = [];
  let stageChange: BuildPatchResult["stageChange"] = null;
  let customRemoved: string[] = [];

  if (input.name !== undefined) {
    if (typeof input.name !== "string") {
      errors.push("A deal needs a name.");
    } else {
      const name = input.name.trim();
      if (!name) errors.push("A deal needs a name.");
      else patch.name = name.slice(0, 200);
    }
  }

  if (input.stage !== undefined) {
    if (!isOpportunityStage(input.stage)) {
      errors.push("Unknown stage.");
    } else if (input.stage !== current.stage) {
      const transition = resolveStageTransition(input.stage, current, now);
      patch.stage = transition.stage;
      patch.status = transition.status;
      patch.closed_at = transition.closedAt;
      if (transition.probability !== undefined) patch.probability = transition.probability;
      stageChange = { from: current.stage, to: input.stage };
    }
  }

  // An explicit probability wins over the one a stage move inferred — but only
  // while the deal is still open. A closed stage is not a forecast: "committed"
  // means 100 and "passed" means 0, and a caller-supplied 50 on a won deal
  // would sit it in the weighted pipeline at half its size forever. The
  // database enforces the same invariant; pinning here keeps that from
  // surfacing as an opaque constraint violation.
  if (input.probability !== undefined) {
    const n = typeof input.probability === "number" ? input.probability : Number(input.probability);
    if (!Number.isFinite(n) || n < 0 || n > 100) {
      errors.push("Probability must be between 0 and 100.");
    } else {
      patch.probability = Math.round(n);
    }
  }

  // The stage the row will ACTUALLY be in once this patch lands — which is the
  // current one when the patch does not move it. A plain `{ probability: 50 }`
  // against a row already sitting in "committed" has to be pinned too.
  const resultingStage = (patch.stage as OpportunityStage | undefined) ?? current.stage;
  const pinned = terminalProbability(resultingStage);
  if (pinned !== undefined && patch.probability !== undefined && patch.probability !== pinned) {
    patch.probability = pinned;
  }

  if (input.status !== undefined && input.stage === undefined) {
    if (!isOpportunityStatus(input.status)) {
      errors.push("Unknown status.");
    } else {
      patch.status = input.status;
      patch.closed_at =
        input.status === "open" ? null : (current.closedAt ?? now.toISOString());
    }
  }

  if (input.targetAmount !== undefined) {
    const amount = parseAmount(input.targetAmount);
    if (amount === undefined) errors.push("Target amount must be a number.");
    else if (amount !== null && amount < 0) errors.push("Target amount cannot be negative.");
    else patch.target_amount = amount;
  }

  if (input.expectedClose !== undefined) {
    if (input.expectedClose === null) {
      patch.expected_close = null;
    } else if (typeof input.expectedClose !== "string") {
      errors.push("Expected close must be a valid date.");
    } else {
      const ms = Date.parse(input.expectedClose);
      if (Number.isNaN(ms)) errors.push("Expected close must be a valid date.");
      else patch.expected_close = new Date(ms).toISOString().slice(0, 10);
    }
  }

  if (input.currency !== undefined) {
    const code = typeof input.currency === "string" ? input.currency.trim().toUpperCase() : "";
    if (!/^[A-Z]{3}$/.test(code)) errors.push("Currency must be a 3-letter code.");
    else patch.currency = code;
  }

  if (input.contactId !== undefined) patch.contact_id = input.contactId;
  if (input.investorId !== undefined) patch.investor_id = input.investorId;
  if (input.fundId !== undefined) patch.fund_id = input.fundId;
  if (input.ownerId !== undefined) patch.owner_id = input.ownerId;

  // The declared types say string | null, but this input is parsed JSON from a
  // request body — a number here would make `raw?.slice(...)` throw a
  // TypeError and turn a 400 into an unhandled 500.
  const text = (raw: unknown, label: string, max: number): string | null | undefined => {
    if (raw === null) return null;
    if (typeof raw !== "string") {
      errors.push(`${label} must be text.`);
      return undefined;
    }
    return raw.slice(0, max);
  };

  if (input.source !== undefined) {
    const value = text(input.source, "Source", 120);
    if (value !== undefined) patch.source = value;
  }
  if (input.notes !== undefined) {
    const value = text(input.notes, "Notes", 20_000);
    if (value !== undefined) patch.notes = value;
  }
  if (input.lostReason !== undefined) {
    const value = text(input.lostReason, "Lost reason", 500);
    if (value !== undefined) patch.lost_reason = value;
  }

  if (input.tags !== undefined) {
    if (!Array.isArray(input.tags)) {
      errors.push("Tags must be a list.");
    } else {
      patch.tags = [
        ...new Set(
          input.tags
            .filter((t): t is string => typeof t === "string")
            .map((t) => t.trim().slice(0, 40))
            .filter(Boolean),
        ),
      ].slice(0, 25);
    }
  }

  if (input.custom !== undefined && input.custom !== null && typeof input.custom === "object") {
    const merged = applyCustomPatch(fieldDefs, current.custom ?? {}, input.custom);
    if (!merged.ok) {
      errors.push(...merged.errors);
    } else {
      patch.custom = merged.custom;
      customRemoved = merged.removed;
    }
  }

  // Never let the counterparty constraint be violated from the app: dropping
  // both links would fail at the database with an opaque error.
  const clearingContact = patch.contact_id === null;
  const clearingInvestor = patch.investor_id === null;
  if (clearingContact && clearingInvestor) {
    errors.push("A deal needs a contact or an investor.");
  }

  return { ok: errors.length === 0, patch, errors, stageChange, customRemoved };
}

/** Principal id → display name, for owners. */
export async function loadOwnerNames(
  client: SupabaseClient,
  orgId: string,
): Promise<Map<string, string>> {
  const map = new Map<string, string>();
  try {
    const { data } = await client
      .from("organization_members")
      .select("principal_id, principals(full_name)")
      .eq("organization_id", orgId)
      .limit(200);
    for (const row of (data ?? []) as unknown as {
      principal_id: string;
      principals: { full_name: string | null } | { full_name: string | null }[] | null;
    }[]) {
      const p = Array.isArray(row.principals) ? row.principals[0] : row.principals;
      if (p?.full_name) map.set(row.principal_id, p.full_name);
    }
  } catch {
    /* names are cosmetic */
  }
  return map;
}

/**
 * Confirm every relationship id a request supplied belongs to this org.
 *
 * The foreign keys on network_opportunities point at single columns, so nothing
 * in the schema requires contact_id, investor_id, fund_id or owner_id to be in
 * the SAME organization as the deal. Without this check a member could attach a
 * deal to another tenant's fund or investor by id — the row would be accepted,
 * and the pipeline would silently reference something across a tenant boundary.
 *
 * Returns an error message for the first id that does not check out.
 */
export async function validateOpportunityRefs(
  client: SupabaseClient,
  orgId: string,
  refs: {
    contactId?: string | null;
    investorId?: string | null;
    fundId?: string | null;
    ownerId?: string | null;
  },
): Promise<string | null> {
  const checks: { table: string; column: string; id: string; error: string }[] = [];

  if (refs.contactId) {
    checks.push({
      table: "network_contacts",
      column: "organization_id",
      id: refs.contactId,
      error: "Contact not found",
    });
  }
  if (refs.investorId) {
    checks.push({
      table: "investors",
      column: "organization_id",
      id: refs.investorId,
      error: "Investor not found",
    });
  }
  if (refs.fundId) {
    checks.push({
      table: "funds",
      column: "organization_id",
      id: refs.fundId,
      error: "Fund not found",
    });
  }

  for (const check of checks) {
    const { data, error } = await client
      .from(check.table)
      .select("id")
      .eq(check.column, orgId)
      .eq("id", check.id)
      .maybeSingle();
    if (error) throw error;
    if (!data) return check.error;
  }

  // The owner lives in organization_members rather than a table keyed by
  // organization_id alone.
  if (refs.ownerId) {
    const { data, error } = await client
      .from("organization_members")
      .select("principal_id")
      .eq("organization_id", orgId)
      .eq("principal_id", refs.ownerId)
      .maybeSingle();
    if (error) throw error;
    if (!data) return "That owner is not a member of this organization.";
  }

  return null;
}
