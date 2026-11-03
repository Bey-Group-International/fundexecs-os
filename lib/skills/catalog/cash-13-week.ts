// lib/skills/catalog/cash-13-week.ts
// 13-Week Cash Flow (PE department · Portfolio 05). Rolls a direct weekly cash
// forecast from supplied receipts and payments, tests weekly closing cash against
// the liquidity minimum and any undrawn facility, builds a downside-receipts case,
// and logs forecast accuracy against actuals. Never invents a collection
// assumption: a downside haircut is the user's number or it is reported missing.
// Pure core. The company CFO owns the forecast.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";
import { DEFAULT_FINANCING, type FinancingPolicy } from "@/lib/pe/financing-policy";

export interface WeekIn {
  receipts: number;
  payments: number;
  debtService?: number;
  oneOffs?: number;
}

export interface CashInput {
  company: string;
  openingCash: number;
  /** True when opening cash has been tied to the bank statements. */
  openingTiedToBank?: boolean;
  weeks: WeekIn[];
  /** Undrawn, available committed facility. */
  facilityAvailable?: number;
  /** Downside: receipts reduced by this percent. The user's call; never defaulted. */
  downsideReceiptsHaircutPct?: number;
  /** Set when collection history is thin, so a missing haircut is flagged. */
  thinCollectionHistory?: boolean;
  /** Last forecast's closing cash per week, and the actuals that have since landed. */
  priorForecastClosing?: number[];
  actualClosing?: number[];
  financing?: FinancingPolicy;
  gateOwner?: string;
}

export interface WeekRow {
  week: number;
  opening: number;
  receipts: number;
  payments: number;
  debtService: number;
  oneOffs: number;
  net: number;
  closing: number;
  belowMinimum: boolean | null;
  needsFacility: boolean;
}

export interface CaseSummary {
  rows: WeekRow[];
  minClosing: number;
  minWeek: number;
  weeksBelowMinimum: number[] | null;
  facilityDrawNeeded: number;
  breachesFacility: boolean | null;
}

