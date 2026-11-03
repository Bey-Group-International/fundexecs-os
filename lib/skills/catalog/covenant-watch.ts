// lib/skills/catalog/covenant-watch.ts
// Covenant Watch (PE department · Portfolio 06). Calculates each financial
// covenant per period on the credit agreement's OWN definitions, shows headroom
// now and forward, flags headroom below the firm's warning threshold, and lists
// the cure options the agreement gives. Two rules carry the skill:
//   * a covenant must quote its clause — an unquoted covenant is not calculated;
//   * an EBITDA addback counts only when it cites the clause that permits it.
// Pure core. The compliance certificate is signed by people, not by this skill.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";
import { DEFAULT_FINANCING, type FinancingPolicy } from "@/lib/pe/financing-policy";

export type CovenantMetric = "netLeverage" | "interestCover" | "custom";

export interface CovenantIn {
  id: string;
  name: string;
  /** Credit-agreement clause and wording the calculation rests on. REQUIRED to calculate. */
  clause: string;
  metric: CovenantMetric;
  /** "max": ratio must stay at or below. "min": at or above. */
  kind: "max" | "min";
  threshold: number;
  /** custom only: keys into a period's `extra` (or "covenantEbitda"). */
  numeratorKey?: string;
  denominatorKey?: string;
}

export interface AddbackIn {
  label: string;
  amount: number;
  /** Clause that PERMITS this addback. Absent = not permitted = excluded. */
  clause?: string;
}

export interface PeriodIn {
  label: string;
  forecast?: boolean;
  ebitda: number;
  addbacks?: AddbackIn[];
  netDebt?: number;
  interest?: number;
  extra?: Record<string, number>;
}

export interface CovenantWatchInput {
  company: string;
  covenants: CovenantIn[];
  periods: PeriodIn[];
  /** Cure options QUOTED from the agreement (equity cure etc.). */
  cureOptions?: string[];
  financing?: FinancingPolicy;
  gateOwner?: string;
}

export type CovenantStatus = "ok" | "warning" | "breach" | "not-calculated";

export interface CovenantPeriodResult {
  period: string;
  forecast: boolean;
  covenantEbitda: number;
  ratio: number | null;
  /** Percent of the threshold still available (negative = breach). For a max test this is also how far EBITDA can fall. */
  headroomPct: number | null;
  status: CovenantStatus;
}

export interface CovenantResult {
  id: string;
  name: string;
  clause: string;
  kind: "max" | "min";
  threshold: number;
  periods: CovenantPeriodResult[];
  tightest: { period: string; headroomPct: number } | null;
  escalate: boolean;
}

