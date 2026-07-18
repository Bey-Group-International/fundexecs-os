// lib/skills/catalog/ic-memo.ts
// Native skill: assemble an Investment Committee pre-read (memorandum) from
// ALREADY-STRUCTURED deal data — typically the output of the screen-deal and
// returns skills. Pure, deterministic core — the tested execution path.
//
// This skill PREPARES a memo; it NEVER makes the investment decision. The
// recommendation it carries is explicitly PRELIMINARY and advisory, the memo
// carries open items + conditions precedent, and a missing input becomes an
// OPEN ITEM — never a fabricated financial or market claim.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";

// ---------------------------------------------------------------------------
// I/O types
// ---------------------------------------------------------------------------

export interface IcMemoDeal {
  companyName: string;
  sector?: string;
  geography?: string;
  transactionType?: string;
}

export interface IcMemoScreen {
  verdict?: "pass" | "watch" | "fail";
  overall?: number;
  keyRisks?: string[];
}

export interface IcMemoReturns {
  moic?: number;
  irrPct?: number;
  entryEv?: number;
  exitEv?: number;
}

export interface IcMemoInput {
  deal: IcMemoDeal;
  thesis?: string;
  screen?: IcMemoScreen;
  returns?: IcMemoReturns;
  market?: string;
  mitigants?: string[];
  recommendation?: string;
}

export type MemoSectionStatus = "complete" | "open";

export interface MemoSection {
  heading: string;
  body: string;
  status: MemoSectionStatus;
}

export interface IcMemoOutput {
  sections: MemoSection[];
  recommendation: string;
  openItems: string[];
  conditionsPrecedent: string[];
  missingSections: string[];
  /** 0–1 fraction of sections that are complete. */
  completeness: number;
}

// ---------------------------------------------------------------------------
// Deterministic core
// ---------------------------------------------------------------------------

/** Standard, generated conditions precedent — not deal-specific claims. */
const CONDITIONS_PRECEDENT = [
  "Confirmatory diligence complete",
  "Final IC approval",
  "Definitive documentation",
];

/** The NEUTRAL, standard IC posture implied by a screen verdict. This mapping is
 *  an assumption, not a decision — it is labelled as such in `sources`. */
const VERDICT_RECOMMENDATION: Record<NonNullable<IcMemoScreen["verdict"]>, string> = {
  pass: "Advance to full IC review",
  watch: "Conditional — resolve open items first",
  fail: "Do not proceed",
};

const clean = (s: string | undefined): string => (s ?? "").trim();
const nonEmpty = (xs: string[] | undefined): string[] => (xs ?? []).map((x) => clean(x)).filter((x) => x !== "");
const numbered = (xs: string[]): string => xs.map((x, i) => `${i + 1}. ${x}`).join("\n");

