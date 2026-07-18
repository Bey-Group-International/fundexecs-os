// lib/skills/catalog/reconcile.ts
// Native skill: prepare a GL / BANK RECONCILIATION for operator review — tie the
// statement balance to the ledger balance, surface the difference, and detect
// transaction-level BREAKS (unmatched items and amount mismatches). Pure,
// deterministic core — the tested execution path. Like every FundExecs skill it
// NEVER invents a balance or an amount: a missing input is FLAGGED (missingFields)
// and the difference is null, a provided figure is a fact (kind:"fact"), and every
// computed number is a calculation (kind:"calculation").
//
// GUARDRAIL: this skill PREPARES a reconciliation for review. It NEVER posts a
// journal entry and NEVER closes a period — those are separate, gated actions
// (post_journal_entry / post_to_closed_period / close_period, all prohibited on
// this manifest). Nothing here moves capital or mutates the books.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface ReconcileTransaction {
  description: string;
  /** Amount per the bank/statement side. */
  statementAmount?: number;
  /** Amount per the general-ledger side. */
  ledgerAmount?: number;
  /** Explicit match flag; matched === false is treated as an outstanding item. */
  matched?: boolean;
}

export interface ReconcileInput {
  accountName?: string;
  statementBalance?: number;
  ledgerBalance?: number;
  transactions?: ReconcileTransaction[];
}

export interface ReconcileBreak {
  description: string;
  statementAmount: number | null;
  ledgerAmount: number | null;
  /** (statementAmount ?? 0) − (ledgerAmount ?? 0). */
  variance: number;
}

export interface ReconcileOutput {
  /** round(statementBalance − ledgerBalance, 2), or null when a balance is missing. */
  difference: number | null;
  reconciled: boolean;
  breaks: ReconcileBreak[];
  totalUnexplained: number;
  matchedCount: number;
  unmatchedCount: number;
  missingFields: string[];
  keyRisks: string[];
  recommendedAction: string;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

const round2 = (n: number) => Math.round(n * 100) / 100;

const run: SkillCore<ReconcileInput, ReconcileOutput> = (input): SkillCoreResult<ReconcileOutput> => {
  const sources: SkillSource[] = [];
  const missingFields: string[] = [];
  const keyRisks: string[] = [];

  // --- Provided figures are FACTS. Nothing here is fabricated. ---
  if (input.accountName != null && input.accountName !== "") {
    sources.push({ label: "Account", kind: "fact", value: input.accountName });
  }
  if (input.statementBalance != null) sources.push({ label: "Statement balance", kind: "fact", value: input.statementBalance });
  if (input.ledgerBalance != null) sources.push({ label: "Ledger balance", kind: "fact", value: input.ledgerBalance });

  // --- Both balances are REQUIRED. A missing balance is FLAGGED, never invented,
  //     and the difference stays null (we do not guess it). ---
  if (input.statementBalance == null) missingFields.push("Statement balance");
  if (input.ledgerBalance == null) missingFields.push("Ledger balance");

  const haveBalances = input.statementBalance != null && input.ledgerBalance != null;

  let difference: number | null = null;
  if (haveBalances) {
    difference = round2((input.statementBalance as number) - (input.ledgerBalance as number));
    sources.push({ label: "Difference", kind: "calculation", value: difference, ref: "statementBalance − ledgerBalance" });
  } else {
    keyRisks.push("Reconciliation not computable — statement balance and/or ledger balance missing.");
  }

  const reconciled = difference === 0;

  // --- Transaction-level BREAK detection. A break is an outstanding item
  //     (matched === false) OR an amount mismatch (both sides present and unequal). ---
  const transactions = input.transactions ?? [];
  const breaks: ReconcileBreak[] = [];
  let matchedCount = 0;
  let unmatchedCount = 0;

  for (const t of transactions) {
    if (t.matched === false) unmatchedCount++;
    else matchedCount++;

    const amountMismatch =
      t.statementAmount != null && t.ledgerAmount != null && t.statementAmount !== t.ledgerAmount;
    const isBreak = t.matched === false || amountMismatch;

    if (isBreak) {
      const variance = round2((t.statementAmount ?? 0) - (t.ledgerAmount ?? 0));
      breaks.push({
        description: t.description,
        statementAmount: t.statementAmount ?? null,
        ledgerAmount: t.ledgerAmount ?? null,
        variance,
      });
      sources.push({ label: `Break variance — ${t.description}`, kind: "calculation", value: variance, ref: "statementAmount − ledgerAmount" });
    }
  }

  const totalUnexplained = round2(breaks.reduce((s, b) => s + b.variance, 0));
  if (breaks.length > 0) {
    sources.push({ label: "Total unexplained", kind: "calculation", value: totalUnexplained, ref: "Σ break variances" });
  }

  // --- Key risks (deterministic). ---
  if (difference !== null && difference !== 0) keyRisks.push("Statement and ledger do not tie");
  if (breaks.length > 0) keyRisks.push(`${breaks.length} unexplained break(s)`);

  // --- Completeness / confidence / recommendation. ---
  // Completeness is driven by the two required balances (the reconciliation cannot
  // be prepared without them).
  const present = (input.statementBalance != null ? 1 : 0) + (input.ledgerBalance != null ? 1 : 0);
  const completeness = Math.round((present / 2) * 100) / 100;
  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.4 + (haveBalances && reconciled && breaks.length === 0 ? 0.2 : 0)));

  const recommendedAction = !haveBalances
    ? "Provide the statement balance and the ledger balance to prepare the reconciliation for review."
    : reconciled && breaks.length === 0
      ? "Reconciliation ties and no unexplained breaks — prepared for operator review. Posting any adjustment or closing the period is a separate authorized action."
      : `Reconciliation prepared for operator review: resolve ${breaks.length} break(s)${difference !== null && difference !== 0 ? ` and the $${difference} difference` : ""} before sign-off. This skill does not post journal entries or close the period — those are separate authorized actions.`;

  const structured: ReconcileOutput = {
    difference,
    reconciled,
    breaks,
    totalUnexplained,
    matchedCount,
    unmatchedCount,
    missingFields,
    keyRisks,
    recommendedAction,
  };

  const accountLabel = input.accountName && input.accountName !== "" ? input.accountName : "account";
  const narrative = !haveBalances
    ? `Reconciliation for ${accountLabel} not computable — missing ${missingFields.join(", ") || "required balances"}. Next: ${recommendedAction}`
    : `Reconciliation for ${accountLabel}: ${reconciled ? "TIES" : `difference $${difference}`}` +
      `${breaks.length ? `, ${breaks.length} unexplained break(s) totalling $${totalUnexplained}` : ", no unexplained breaks"}. ` +
      `Prepared for operator review — this skill does not post entries or close the period. Next: ${recommendedAction}`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingFields };
};

