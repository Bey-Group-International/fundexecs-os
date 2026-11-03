// lib/skills/catalog/exit-routes.ts
// Exit Strategy (PE department · Exit 01). Compares exit routes on net proceeds,
// returns against the hurdle, timing against fund life, and the user's stated
// certainty. Every value range must cite its basis; the skill holds no market view
// and invents no probability. Primary and fallback routes come from a stated,
// rule-based ordering (eligible = fits fund life AND clears the hurdle at the LOW
// value; then certainty; then low-case MOIC). The IC approves the route. Pure core.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";
import { DEFAULT_RETURNS, testHurdle, type HurdleVerdict, type ReturnsHurdles } from "@/lib/pe/returns-hurdles";

export type Certainty = "high" | "medium" | "low";

export interface RouteIn {
  name: string;
  /** Exit enterprise value range. */
  evLow: number;
  evHigh: number;
  /** The basis for the range (comps, indicative bids…). REQUIRED to count. */
  basis?: string;
  monthsToClose: number;
  certainty: Certainty;
  /** Transaction + separation costs, % of EV. */
  costPct: number;
}

export interface ExitRoutesInput {
  company: string;
  /** Equity invested (the fund's share) and the fund's ownership of the equity at exit. */
  equityInvested: number;
  ownershipPct: number;
  /** Net debt at exit, deducted from EV. */
  netDebtAtExit: number;
  /** Years already held. */
  yearsHeld: number;
  /** Months of fund life left. */
  fundLifeRemainingMonths?: number;
  routes: RouteIn[];
  hurdles?: ReturnsHurdles;
  gateOwner?: string;
}

export interface RouteRow {
  name: string;
  basisCited: boolean;
  proceedsLow: number;
  proceedsHigh: number;
  moicLow: number | null;
  moicHigh: number | null;
  irrLow: number | null;
  irrHigh: number | null;
  hurdleAtLow: HurdleVerdict;
  hurdleAtHigh: HurdleVerdict;
  fitsFundLife: boolean | null;
  certainty: Certainty;
  eligible: boolean;
  rank: number | null;
  notes: string[];
}