export interface CashOutput {
  base: CaseSummary;
  downside: CaseSummary | null;
  liquidityMinimum: number | null;
  accuracy: Array<{ week: number; forecast: number; actual: number; variance: number; variancePct: number | null }>;
  openingTiedToBank: boolean;
  limitation: string;
  gate: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

function roll(input: CashInput, weeks: WeekIn[], minimum: number | null): CaseSummary {
  let cash = input.openingCash;
  const rows: WeekRow[] = [];
  weeks.forEach((w, i) => {
    const opening = cash;
    const ds = w.debtService ?? 0;
    const oo = w.oneOffs ?? 0;
    const net = r2(w.receipts - w.payments - ds - oo);
    cash = r2(opening + net);
    rows.push({
      week: i + 1,
      opening: r2(opening),
      receipts: w.receipts,
      payments: w.payments,
      debtService: ds,
      oneOffs: oo,
      net,
      closing: cash,
      belowMinimum: minimum === null ? null : cash < minimum,
      needsFacility: cash < 0,
    });
  });
  const min = rows.reduce((a, b) => (b.closing < a.closing ? b : a), rows[0]);
  // Draw needed to keep every week at or above the minimum (or zero when no minimum is set).
  const floor = minimum ?? 0;
  const drawNeeded = Math.max(0, r2(floor - min.closing));
  return {
    rows,
    minClosing: min.closing,
    minWeek: min.week,
    weeksBelowMinimum: minimum === null ? null : rows.filter((r) => r.closing < minimum).map((r) => r.week),
    facilityDrawNeeded: drawNeeded,
    breachesFacility: input.facilityAvailable === undefined ? null : drawNeeded > input.facilityAvailable,
  };
}

const run: SkillCore<CashInput, CashOutput> = (input): SkillCoreResult<CashOutput> => {
  const sources: SkillSource[] = [];
  const missingData: string[] = [];
  const policy = input.financing ?? DEFAULT_FINANCING;
  const minimum = policy.liquidityMinimum ?? null;
  if (minimum === null) missingData.push("Liquidity minimum — set it in root-financing; weeks are tested against zero cash only");

  sources.push({ label: "Opening cash", kind: "fact", value: input.openingCash, ref: input.openingTiedToBank ? "tied to bank statements" : "NOT tied to bank statements" });
  if (!input.openingTiedToBank) missingData.push("Opening cash is not tied to the bank statements");
  if (input.weeks.length !== 13) missingData.push(`Forecast covers ${input.weeks.length} week(s), not 13`);

  const base = roll(input, input.weeks, minimum);
  sources.push({ label: "Minimum weekly closing cash", kind: "calculation", value: `${base.minClosing} (week ${base.minWeek})`, ref: "opening + receipts − payments − debt service − one-offs, rolled weekly" });

  let downside: CaseSummary | null = null;
  if (typeof input.downsideReceiptsHaircutPct === "number") {
    const f = 1 - input.downsideReceiptsHaircutPct / 100;
    downside = roll(input, input.weeks.map((w) => ({ ...w, receipts: r2(w.receipts * f) })), minimum);
    sources.push({ label: "Downside receipts haircut", kind: "assumption", value: `${input.downsideReceiptsHaircutPct}% (supplied)` });
  } else if (input.thinCollectionHistory) {
    missingData.push("Collection history is thin but no downside receipts haircut was supplied — downside case not shown");
  }

  const accuracy: CashOutput["accuracy"] = [];
  const n = Math.min(input.priorForecastClosing?.length ?? 0, input.actualClosing?.length ?? 0);
  for (let i = 0; i < n; i++) {
    const forecast = (input.priorForecastClosing as number[])[i];
    const actual = (input.actualClosing as number[])[i];
    const variance = r2(actual - forecast);
    accuracy.push({ week: i + 1, forecast, actual, variance, variancePct: forecast !== 0 ? r2((variance / Math.abs(forecast)) * 100) : null });
  }
  if (accuracy.length === 0) missingData.push("No prior forecast vs actuals — accuracy log is empty");

  const gateOwner = input.gateOwner?.trim() || "The portfolio company CFO";
  const gate = `${gateOwner} owns the forecast.`;
  const limitation = "The forecast depends on collection assumptions. Where collection history is thin, show a downside receipts case.";
  const narrative =
    `13-week cash, ${input.company}: minimum closing ${base.minClosing} in week ${base.minWeek}` +
    `${base.weeksBelowMinimum?.length ? `; below the ${minimum} minimum in week(s) ${base.weeksBelowMinimum.join(", ")}` : ""}. ` +
    `${base.facilityDrawNeeded > 0 ? `Facility draw needed: ${base.facilityDrawNeeded}${base.breachesFacility ? " — EXCEEDS the available facility" : ""}. ` : ""}` +
    `${downside ? `Downside minimum ${downside.minClosing} (week ${downside.minWeek}). ` : ""}${gate}`;

  const completeness = Math.round(((input.openingTiedToBank ? 1 : 0) + (input.weeks.length === 13 ? 1 : 0) + (minimum !== null ? 1 : 0) + (accuracy.length ? 1 : 0)) / 4 * 100) / 100;
  return {
    structured: { base, downside, liquidityMinimum: minimum, accuracy, openingTiedToBank: !!input.openingTiedToBank, limitation, gate },
    narrative,
    sources,
    confidence: Math.max(0.25, Math.min(0.85, 0.3 + completeness * 0.5)),
    completeness,
    missingData,
  };
};

const inputSchema: JsonSchema = {
  type: "object",
  required: ["company", "openingCash", "weeks"],
  properties: {
    company: { type: "string", minLength: 1 },
    openingCash: { type: "number" },
    openingTiedToBank: { type: "boolean" },
    weeks: {
      type: "array",
      items: { type: "object", required: ["receipts", "payments"], properties: { receipts: { type: "number", minimum: 0 }, payments: { type: "number", minimum: 0 }, debtService: { type: "number", minimum: 0 }, oneOffs: { type: "number" } } },
    },
    facilityAvailable: { type: "number", minimum: 0 },
    downsideReceiptsHaircutPct: { type: "number", minimum: 0, maximum: 100 },
    thinCollectionHistory: { type: "boolean" },
    priorForecastClosing: { type: "array", items: { type: "number" } },
    actualClosing: { type: "array", items: { type: "number" } },
    financing: { type: "object", properties: { liquidityMinimum: { type: "number", minimum: 0 } } },
    gateOwner: { type: "string" },
  },
};

const caseSchema: JsonSchema = { type: "object", required: ["rows", "minClosing", "minWeek", "facilityDrawNeeded"] };
const outputSchema: JsonSchema = {
  type: "object",
  required: ["base", "accuracy", "openingTiedToBank", "limitation", "gate"],
  properties: {
    base: caseSchema,
    downside: caseSchema,
    liquidityMinimum: { type: "number" },
    accuracy: { type: "array", items: { type: "object", required: ["week", "forecast", "actual", "variance"] } },
    openingTiedToBank: { type: "boolean" },
    limitation: { type: "string" },
    gate: { type: "string" },
  },
};

export const cash13WeekManifest: SkillManifest = {
  id: "cash-13-week",
  name: "13-Week Cash Flow",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["portfolio_ops", "fund_admin"],
  supportedEntityTypes: ["asset", "company"],
  requiredInputs: ["company", "openingCash", "weeks"],
  optionalInputs: ["openingTiedToBank", "facilityAvailable", "downsideReceiptsHaircutPct", "thinCollectionHistory", "priorForecastClosing", "actualClosing", "financing", "gateOwner"],
  outputs: ["base", "downside", "accuracy", "gate"],
  artifactTypes: ["model"],
  dataPermissions: ["asset:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 10_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "opening cash tied to bank", "downside haircut never invented"],
  evaluationCriteria: ["weekly roll correct", "liquidity minimum tested", "facility shortfall flagged", "accuracy log computed"],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["covenant-watch", "portfolio-review"],
  prohibitedActions: ["sign_document", "move_capital", "distribute_report", "send_outreach"],
  inputSchema,
  outputSchema,
};

export const cash13Week: SkillDefinition<CashInput, CashOutput> = { manifest: cash13WeekManifest, run };