// ---------------------------------------------------------------------------
// Schemas + manifest
// ---------------------------------------------------------------------------

const inputSchema: JsonSchema = {
  type: "object",
  properties: {
    accountName: { type: "string" },
    statementBalance: { type: "number" },
    ledgerBalance: { type: "number" },
    transactions: {
      type: "array",
      items: {
        type: "object",
        required: ["description"],
        properties: {
          description: { type: "string", minLength: 1 },
          statementAmount: { type: "number" },
          ledgerAmount: { type: "number" },
          matched: { type: "boolean" },
        },
      },
    },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["difference", "reconciled", "breaks", "totalUnexplained", "matchedCount", "unmatchedCount", "recommendedAction"],
  properties: {
    difference: { type: "number" },
    reconciled: { type: "boolean" },
    breaks: {
      type: "array",
      items: {
        type: "object",
        required: ["description", "variance"],
        properties: {
          description: { type: "string" },
          statementAmount: { type: "number" },
          ledgerAmount: { type: "number" },
          variance: { type: "number" },
        },
      },
    },
    totalUnexplained: { type: "number" },
    matchedCount: { type: "integer", minimum: 0 },
    unmatchedCount: { type: "integer", minimum: 0 },
    missingFields: { type: "array", items: { type: "string" } },
    keyRisks: { type: "array", items: { type: "string" } },
    recommendedAction: { type: "string" },
  },
};

export const reconcileManifest: SkillManifest = {
  id: "reconcile",
  name: "Account Reconciliation",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["fund_admin"],
  supportedEntityTypes: ["fund", "capital_activity", "financial_model"],
  requiredInputs: [],
  optionalInputs: ["accountName", "statementBalance", "ledgerBalance", "transactions"],
  outputs: ["difference", "reconciled", "breaks", "totalUnexplained", "matchedCount", "unmatchedCount", "missingFields", "keyRisks", "recommendedAction"],
  artifactTypes: ["analysis"],
  dataPermissions: ["fund:read", "capital_activity:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "no fabricated balances or amounts", "difference is null when a balance is missing"],
  evaluationCriteria: ["difference correct on golden cases", "breaks detected (unmatched + amount mismatch)", "missing balances flagged not invented", "prepares only — never posts or closes"],
  providerCapabilities: ["structured_extraction", "financial_reasoning"],
  allowedDownstreamSkills: ["nav-review", "close-period"],
  prohibitedActions: ["post_journal_entry", "post_to_closed_period", "close_period", "move_capital"],
  inputSchema,
  outputSchema,
};

export const reconcile: SkillDefinition<ReconcileInput, ReconcileOutput> = {
  manifest: reconcileManifest,
  run,
};