export interface ExitRoutesOutput {
  routes: RouteRow[];
  primary: string | null;
  fallback: string | null;
  orderingRule: string;
  hurdlesAreDefault: boolean;
  limitation: string;
  gate: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const CERT: Record<Certainty, number> = { high: 0, medium: 1, low: 2 };

const run: SkillCore<ExitRoutesInput, ExitRoutesOutput> = (input): SkillCoreResult<ExitRoutesOutput> => {
  const sources: SkillSource[] = [];
  const missingData: string[] = [];
  const hurdlesAreDefault = !input.hurdles;
  const hurdles = input.hurdles ?? DEFAULT_RETURNS;
  if (hurdlesAreDefault) sources.push({ label: "Return hurdles", kind: "assumption", value: "standing default: gross IRR 20%, MOIC 2.5x", ref: "run on default settings — set root-returns" });
  if (input.fundLifeRemainingMonths === undefined) missingData.push("Fund life remaining — the fund-life test is not applied");

  const own = input.ownershipPct / 100;
  const rows: RouteRow[] = input.routes.map((r) => {
    const notes: string[] = [];
    const basisCited = !!r.basis?.trim();
    if (!basisCited) {
      notes.push("Value range cites no basis — route cannot be recommended.");
      missingData.push(`${r.name}: value range has no basis`);
    }
    if (r.evLow > r.evHigh) notes.push("evLow is above evHigh — check the range.");

    const proceeds = (ev: number) => r2(Math.max(0, ev * (1 - r.costPct / 100) - input.netDebtAtExit) * own);
    const pLow = proceeds(r.evLow);
    const pHigh = proceeds(r.evHigh);
    const moic = (p: number) => (input.equityInvested > 0 ? r4(p / input.equityInvested) : null);
    const years = input.yearsHeld + r.monthsToClose / 12;
    const irr = (p: number) => {
      const m = moic(p);
      return m !== null && m > 0 && years > 0 ? r4(Math.pow(m, 1 / years) - 1) : null;
    };
    const mL = moic(pLow);
    const mH = moic(pHigh);
    const iL = irr(pLow);
    const iH = irr(pHigh);
    const hLow = testHurdle(hurdles.base, iL, mL);
    const hHigh = testHurdle(hurdles.base, iH, mH);
    const fits = input.fundLifeRemainingMonths === undefined ? null : r.monthsToClose <= input.fundLifeRemainingMonths;
    if (fits === false) notes.push(`Needs ${r.monthsToClose} months; fund life leaves ${input.fundLifeRemainingMonths}.`);
    if (hLow === "misses") notes.push(hHigh === "clears" ? "Clears the hurdle only at the high end of the value range." : "Misses the hurdle across the value range.");

    const eligible = basisCited && fits !== false && hLow === "clears";
    sources.push({ label: `${r.name} proceeds range`, kind: "calculation", value: `${pLow}–${pHigh}`, ref: `EV × (1 − cost) − net debt, × ${input.ownershipPct}% ownership` });
    return { name: r.name, basisCited, proceedsLow: pLow, proceedsHigh: pHigh, moicLow: mL, moicHigh: mH, irrLow: iL, irrHigh: iH, hurdleAtLow: hLow, hurdleAtHigh: hHigh, fitsFundLife: fits, certainty: r.certainty, eligible, rank: null, notes };
  });

  const eligible = rows.filter((r) => r.eligible).sort((a, b) => CERT[a.certainty] - CERT[b.certainty] || (b.moicLow ?? 0) - (a.moicLow ?? 0) || a.name.localeCompare(b.name));
  eligible.forEach((r, i) => (r.rank = i + 1));
  rows.sort((a, b) => (a.rank ?? 99) - (b.rank ?? 99) || a.name.localeCompare(b.name));

  const primary = eligible[0]?.name ?? null;
  const fallback = eligible[1]?.name ?? null;
  const orderingRule = "Eligible = value range cites a basis, fits the fund life (when given), and clears the base hurdle at the LOW end of the range. Eligible routes are ordered by stated certainty, then low-case MOIC.";
  const gateOwner = input.gateOwner?.trim() || "The IC";
  const gate = `${gateOwner} approves the exit route.`;
  const limitation = "Exit timing depends on markets this skill cannot forecast; certainty is the deal team's stated view, not a model output. Revisit every quarter.";
  const narrative = primary
    ? `Exit routes, ${input.company}: primary ${primary}${fallback ? `, fallback ${fallback}` : ", no eligible fallback"}. ${gate}`
    : `Exit routes, ${input.company}: no route is eligible on the stated bases, fund life and hurdle — revisit values, timing or the hurdle. ${gate}`;

  const completeness = rows.length ? Math.round((rows.filter((r) => r.basisCited).length / rows.length) * 100) / 100 : 0;
  return { structured: { routes: rows, primary, fallback, orderingRule, hurdlesAreDefault, limitation, gate }, narrative, sources, confidence: Math.max(0.25, Math.min(0.8, 0.3 + completeness * 0.45)), completeness, missingData };
};

const inputSchema: JsonSchema = {
  type: "object",
  required: ["company", "equityInvested", "ownershipPct", "netDebtAtExit", "yearsHeld", "routes"],
  properties: {
    company: { type: "string", minLength: 1 },
    equityInvested: { type: "number", minimum: 0 },
    ownershipPct: { type: "number", minimum: 0, maximum: 100 },
    netDebtAtExit: { type: "number" },
    yearsHeld: { type: "number", minimum: 0 },
    fundLifeRemainingMonths: { type: "number", minimum: 0 },
    routes: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "evLow", "evHigh", "monthsToClose", "certainty", "costPct"],
        properties: {
          name: { type: "string", minLength: 1 },
          evLow: { type: "number", minimum: 0 },
          evHigh: { type: "number", minimum: 0 },
          basis: { type: "string" },
          monthsToClose: { type: "number", minimum: 0 },
          certainty: { type: "string", enum: ["high", "medium", "low"] },
          costPct: { type: "number", minimum: 0, maximum: 100 },
        },
      },
    },
    hurdles: { type: "object", required: ["base", "holdYears"], properties: { base: { type: "object", properties: { irr: { type: "number" }, moic: { type: "number" } } }, downside: { type: "object" }, holdYears: { type: "number" } } },
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["routes", "orderingRule", "hurdlesAreDefault", "limitation", "gate"],
  properties: {
    routes: { type: "array", items: { type: "object", required: ["name", "basisCited", "proceedsLow", "proceedsHigh", "hurdleAtLow", "hurdleAtHigh", "certainty", "eligible", "notes"] } },
    primary: { type: "string" },
    fallback: { type: "string" },
    orderingRule: { type: "string" },
    hurdlesAreDefault: { type: "boolean" },
    limitation: { type: "string" },
    gate: { type: "string" },
  },
};

export const exitRoutesManifest: SkillManifest = {
  id: "exit-routes",
  name: "Exit Strategy & Route Comparison",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["analyst", "investment_committee"],
  supportedEntityTypes: ["asset", "company"],
  requiredInputs: ["company", "equityInvested", "ownershipPct", "netDebtAtExit", "yearsHeld", "routes"],
  optionalInputs: ["fundLifeRemainingMonths", "hurdles", "gateOwner"],
  outputs: ["routes", "primary", "fallback", "orderingRule", "gate"],
  artifactTypes: ["analysis"],
  dataPermissions: ["asset:read", "valuation:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 10_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "each value range cites its basis", "fund-life constraint explicit"],
  evaluationCriteria: ["route without basis not eligible", "fund-life miss flagged", "hurdle tested at low end", "ordering rule stated"],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["exit-readiness", "buyer-list", "final-investment-report"],
  prohibitedActions: ["send_outreach", "distribute_report", "share_materials", "sign_document", "move_capital"],
  inputSchema,
  outputSchema,
};

export const exitRoutes: SkillDefinition<ExitRoutesInput, ExitRoutesOutput> = { manifest: exitRoutesManifest, run };