const run: SkillCore<IcMemoInput, IcMemoOutput> = (input): SkillCoreResult<IcMemoOutput> => {
  const { deal, thesis, screen, returns, market, mitigants, recommendation } = input;
  const sources: SkillSource[] = [];
  const openItems: string[] = [];
  const sections: MemoSection[] = [];

  const verdict = screen?.verdict;
  const overall = screen?.overall;
  const moic = returns?.moic;
  const irrPct = returns?.irrPct;
  const entryEv = returns?.entryEv;
  const exitEv = returns?.exitEv;
  const risks = nonEmpty(screen?.keyRisks);
  const mits = nonEmpty(mitigants);

  // Open items are pushed at each call site with the heading-specific context.
  const add = (heading: string, body: string, status: MemoSectionStatus): void => {
    sections.push({ heading, body, status });
  };

  // Provided data is recorded as FACTS — never fabricated.
  if (verdict) sources.push({ label: "Screen verdict", kind: "fact", value: verdict });
  if (overall != null) sources.push({ label: "Screen overall fit", kind: "fact", value: overall });
  if (moic != null) sources.push({ label: "MOIC", kind: "fact", value: moic });
  if (irrPct != null) sources.push({ label: "IRR %", kind: "fact", value: irrPct });

  // 1. Executive Summary — synthesizes company + screen verdict + returns headline.
  const returnsHeadline =
    moic != null || irrPct != null
      ? ` Headline returns: ${[moic != null ? `${moic}x MOIC` : null, irrPct != null ? `${irrPct}% IRR` : null].filter(Boolean).join(", ")}.`
      : "";
  const execBody =
    `${deal.companyName}${deal.sector ? ` (${deal.sector})` : ""}${deal.geography ? `, ${deal.geography}` : ""} — ` +
    `${deal.transactionType ?? "transaction"} pre-read for the Investment Committee. ` +
    `Screen verdict: ${verdict ? verdict.toUpperCase() : "not yet screened"}${overall != null ? ` (${overall}/100 mandate fit)` : ""}.` +
    returnsHeadline +
    ` This memo assembles structured deal data for committee review; it is not an investment decision.`;
  add("Executive Summary", execBody, "complete");

  // 2. Recommendation — PRELIMINARY and advisory. Provided, else derived neutrally
  //    from the screen verdict, else an open item. Never a decision.
  let recText: string;
  let recStatus: MemoSectionStatus;
  if (clean(recommendation) !== "") {
    recText = clean(recommendation);
    recStatus = "complete";
    sources.push({ label: "Preliminary recommendation", kind: "generated", value: recText });
  } else if (verdict) {
    recText = VERDICT_RECOMMENDATION[verdict];
    recStatus = "complete";
    sources.push({ label: "Assumed recommendation basis", kind: "assumption", value: `screen verdict "${verdict}" → standard IC posture` });
    sources.push({ label: "Preliminary recommendation", kind: "generated", value: recText });
  } else {
    recText = "No recommendation can be formed yet — provide a screen verdict or an explicit recommendation.";
    recStatus = "open";
    openItems.push("Recommendation pending — provide a screen verdict or an explicit recommendation.");
  }
  add("Recommendation", `PRELIMINARY recommendation for the IC's decision (advisory — NOT a decision): ${recText}`, recStatus);

  // 3. Transaction Overview — from the deal fields (companyName is required).
  const overviewBody = [
    `Company: ${deal.companyName}`,
    `Sector: ${deal.sector ?? "not specified"}`,
    `Geography: ${deal.geography ?? "not specified"}`,
    `Transaction type: ${deal.transactionType ?? "not specified"}`,
  ].join(" · ");
  add("Transaction Overview", overviewBody, "complete");

  // 4. Investment Thesis.
  if (clean(thesis) !== "") {
    add("Investment Thesis", clean(thesis), "complete");
  } else {
    add("Investment Thesis", "Pending — articulate the investment thesis.", "open");
    openItems.push("Investment thesis pending — articulate the thesis.");
  }

  // 5. Market — NEVER fabricate a market claim.
  if (clean(market) !== "") {
    add("Market", clean(market), "complete");
  } else {
    add("Market", "Pending — run the market / sector research skill. No market claims are asserted without a source.", "open");
    openItems.push("Market analysis pending — run the market / sector research skill.");
  }

  // 6. Financials & Valuation — provided entry/exit EV, else open.
  if (entryEv != null || exitEv != null) {
    const fvParts: string[] = [];
    if (entryEv != null) { fvParts.push(`Entry EV: ${entryEv}`); sources.push({ label: "Entry EV", kind: "fact", value: entryEv }); }
    if (exitEv != null) { fvParts.push(`Exit EV: ${exitEv}`); sources.push({ label: "Exit EV", kind: "fact", value: exitEv }); }
    add("Financials & Valuation", `Provided figures — ${fvParts.join(", ")}. Confirm valuation and EBITDA quality in diligence.`, "complete");
  } else {
    add("Financials & Valuation", "Pending — provide entry / exit valuation (run the returns skill).", "open");
    openItems.push("Financials & valuation pending — provide entry / exit valuation.");
  }

  // 7. Returns — state provided MOIC/IRR as given figures, else open. Never invented.
  if (moic != null || irrPct != null) {
    const rParts: string[] = [];
    if (moic != null) rParts.push(`${moic}x MOIC`);
    if (irrPct != null) rParts.push(`${irrPct}% IRR`);
    add("Returns", `Provided figures — ${rParts.join(", ")}. Figures as supplied; confirm the underlying returns model.`, "complete");
  } else {
    add("Returns", "Pending — run the returns skill.", "open");
    openItems.push("Returns pending — run the returns skill.");
  }

  // 8. Key Risks.
  if (risks.length > 0) {
    add("Key Risks", numbered(risks), "complete");
  } else {
    add("Key Risks", "Pending — run the screen-deal skill or supply key risks.", "open");
    openItems.push("Key risks pending — run the screen-deal skill or supply key risks.");
  }

  // 9. Mitigants — if risks are present but no mitigants, this is flagged.
  if (mits.length > 0) {
    add("Mitigants", numbered(mits), "complete");
  } else {
    add("Mitigants", "Mitigants pending.", "open");
    openItems.push("Mitigants pending");
  }

  // 10. Open Items — the running summary of everything flagged above.
  add("Open Items", openItems.length > 0 ? numbered(openItems) : "None — all sections populated.", "complete");

  // 11. Conditions Precedent — a standard, GENERATED list, not deal-specific claims.
  add("Conditions Precedent", numbered(CONDITIONS_PRECEDENT), "complete");
  sources.push({ label: "Conditions precedent", kind: "generated", value: CONDITIONS_PRECEDENT.join("; ") });

  // 12. Decision History — placeholder; the IC records decisions, not this skill.
  add("Decision History", "No decisions recorded yet.", "complete");

  const missingSections = sections.filter((s) => s.status === "open").map((s) => s.heading);
  const completeCount = sections.length - missingSections.length;
  const completeness = Math.round((completeCount / sections.length) * 100) / 100;

  const structured: IcMemoOutput = {
    sections,
    recommendation: recText,
    openItems,
    conditionsPrecedent: CONDITIONS_PRECEDENT.slice(),
    missingSections,
    completeness,
  };

  const confidence = Math.max(0.2, Math.min(0.9, 0.3 + completeness * 0.6));

  const narrative =
    `IC pre-read for ${deal.companyName} assembled: ${completeCount}/${sections.length} sections complete` +
    `${missingSections.length ? `, ${missingSections.length} open (${missingSections.join(", ")})` : ""}. ` +
    `Preliminary recommendation: ${recStatus === "open" ? "pending" : recText}. ` +
    `This prepares the memo for the committee; it does not make the investment decision.`;

  return { structured, narrative, sources, confidence, completeness, missingData: missingSections };
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
      required: ["companyName"],
      properties: {
        companyName: { type: "string", minLength: 1 },
        sector: { type: "string" },
        geography: { type: "string" },
        transactionType: { type: "string" },
      },
    },
    thesis: { type: "string" },
    screen: {
      type: "object",
      properties: {
        verdict: { type: "string", enum: ["pass", "watch", "fail"] },
        overall: { type: "number", minimum: 0, maximum: 100 },
        keyRisks: { type: "array", items: { type: "string" } },
      },
    },
    returns: {
      type: "object",
      properties: {
        moic: { type: "number", minimum: 0 },
        irrPct: { type: "number" },
        entryEv: { type: "number", minimum: 0 },
        exitEv: { type: "number", minimum: 0 },
      },
    },
    market: { type: "string" },
    mitigants: { type: "array", items: { type: "string" } },
    recommendation: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["sections", "recommendation", "openItems", "conditionsPrecedent", "missingSections", "completeness"],
  properties: {
    sections: {
      type: "array",
      items: {
        type: "object",
        required: ["heading", "body", "status"],
        properties: {
          heading: { type: "string" },
          body: { type: "string" },
          status: { type: "string", enum: ["complete", "open"] },
        },
      },
    },
    recommendation: { type: "string" },
    openItems: { type: "array", items: { type: "string" } },
    conditionsPrecedent: { type: "array", items: { type: "string" } },
    missingSections: { type: "array", items: { type: "string" } },
    completeness: { type: "number", minimum: 0, maximum: 1 },
  },
};