export interface CovenantWatchOutput {
  covenants: CovenantResult[];
  excludedAddbacks: Array<{ period: string; label: string; amount: number; reason: string }>;
  warnThresholdPct: number;
  warnThresholdIsDefault: boolean;
  cureOptions: string[];
  gate: string;
  limitation: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;

const run: SkillCore<CovenantWatchInput, CovenantWatchOutput> = (input): SkillCoreResult<CovenantWatchOutput> => {
  const sources: SkillSource[] = [];
  const missingData: string[] = [];
  const policy = input.financing ?? DEFAULT_FINANCING;
  const warnIsDefault = !input.financing;
  if (warnIsDefault) sources.push({ label: "Warning threshold", kind: "assumption", value: `${policy.covenantWarnHeadroomPct}% headroom (standing default)`, ref: "run on default settings — set root-financing" });

  // Covenant EBITDA per period: reported EBITDA + PERMITTED addbacks only.
  const excludedAddbacks: CovenantWatchOutput["excludedAddbacks"] = [];
  const ebitdaBy = new Map<string, number>();
  for (const p of input.periods) {
    let e = p.ebitda;
    for (const a of p.addbacks ?? []) {
      if (a.clause?.trim()) e += a.amount;
      else excludedAddbacks.push({ period: p.label, label: a.label, amount: a.amount, reason: "No clause cited that permits this addback — excluded." });
    }
    ebitdaBy.set(p.label, r2(e));
  }

  const covenants: CovenantResult[] = input.covenants.map((c) => {
    const quoted = !!c.clause?.trim();
    if (!quoted) missingData.push(`Covenant "${c.name}" quotes no agreement clause — not calculated`);
    const periods: CovenantPeriodResult[] = input.periods.map((p) => {
      const covenantEbitda = ebitdaBy.get(p.label) ?? p.ebitda;
      const base: CovenantPeriodResult = { period: p.label, forecast: !!p.forecast, covenantEbitda, ratio: null, headroomPct: null, status: "not-calculated" };
      if (!quoted) return base;

      let num: number | undefined;
      let den: number | undefined;
      if (c.metric === "netLeverage") {
        num = p.netDebt;
        den = covenantEbitda;
      } else if (c.metric === "interestCover") {
        num = covenantEbitda;
        den = p.interest;
      } else {
        const pick = (k?: string) => (k === "covenantEbitda" ? covenantEbitda : k ? p.extra?.[k] : undefined);
        num = pick(c.numeratorKey);
        den = pick(c.denominatorKey);
      }
      if (typeof num !== "number" || typeof den !== "number" || den === 0) {
        missingData.push(`${c.name} ${p.label}: inputs missing for the calculation`);
        return base;
      }
      const ratio = r2(num / den);
      const headroomPct = c.threshold > 0 ? r2((c.kind === "max" ? (c.threshold - ratio) / c.threshold : (ratio - c.threshold) / c.threshold) * 100) : null;
      if (headroomPct === null) return { ...base, ratio };
      const status: CovenantStatus = headroomPct < 0 ? "breach" : headroomPct < policy.covenantWarnHeadroomPct ? "warning" : "ok";
      return { ...base, ratio, headroomPct, status };
    });

    const calc = periods.filter((x) => x.headroomPct !== null);
    const tight = calc.length ? calc.reduce((a, b) => ((b.headroomPct as number) < (a.headroomPct as number) ? b : a)) : null;
    const tightest = tight ? { period: tight.period, headroomPct: tight.headroomPct as number } : null;
    const escalate = !!tightest && policy.escalateBelowPct !== undefined && tightest.headroomPct < policy.escalateBelowPct;
    if (tightest) sources.push({ label: `${c.name} tightest headroom (${tightest.period})`, kind: "calculation", value: `${tightest.headroomPct}%`, ref: c.clause });
    return { id: c.id, name: c.name, clause: c.clause, kind: c.kind, threshold: c.threshold, periods, tightest, escalate };
  });

  const cureOptions = input.cureOptions ?? [];
  if (cureOptions.length === 0) missingData.push("Cure options — read the agreement; none were supplied");

  const gateOwner = input.gateOwner?.trim() || "The portfolio CFO and the fund's finance lead";
  const gate = `${gateOwner} sign the compliance certificate.`;
  const limitation = "Covenant definitions are legal text. A misread addback can flip a pass to a breach: check every figure against the compliance certificate.";

  const breaches = covenants.flatMap((c) => c.periods.filter((p) => p.status === "breach").map((p) => `${c.name} ${p.period}`));
  const warnings = covenants.flatMap((c) => c.periods.filter((p) => p.status === "warning").map((p) => `${c.name} ${p.period}`));
  const narrative =
    `Covenant watch, ${input.company}: ${breaches.length ? `BREACH — ${breaches.join(", ")}. ` : "no breach in the periods tested. "}` +
    `${warnings.length ? `Warning (headroom under ${policy.covenantWarnHeadroomPct}%): ${warnings.join(", ")}. ` : ""}` +
    `${excludedAddbacks.length ? `${excludedAddbacks.length} addback(s) excluded for citing no permitting clause. ` : ""}${gate}`;

  const total = covenants.length * input.periods.length;
  const calculated = covenants.reduce((s, c) => s + c.periods.filter((p) => p.status !== "not-calculated").length, 0);
  const completeness = total ? Math.round((calculated / total) * 100) / 100 : 0;
  return {
    structured: { covenants, excludedAddbacks, warnThresholdPct: policy.covenantWarnHeadroomPct, warnThresholdIsDefault: warnIsDefault, cureOptions, gate, limitation },
    narrative,
    sources,
    confidence: Math.max(0.25, Math.min(0.85, 0.3 + completeness * 0.5)),
    completeness,
    missingData,
  };
};

const policySchema: JsonSchema = { type: "object", properties: { covenantWarnHeadroomPct: { type: "number", minimum: 0, maximum: 100 }, escalateBelowPct: { type: "number" }, escalateTo: { type: "string" } } };

const inputSchema: JsonSchema = {
  type: "object",
  required: ["company", "covenants", "periods"],
  properties: {
    company: { type: "string", minLength: 1 },
    covenants: {
      type: "array",
      items: {
        type: "object",
        required: ["id", "name", "clause", "metric", "kind", "threshold"],
        properties: {
          id: { type: "string", minLength: 1 },
          name: { type: "string", minLength: 1 },
          clause: { type: "string" },
          metric: { type: "string", enum: ["netLeverage", "interestCover", "custom"] },
          kind: { type: "string", enum: ["max", "min"] },
          threshold: { type: "number" },
          numeratorKey: { type: "string" },
          denominatorKey: { type: "string" },
        },
      },
    },
    periods: {
      type: "array",
      items: {
        type: "object",
        required: ["label", "ebitda"],
        properties: {
          label: { type: "string", minLength: 1 },
          forecast: { type: "boolean" },
          ebitda: { type: "number" },
          addbacks: { type: "array", items: { type: "object", required: ["label", "amount"], properties: { label: { type: "string" }, amount: { type: "number" }, clause: { type: "string" } } } },
          netDebt: { type: "number" },
          interest: { type: "number" },
          extra: { type: "object" },
        },
      },
    },
    cureOptions: { type: "array", items: { type: "string" } },
    financing: policySchema,
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["covenants", "excludedAddbacks", "warnThresholdPct", "warnThresholdIsDefault", "cureOptions", "gate", "limitation"],
  properties: {
    covenants: { type: "array", items: { type: "object", required: ["id", "name", "clause", "periods"] } },
    excludedAddbacks: { type: "array", items: { type: "object", required: ["period", "label", "amount", "reason"] } },
    warnThresholdPct: { type: "number" },
    warnThresholdIsDefault: { type: "boolean" },
    cureOptions: { type: "array", items: { type: "string" } },
    gate: { type: "string" },
    limitation: { type: "string" },
  },
};

export const covenantWatchManifest: SkillManifest = {
  id: "covenant-watch",
  name: "Covenant Watch",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["portfolio_ops", "fund_admin"],
  supportedEntityTypes: ["asset", "company"],
  requiredInputs: ["company", "covenants", "periods"],
  optionalInputs: ["cureOptions", "financing", "gateOwner"],
  outputs: ["covenants", "excludedAddbacks", "warnThresholdPct", "cureOptions", "gate"],
  artifactTypes: ["risk_report"],
  dataPermissions: ["asset:read", "document:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 10_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "covenant quotes its clause", "addback must cite a permitting clause"],
  evaluationCriteria: ["unquoted covenant not calculated", "unpermitted addback excluded", "headroom sign and warning threshold correct", "forecast periods flagged"],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["portfolio-review", "cash-13-week"],
  prohibitedActions: ["sign_document", "move_capital", "distribute_report", "send_outreach"],
  inputSchema,
  outputSchema,
};

export const covenantWatch: SkillDefinition<CovenantWatchInput, CovenantWatchOutput> = { manifest: covenantWatchManifest, run };
