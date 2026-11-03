// lib/skills/catalog/final-investment-report.ts
// Final Investment Report (PE department · Exit 08). The post-exit record: realised
// IRR (from DATED cash flows) and MOIC, a returns bridge into EBITDA growth,
// multiple change and deleveraging that sums to the value created, the result
// against the fund's records and the entry thesis claim by claim, and the lessons
// the user records. Attribution is analytical, not causal, and says so. Pure core.

import type { JsonSchema, SkillCore, SkillCoreResult, SkillDefinition, SkillManifest, SkillSource } from "@/lib/skills/types";
import { flowStats, type DatedFlow } from "@/lib/pe/xirr";
import { testHurdle, type HurdleVerdict, type ReturnsHurdles } from "@/lib/pe/returns-hurdles";

export interface Snapshot {
  ebitda: number;
  /** EV / EBITDA. */
  multiple: number;
  netDebt: number;
}

export interface ThesisClaimIn {
  claim: string;
  /** What actually happened. */
  outcome?: string;
  evidence?: string;
}

export interface FinalReportInput {
  company: string;
  cashFlows: DatedFlow[];
  entry: Snapshot;
  exit: Snapshot;
  /** The fund's own recorded returns, to tie the calculation to. */
  fundRecord?: { moic?: number; irr?: number };
  underwriting?: { irr?: number; moic?: number };
  thesis?: ThesisClaimIn[];
  lessons?: string[];
  hurdles?: ReturnsHurdles;
  gateOwner?: string;
}

export interface FinalReportOutput {
  realised: { invested: number; returned: number; moic: number | null; irr: number | null; firstDate: string | null; lastDate: string | null };
  hurdleVerdict: HurdleVerdict;
  bridge: {
    entryEquity: number;
    exitEquity: number;
    valueCreated: number;
    ebitdaGrowth: number;
    multipleChange: number;
    deleveraging: number;
    sum: number;
    ties: boolean;
    sharePct: { ebitdaGrowth: number | null; multipleChange: number | null; deleveraging: number | null };
  };
  fundTie: { moicTies: boolean | null; irrTies: boolean | null; moicDiff: number | null; irrDiff: number | null };
  versusUnderwriting: { irrDelta: number | null; moicDelta: number | null } | null;
  thesisReview: Array<{ claim: string; outcome: string | null; evidence: string | null; reviewable: boolean }>;
  lessons: string[];
  limitation: string;
  gate: string;
}

const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;

const run: SkillCore<FinalReportInput, FinalReportOutput> = (input): SkillCoreResult<FinalReportOutput> => {
  const sources: SkillSource[] = [];
  const missingData: string[] = [];

  const st = flowStats(input.cashFlows);
  if (st.badDates) missingData.push(`${st.badDates} cash flow(s) had an unreadable date and were excluded`);
  if (st.irr === null) missingData.push("IRR not computable from the dated cash flows (need capital in, proceeds out, valid dates)");
  sources.push({ label: "Realised MOIC", kind: "calculation", value: st.moic ?? "n/a", ref: "proceeds ÷ capital invested" });
  if (st.irr !== null) sources.push({ label: "Realised IRR", kind: "calculation", value: st.irr, ref: "dated cash flows, act/365" });

  // Bridge: ΔEV = ΔEBITDA × entry multiple + Δmultiple × exit EBITDA, so the three effects sum exactly.
  const { entry, exit } = input;
  const entryEV = entry.ebitda * entry.multiple;
  const exitEV = exit.ebitda * exit.multiple;
  const entryEquity = r2(entryEV - entry.netDebt);
  const exitEquity = r2(exitEV - exit.netDebt);
  const valueCreated = r2(exitEquity - entryEquity);
  const ebitdaGrowth = r2((exit.ebitda - entry.ebitda) * entry.multiple);
  const multipleChange = r2((exit.multiple - entry.multiple) * exit.ebitda);
  const deleveraging = r2(entry.netDebt - exit.netDebt);
  const sum = r2(ebitdaGrowth + multipleChange + deleveraging);
  const ties = Math.abs(sum - valueCreated) < 0.05;
  const share = (x: number) => (Math.abs(valueCreated) > 0.005 ? r2((x / valueCreated) * 100) : null);
  sources.push({ label: "Value created (100% equity basis)", kind: "calculation", value: valueCreated, ref: "exit equity − entry equity" });

  const hurdleVerdict = testHurdle(input.hurdles?.base, st.irr, st.moic);
  if (!input.hurdles) missingData.push("Return hurdles not supplied — the realised result is not tested against a hurdle");

  // Tie to the fund's own records.
  const moicDiff = input.fundRecord?.moic !== undefined && st.moic !== null ? r4(st.moic - input.fundRecord.moic) : null;
  const irrDiff = input.fundRecord?.irr !== undefined && st.irr !== null ? r4(st.irr - input.fundRecord.irr) : null;
  const fundTie = { moicTies: moicDiff === null ? null : Math.abs(moicDiff) <= 0.01, irrTies: irrDiff === null ? null : Math.abs(irrDiff) <= 0.005, moicDiff, irrDiff };
  if (!input.fundRecord) missingData.push("Fund records not supplied — returns are not tied to the fund's books");
  else if (fundTie.moicTies === false || fundTie.irrTies === false) missingData.push("Returns do not tie to the fund's records — reconcile before this report is used");

  const versusUnderwriting = input.underwriting
    ? { irrDelta: input.underwriting.irr !== undefined && st.irr !== null ? r4(st.irr - input.underwriting.irr) : null, moicDelta: input.underwriting.moic !== undefined && st.moic !== null ? r4(st.moic - input.underwriting.moic) : null }
    : null;

  const thesisReview = (input.thesis ?? []).map((t) => ({ claim: t.claim, outcome: t.outcome?.trim() || null, evidence: t.evidence?.trim() || null, reviewable: !!t.outcome?.trim() }));
  for (const t of thesisReview) if (!t.reviewable) missingData.push(`Entry thesis claim has no outcome recorded: "${t.claim}"`);
  if (!input.thesis?.length) missingData.push("Entry thesis claims not supplied");
  const lessons = input.lessons ?? [];
  if (!lessons.length) missingData.push("No lessons recorded for the playbook");

  const gateOwner = input.gateOwner?.trim() || "The IC";
  const gate = `${gateOwner} reviews the report.`;
  const limitation = "Attribution is analytical, not causal: it splits arithmetic value change, not management's decisions. The bridge is on a 100% equity basis; realised fund returns can differ through fees, dividends, recaps and ownership.";
  const narrative =
    `Final investment report, ${input.company}: realised ${st.moic ?? "n/a"}x / ${st.irr !== null ? `${r2(st.irr * 100)}%` : "IRR n/a"}` +
    `${hurdleVerdict === "not-tested" ? "" : ` (${hurdleVerdict} the hurdle)`}. ` +
    `Value created ${valueCreated}: EBITDA growth ${ebitdaGrowth}, multiple ${multipleChange}, deleveraging ${deleveraging}. ${gate}`;

  const have = [st.irr !== null, !!input.fundRecord, !!input.thesis?.length, lessons.length > 0, !!input.hurdles].filter(Boolean).length;
  const completeness = Math.round((have / 5) * 100) / 100;
  return {
    structured: {
      realised: { invested: r2(st.invested), returned: r2(st.returned), moic: st.moic, irr: st.irr, firstDate: st.firstDate, lastDate: st.lastDate },
      hurdleVerdict,
      bridge: { entryEquity, exitEquity, valueCreated, ebitdaGrowth, multipleChange, deleveraging, sum, ties, sharePct: { ebitdaGrowth: share(ebitdaGrowth), multipleChange: share(multipleChange), deleveraging: share(deleveraging) } },
      fundTie,
      versusUnderwriting,
      thesisReview,
      lessons,
      limitation,
      gate,
    },
    narrative,
    sources,
    confidence: Math.max(0.3, Math.min(0.9, 0.35 + completeness * 0.5)),
    completeness,
    missingData,
  };
};