export const icMemoManifest: SkillManifest = {
  id: "ic-memo",
  name: "IC Memorandum (Pre-Read)",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["investment_committee"],
  supportedEntityTypes: ["deal", "company", "ic_memo"],
  requiredInputs: ["deal.companyName"],
  optionalInputs: ["thesis", "screen", "returns", "market", "mitigants", "recommendation"],
  outputs: ["sections", "recommendation", "openItems", "conditionsPrecedent", "missingSections", "completeness"],
  artifactTypes: ["ic_memo"],
  dataPermissions: ["deal:read", "ic_memo:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "low",
  executionTimeoutMs: 20_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "no fabricated financial or market values — a missing input becomes an open item",
  ],
  evaluationCriteria: [
    "all twelve headings assembled in order",
    "missing inputs flagged as open items, never invented",
    "recommendation is preliminary/advisory, never a decision",
    "facts, assumptions, and generated content separated in sources",
  ],
  providerCapabilities: ["financial_reasoning", "structured_extraction"],
  allowedDownstreamSkills: [],
  prohibitedActions: ["submit_term_sheet", "sign_document", "move_capital", "capital_call", "distribute_report"],
  inputSchema,
  outputSchema,
};

export const icMemo: SkillDefinition<IcMemoInput, IcMemoOutput> = {
  manifest: icMemoManifest,
  run,
};