const flow: JsonSchema = { type: "object", required: ["date", "amount"], properties: { date: { type: "string", minLength: 8 }, amount: { type: "number" } } };
const snap: JsonSchema = { type: "object", required: ["ebitda", "multiple", "netDebt"], properties: { ebitda: { type: "number" }, multiple: { type: "number", minimum: 0 }, netDebt: { type: "number" } } };

const inputSchema: JsonSchema = {
  type: "object",
  required: ["company", "cashFlows", "entry", "exit"],
  properties: {
    company: { type: "string", minLength: 1 },
    cashFlows: { type: "array", items: flow },
    entry: snap,
    exit: snap,
    fundRecord: { type: "object", properties: { moic: { type: "number" }, irr: { type: "number" } } },
    underwriting: { type: "object", properties: { moic: { type: "number" }, irr: { type: "number" } } },
    thesis: { type: "array", items: { type: "object", required: ["claim"], properties: { claim: { type: "string", minLength: 1 }, outcome: { type: "string" }, evidence: { type: "string" } } } },
    lessons: { type: "array", items: { type: "string" } },
    hurdles: { type: "object", required: ["base", "holdYears"], properties: { base: { type: "object", properties: { irr: { type: "number" }, moic: { type: "number" } } }, downside: { type: "object" }, holdYears: { type: "number" } } },
    gateOwner: { type: "string" },
  },
};

const outputSchema: JsonSchema = {
  type: "object",
  required: ["realised", "hurdleVerdict", "bridge", "fundTie", "thesisReview", "lessons", "limitation", "gate"],
  properties: {
    realised: { type: "object", required: ["invested", "returned"] },
    hurdleVerdict: { type: "string", enum: ["clears", "misses", "not-tested"] },
    bridge: { type: "object", required: ["valueCreated", "ebitdaGrowth", "multipleChange", "deleveraging", "sum", "ties"] },
    fundTie: { type: "object" },
    versusUnderwriting: { type: "object" },
    thesisReview: { type: "array", items: { type: "object", required: ["claim", "reviewable"] } },
    lessons: { type: "array", items: { type: "string" } },
    limitation: { type: "string" },
    gate: { type: "string" },
  },
};

export const finalInvestmentReportManifest: SkillManifest = {
  id: "final-investment-report",
  name: "Final Investment Report",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "execute",
  applicableExecutives: ["investment_committee", "analyst"],
  supportedEntityTypes: ["asset", "company"],
  requiredInputs: ["company", "cashFlows", "entry", "exit"],
  optionalInputs: ["fundRecord", "underwriting", "thesis", "lessons", "hurdles", "gateOwner"],
  outputs: ["realised", "hurdleVerdict", "bridge", "fundTie", "thesisReview", "lessons", "gate"],
  artifactTypes: ["summary"],
  dataPermissions: ["asset:read", "valuation:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 10_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: ["input matches input.schema.json", "output matches output.schema.json", "IRR from dated cash flows", "attribution sums to value created", "returns tied to fund records"],
  evaluationCriteria: ["bridge sums exactly", "IRR uses dates", "untied returns flagged", "thesis claim without outcome flagged"],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["lp-update"],
  prohibitedActions: ["send_outreach", "distribute_report", "sign_document", "move_capital"],
  inputSchema,
  outputSchema,
};

export const finalInvestmentReport: SkillDefinition<FinalReportInput, FinalReportOutput> = { manifest: finalInvestmentReportManifest, run };
