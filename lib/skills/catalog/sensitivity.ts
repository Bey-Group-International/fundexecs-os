// lib/skills/catalog/sensitivity.ts
// Sensitivity & Break-evens (PE department · Valuation 06). Flexes the assumptions
// the deal team names over the SAME LBO core as the `lbo` and `bid-range` skills
// (no second model to drift), and reports:
//   * one-way flexes — returns at each value the team supplies, per driver;
//   * two-way tables — returns across a pair of drivers;
//   * named cases — only the assumptions the team lists, nothing invented;
//   * break-evens — the entry multiple, exit multiple and growth at which returns
//     just meet the hurdle, holding everything else at the base.
// Ranges and cases are the deal team's input: the skill never picks a "reasonable"
// range for them. Verdicts are against the org's hurdles (standing default labelled).
// Pure core. Price is enterprise value.

import type {
  JsonSchema,
  SkillContext,
  SkillCore,
  SkillCoreResult,
  SkillDefinition,
  SkillManifest,
  SkillSource,
} from "@/lib/skills/types";
import { lbo } from "./lbo";
import {
  DEFAULT_RETURNS,
  testHurdle,
  type Hurdle,
  type HurdleVerdict,
  type ReturnsHurdles,
} from "@/lib/pe/returns-hurdles";

export const DRIVERS = [
  "entryMultiple",
  "exitMultiple",
  "ebitdaGrowthRate",
  "leverageMultiple",
  "holdYears",
  "transactionFeesPct",
] as const;
export type DriverName = (typeof DRIVERS)[number];

const LABELS: Record<DriverName, string> = {
  entryMultiple: "Entry multiple",
  exitMultiple: "Exit multiple",
  ebitdaGrowthRate: "EBITDA growth",
  leverageMultiple: "Leverage",
  holdYears: "Hold years",
  transactionFeesPct: "Transaction fees",
};

export type Overrides = Partial<Record<DriverName, number>>;

export interface DriverRange {
  driver: DriverName;
  values: number[];
}

export interface NamedCase {
  name: string;
  kind?: "base" | "downside" | "upside";
  overrides: Overrides;
}

export interface SensitivityInput {
  dealName?: string;
  entryEbitda: number;
  entryMultiple: number;
  holdYears: number;
  leverageMultiple?: number;
  debtAmount?: number;
  /** Fixed exit multiple. Absent = exit at entry multiple (labelled convention). */
  exitMultiple?: number;
  ebitdaGrowthRate?: number;
  annualDebtPaydown?: number;
  transactionFeesPct?: number;
  hurdles?: ReturnsHurdles;
  drivers?: DriverRange[];
  twoWay?: Array<{ row: DriverName; col: DriverName }>;
  cases?: NamedCase[];
  gateOwner?: string;
}

export interface Point {
  irr: number | null;
  moic: number | null;
  verdict: HurdleVerdict;
}

export interface OneWay {
  driver: DriverName;
  label: string;
  baseValue: number | null;
  baseIsAssumed: boolean;
  points: Array<{ value: number } & Point>;
}

export interface TwoWayTable {
  rowDriver: DriverName;
  colDriver: DriverName;
  rowValues: number[];
  colValues: number[];
  cells: Point[][];
  defaultPairing: boolean;
}

export interface CaseResult extends Point {
  name: string;
  kind: "base" | "downside" | "upside";
  overrides: Overrides;
  testedAgainst: "base hurdle" | "downside hurdle" | "none";
}

export interface BreakEven {
  driver: "entryMultiple" | "exitMultiple" | "ebitdaGrowthRate";
  label: string;
  direction: "maximum" | "minimum";
  baseValue: number;
  breakEvenValue: number | null;
  /** Signed room in the favourable direction: positive = the base sits on the safe side. */
  headroom: number | null;
  status:
    | "base-clears"
    | "base-misses"
    | "not-binding"
    | "not-reachable"
    | "not-tested";
  note: string;
}

export interface SensitivityOutput {
  base: {
    entryEV: number | null;
    entryEquity: number | null;
    debt: number | null;
  } & Point;
  oneWay: OneWay[];
  twoWay: TwoWayTable[];
  cases: CaseResult[];
  combinedDownsideSupplied: boolean;
  breakEvens: BreakEven[];
  hurdlesAreDefault: boolean;
  assumptions: string[];
  warnings: string[];
  limitation: string;
  note: string;
  gate: string;
}

const MAX_DRIVERS = 6;
const MAX_VALUES = 7;
const MAX_TABLES = 3;
const MAX_CASES = 8;
const MAX_MULT = 60;
const MIN_MULT = 0.5;
const GROWTH_LO = -0.9;
const GROWTH_HI = 2;
const r2 = (n: number) => Math.round(n * 100) / 100;
const r4 = (n: number) => Math.round(n * 10000) / 10000;
const r1 = (n: number) => Math.round(n * 10) / 10;

type Eval = (o: Overrides) => {
  irr: number | null;
  moic: number | null;
  entryEV: number | null;
  entryEquity: number | null;
  debt: number | null;
};

function makeEval(input: SensitivityInput, ctx: SkillContext): Eval {
  return (o) => {
    const out = lbo.run(
      {
        entryEbitda: input.entryEbitda,
        entryMultiple: o.entryMultiple ?? input.entryMultiple,
        // A leverage override must win over a fixed debt amount, which the core would otherwise prefer.
        leverageMultiple: o.leverageMultiple ?? input.leverageMultiple,
        debtAmount:
          o.leverageMultiple !== undefined ? undefined : input.debtAmount,
        holdYears: o.holdYears ?? input.holdYears,
        exitMultiple: o.exitMultiple ?? input.exitMultiple,
        ebitdaGrowthRate: o.ebitdaGrowthRate ?? input.ebitdaGrowthRate,
        annualDebtPaydown: input.annualDebtPaydown,
        transactionFeesPct: o.transactionFeesPct ?? input.transactionFeesPct,
      },
      ctx,
    ).structured;
    return {
      irr: out.irr,
      moic: out.moic,
      entryEV: out.entryEV,
      entryEquity: out.entryEquity,
      debt: out.debt,
    };
  };
}

const isNum = (v: unknown): v is number =>
  typeof v === "number" && Number.isFinite(v);

function cleanOverrides(raw: Overrides | undefined): Overrides {
  const out: Overrides = {};
  if (!raw || typeof raw !== "object") return out;
  for (const d of DRIVERS) if (isNum(raw[d])) out[d] = raw[d];
  return out;
}

/** Bisect the value where `clears` flips. `higherIsBetter`: clearing gets easier as the value rises. */
function solveEdge(
  clears: (v: number) => boolean,
  lo: number,
  hi: number,
  higherIsBetter: boolean,
): { value: number | null; status: "found" | "not-binding" | "not-reachable" } {
  const easy = higherIsBetter ? hi : lo;
  const hard = higherIsBetter ? lo : hi;
  if (!clears(easy)) return { value: null, status: "not-reachable" };
  if (clears(hard)) return { value: null, status: "not-binding" };
  let good = easy;
  let bad = hard;
  for (let i = 0; i < 50; i++) {
    const mid = (good + bad) / 2;
    if (clears(mid)) good = mid;
    else bad = mid;
  }
  return { value: good, status: "found" };
}

const run: SkillCore<SensitivityInput, SensitivityOutput> = (
  input,
  ctx,
): SkillCoreResult<SensitivityOutput> => {
  const sources: SkillSource[] = [];
  const assumptions: string[] = [];
  const warnings: string[] = [];
  const missingData: string[] = [];
  const hurdlesAreDefault = !input.hurdles;
  const hurdles = input.hurdles ?? DEFAULT_RETURNS;
  const evalAt = makeEval(input, ctx);

  sources.push({
    label: "Entry LTM EBITDA",
    kind: "fact",
    value: input.entryEbitda,
  });
  sources.push({
    label: "Entry multiple",
    kind: "fact",
    value: input.entryMultiple,
  });
  sources.push({
    label: "Hold period",
    kind: "fact",
    value: `${input.holdYears} years`,
  });
  if (hurdlesAreDefault) {
    sources.push({
      label: "Return hurdles",
      kind: "assumption",
      value: "standing default: gross IRR 20%, MOIC 2.5x",
      ref: "run on default settings — set root-returns",
    });
    assumptions.push(
      "Run on default return hurdles (gross IRR 20%, MOIC 2.5x); the firm's own hurdles are not set.",
    );
  }
  if (input.exitMultiple === undefined)
    assumptions.push(
      "Exit multiple tracks the entry multiple (no expansion) wherever the exit multiple is not itself flexed.",
    );
  if (input.ebitdaGrowthRate === undefined)
    assumptions.push(
      "EBITDA growth 0% (flat) where growth is not supplied or flexed.",
    );
  if (input.annualDebtPaydown === undefined)
    assumptions.push("No debt paydown over the hold where none is supplied.");
  if (input.transactionFeesPct === undefined)
    assumptions.push("Transaction fees 0% where none are supplied.");
  if (input.leverageMultiple === undefined && input.debtAmount === undefined) {
    assumptions.push(
      "No debt supplied: the base is modelled all-equity, which understates returns.",
    );
    missingData.push("Leverage / debt — the base is modelled all-equity");
  }
  if (input.holdYears !== hurdles.holdYears) {
    warnings.push(
      `The base hold (${input.holdYears} years) differs from the underwriting hold in the return hurdles (${hurdles.holdYears} years).`,
    );
  }

  // The hurdle is passed explicitly: an absent downside hurdle must read "not-tested", never fall back to the base.
  const point = (
    r: { irr: number | null; moic: number | null },
    hurdle: Hurdle | undefined = hurdles.base,
  ): Point => ({
    irr: r.irr,
    moic: r.moic,
    verdict: testHurdle(hurdle, r.irr, r.moic),
  });

  // ---- base ----
  const b = evalAt({});
  const base: SensitivityOutput["base"] = {
    entryEV: b.entryEV,
    entryEquity: b.entryEquity,
    debt: b.debt,
    ...point(b),
  };
  sources.push({
    label: "Base IRR",
    kind: "calculation",
    value: b.irr ?? "n/a",
    ref: "lbo core",
  });
  sources.push({
    label: "Base MOIC",
    kind: "calculation",
    value: b.moic ?? "n/a",
    ref: "lbo core",
  });

  // ---- drivers (the team's ranges) ----
  const seen = new Set<DriverName>();
  const driverList: Array<{ driver: DriverName; values: number[] }> = [];
  for (const d of input.drivers ?? []) {
    if (!d || !(DRIVERS as readonly string[]).includes(d.driver)) {
      missingData.push(
        `Driver "${String((d as { driver?: unknown })?.driver)}" is not one this skill can flex`,
      );
      continue;
    }
    if (seen.has(d.driver)) {
      warnings.push(
        `${LABELS[d.driver]} was listed twice; the first range was used.`,
      );
      continue;
    }
    const vals = [...new Set((d.values ?? []).filter(isNum))].slice(
      0,
      MAX_VALUES,
    );
    if (vals.length === 0) {
      missingData.push(`${LABELS[d.driver]} has no values to test`);
      continue;
    }
    seen.add(d.driver);
    driverList.push({ driver: d.driver, values: vals });
  }
  if (driverList.length > MAX_DRIVERS) {
    warnings.push(
      `${driverList.length} drivers supplied; only the first ${MAX_DRIVERS} were flexed.`,
    );
    driverList.length = MAX_DRIVERS;
  }
  if (driverList.length === 0)
    missingData.push(
      "No drivers to flex — supply the assumptions to test and the values for each; ranges are the deal team's call",
    );
  else if (driverList.length < 4)
    warnings.push(
      `Only ${driverList.length} driver${driverList.length === 1 ? "" : "s"} flexed; a sensitivity on fewer than four can miss the one that decides the deal.`,
    );
  if (
    driverList.some((d) => d.driver === "leverageMultiple") &&
    input.debtAmount !== undefined
  ) {
    warnings.push(
      "A fixed debt amount was supplied; the leverage flex replaces it with leverage × EBITDA for those points.",
    );
  }

  const baseValueOf = (
    d: DriverName,
  ): { value: number | null; assumed: boolean } => {
    switch (d) {
      case "entryMultiple":
        return { value: input.entryMultiple, assumed: false };
      case "holdYears":
        return { value: input.holdYears, assumed: false };
      case "exitMultiple":
        return input.exitMultiple !== undefined
          ? { value: input.exitMultiple, assumed: false }
          : { value: input.entryMultiple, assumed: true };
      case "ebitdaGrowthRate":
        return input.ebitdaGrowthRate !== undefined
          ? { value: input.ebitdaGrowthRate, assumed: false }
          : { value: 0, assumed: true };
      case "transactionFeesPct":
        return input.transactionFeesPct !== undefined
          ? { value: input.transactionFeesPct, assumed: false }
          : { value: 0, assumed: true };
      case "leverageMultiple":
        return input.leverageMultiple !== undefined
          ? { value: input.leverageMultiple, assumed: false }
          : input.debtAmount !== undefined && input.entryEbitda > 0
            ? {
                value: r2(input.debtAmount / input.entryEbitda),
                assumed: false,
              }
            : { value: null, assumed: false };
    }
  };

  const oneWay: OneWay[] = driverList.map((d) => {
    const bv = baseValueOf(d.driver);
    return {
      driver: d.driver,
      label: LABELS[d.driver],
      baseValue: bv.value,
      baseIsAssumed: bv.assumed,
      points: d.values.map((v) => ({
        value: v,
        ...point(evalAt({ [d.driver]: v })),
      })),
    };
  });

  // ---- two-way tables ----
  const tables: TwoWayTable[] = [];
  const byName = new Map(driverList.map((d) => [d.driver, d.values]));
  const wanted = (input.twoWay ?? []).slice(0, MAX_TABLES);
  if ((input.twoWay ?? []).length > MAX_TABLES)
    warnings.push(`Only the first ${MAX_TABLES} two-way tables were built.`);
  const build = (row: DriverName, col: DriverName, defaultPairing: boolean) => {
    const rv = byName.get(row);
    const cv = byName.get(col);
    if (row === col || !rv || !cv) {
      missingData.push(
        `Two-way table ${LABELS[row] ?? row} × ${LABELS[col] ?? col}: both must be different drivers with values`,
      );
      return;
    }
    tables.push({
      rowDriver: row,
      colDriver: col,
      rowValues: rv,
      colValues: cv,
      cells: rv.map((r) =>
        cv.map((c) => point(evalAt({ [row]: r, [col]: c }))),
      ),
      defaultPairing,
    });
  };
  for (const t of wanted) build(t.row, t.col, false);
  if (wanted.length === 0 && driverList.length >= 2) {
    build(driverList[0].driver, driverList[1].driver, true);
    warnings.push(
      `No two-way table was requested; the first two drivers (${LABELS[driverList[0].driver]} × ${LABELS[driverList[1].driver]}) were paired by default.`,
    );
  }

  // ---- named cases ----
  const cases: CaseResult[] = [];
  for (const c of (input.cases ?? []).slice(0, MAX_CASES)) {
    const ov = cleanOverrides(c?.overrides);
    const kind = c?.kind ?? "base";
    const r = evalAt(ov);
    const hurdle = kind === "downside" ? hurdles.downside : hurdles.base;
    cases.push({
      name: String(c?.name ?? "Unnamed case"),
      kind,
      overrides: ov,
      ...(hurdle
        ? point(r, hurdle)
        : { irr: r.irr, moic: r.moic, verdict: "not-tested" as HurdleVerdict }),
      testedAgainst: hurdle
        ? kind === "downside"
          ? "downside hurdle"
          : "base hurdle"
        : "none",
    });
  }
  if ((input.cases ?? []).length > MAX_CASES)
    warnings.push(`Only the first ${MAX_CASES} cases were run.`);
  const combinedDownsideSupplied = cases.some(
    (c) => c.kind === "downside" && Object.keys(c.overrides).length >= 2,
  );
  if (cases.length === 0)
    warnings.push(
      "No named cases supplied: the table shows single-variable moves only. Cases are the deal team's call and are not invented.",
    );
  else if (!combinedDownsideSupplied)
    warnings.push(
      "No combined downside supplied (a downside case moving two or more assumptions at once). Single-variable stresses understate how things go wrong together.",
    );
  for (const c of cases) {
    if (c.kind === "downside" && !hurdles.downside)
      warnings.push(
        `Case "${c.name}" is a downside but the firm sets no downside hurdle; it is reported, not tested.`,
      );
  }

  // ---- break-evens ----
  const debtNow =
    input.debtAmount ?? (input.leverageMultiple ?? 0) * input.entryEbitda;
  const entryFloor = Math.max(
    MIN_MULT,
    input.entryEbitda > 0
      ? debtNow / (input.entryEbitda * (1 + (input.transactionFeesPct ?? 0))) +
          0.05
      : MIN_MULT,
  );
  const clearsWith = (o: Overrides) => {
    const r = evalAt(o);
    return testHurdle(hurdles.base, r.irr, r.moic) === "clears";
  };
  const baseClears = clearsWith({});
  const edges: Array<{
    driver: BreakEven["driver"];
    direction: BreakEven["direction"];
    baseValue: number;
    lo: number;
    hi: number;
    higherIsBetter: boolean;
    unit: string;
  }> = [
    {
      driver: "entryMultiple",
      direction: "maximum",
      baseValue: input.entryMultiple,
      lo: entryFloor,
      hi: MAX_MULT,
      higherIsBetter: false,
      unit: "x",
    },
    {
      driver: "exitMultiple",
      direction: "minimum",
      baseValue: baseValueOf("exitMultiple").value as number,
      lo: 0,
      hi: MAX_MULT,
      higherIsBetter: true,
      unit: "x",
    },
    {
      driver: "ebitdaGrowthRate",
      direction: "minimum",
      baseValue: baseValueOf("ebitdaGrowthRate").value as number,
      lo: GROWTH_LO,
      hi: GROWTH_HI,
      higherIsBetter: true,
      unit: "",
    },
  ];
  const breakEvens: BreakEven[] = edges.map((e) => {
    const label = LABELS[e.driver];
    const shape = {
      driver: e.driver,
      label,
      direction: e.direction,
      baseValue: e.baseValue,
    };
    if (b.irr === null && b.moic === null) {
      return {
        ...shape,
        breakEvenValue: null,
        headroom: null,
        status: "not-tested" as const,
        note: "Base returns are not computable (check the equity cheque is positive), so no break-even was solved.",
      };
    }
    // Exit multiple break-even holds the base exit multiple for the entry-price solve only if it was supplied;
    // otherwise the exit tracks entry, so the entry solve moves both — said plainly in the note.
    const s = solveEdge(
      (v) => clearsWith({ [e.driver]: v }),
      e.lo,
      e.hi,
      e.higherIsBetter,
    );
    if (s.status === "not-reachable")
      return {
        ...shape,
        breakEvenValue: null,
        headroom: null,
        status: "not-reachable" as const,
        note: `No ${label.toLowerCase()} within the search range reaches the hurdle with everything else at the base.`,
      };
    if (s.status === "not-binding")
      return {
        ...shape,
        breakEvenValue: null,
        headroom: null,
        status: "not-binding" as const,
        note: `The hurdle is met at every ${label.toLowerCase()} in the search range; it is not the binding assumption.`,
      };
    const be =
      e.driver === "ebitdaGrowthRate"
        ? r4(s.value as number)
        : r2(s.value as number);
    const headroom = e.higherIsBetter
      ? r4(e.baseValue - be)
      : r4(be - e.baseValue);
    const fmt = (v: number) =>
      e.driver === "ebitdaGrowthRate" ? `${r1(v * 100)}%` : `${v}${e.unit}`;
    const extra =
      e.driver === "entryMultiple" && input.exitMultiple === undefined
        ? " The exit multiple tracks entry in this solve (no fixed exit supplied)."
        : "";
    return {
      ...shape,
      breakEvenValue: be,
      headroom,
      status: baseClears ? ("base-clears" as const) : ("base-misses" as const),
      note: `${label} ${e.direction} to meet the hurdle: ${fmt(be)} against a base of ${fmt(e.baseValue)} (${baseClears ? "room" : "short by"} ${fmt(Math.abs(headroom))}).${extra}`,
    };
  });
  for (const be of breakEvens) {
    if (be.breakEvenValue !== null)
      sources.push({
        label: `Break-even ${be.label.toLowerCase()}`,
        kind: "calculation",
        value: be.breakEvenValue,
        ref: "bisection over the lbo core, other assumptions at base",
      });
  }

  const limitation =
    "Each flex holds every other assumption at the base unless a case or table moves it, and break-evens move one assumption at a time. Real downsides move together; the combined cases are only as good as the ones the deal team supplies. Hurdles are tested on gross returns.";
  const gateOwner = input.gateOwner?.trim() || "The IC";
  const gate = `${gateOwner} chooses which case the price rests on. This analysis informs the choice.`;

  const failedCases = cases
    .filter((c) => c.verdict === "misses")
    .map((c) => c.name);
  const missed = breakEvens.filter((x) => x.status === "base-misses");
  const note = [
    b.irr === null
      ? "Base returns are not computable."
      : `Base ${r2((b.irr as number) * 100)}% IRR / ${b.moic}x MOIC: ${base.verdict === "clears" ? "clears" : base.verdict === "misses" ? "MISSES" : "not tested against"} the hurdle${hurdlesAreDefault ? " (run on default hurdles)" : ""}.`,
    ...breakEvens.filter((x) => x.breakEvenValue !== null).map((x) => x.note),
    failedCases.length
      ? `Cases that miss the hurdle: ${failedCases.join(", ")}.`
      : cases.length
        ? "Every supplied case clears or is not tested."
        : "",
    missed.length
      ? "The base already misses the hurdle, so the break-evens show what would have to change."
      : "",
  ]
    .filter(Boolean)
    .join(" ");

  const completeness = r2(
    ((driverList.length >= 4 ? 1 : 0) +
      (cases.length > 0 ? 1 : 0) +
      (combinedDownsideSupplied ? 1 : 0) +
      (hurdlesAreDefault ? 0 : 1) +
      (input.leverageMultiple !== undefined || input.debtAmount !== undefined
        ? 1
        : 0)) /
      5,
  );

  const structured: SensitivityOutput = {
    base,
    oneWay,
    twoWay: tables,
    cases,
    combinedDownsideSupplied,
    breakEvens,
    hurdlesAreDefault,
    assumptions,
    warnings,
    limitation,
    note,
    gate,
  };
  return {
    structured,
    narrative: `${note} ${gate}`,
    sources,
    confidence: Math.max(0.2, Math.min(0.85, 0.3 + completeness * 0.5)),
    completeness,
    missingData,
  };
};

const num: JsonSchema = { type: "number" };
const driverEnum: JsonSchema = { type: "string", enum: [...DRIVERS] };
const hurdle: JsonSchema = {
  type: "object",
  properties: {
    irr: { type: "number", minimum: 0 },
    moic: { type: "number", minimum: 0 },
  },
};
const overridesSchema: JsonSchema = {
  type: "object",
  properties: {
    entryMultiple: { type: "number", minimum: 0 },
    exitMultiple: { type: "number", minimum: 0 },
    ebitdaGrowthRate: num,
    leverageMultiple: { type: "number", minimum: 0 },
    holdYears: { type: "number", minimum: 0 },
    transactionFeesPct: { type: "number", minimum: 0, maximum: 1 },
  },
};

const inputSchema: JsonSchema = {
  type: "object",
  required: ["entryEbitda", "entryMultiple", "holdYears"],
  properties: {
    dealName: { type: "string" },
    entryEbitda: { type: "number", minimum: 0 },
    entryMultiple: { type: "number", minimum: 0 },
    holdYears: { type: "number", minimum: 0 },
    leverageMultiple: { type: "number", minimum: 0 },
    debtAmount: { type: "number", minimum: 0 },
    exitMultiple: { type: "number", minimum: 0 },
    ebitdaGrowthRate: num,
    annualDebtPaydown: { type: "number", minimum: 0 },
    transactionFeesPct: { type: "number", minimum: 0, maximum: 1 },
    hurdles: {
      type: "object",
      required: ["base", "holdYears"],
      properties: {
        base: hurdle,
        downside: hurdle,
        holdYears: { type: "number", minimum: 0 },
      },
    },
    drivers: {
      type: "array",
      items: {
        type: "object",
        required: ["driver", "values"],
        properties: {
          driver: driverEnum,
          values: { type: "array", items: num },
        },
      },
    },
    twoWay: {
      type: "array",
      items: {
        type: "object",
        required: ["row", "col"],
        properties: { row: driverEnum, col: driverEnum },
      },
    },
    cases: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "overrides"],
        properties: {
          name: { type: "string" },
          kind: { type: "string", enum: ["base", "downside", "upside"] },
          overrides: overridesSchema,
        },
      },
    },
    gateOwner: { type: "string" },
  },
};

const verdictEnum: JsonSchema = {
  type: "string",
  enum: ["clears", "misses", "not-tested"],
};

const outputSchema: JsonSchema = {
  type: "object",
  required: [
    "base",
    "oneWay",
    "twoWay",
    "cases",
    "combinedDownsideSupplied",
    "breakEvens",
    "hurdlesAreDefault",
    "assumptions",
    "warnings",
    "limitation",
    "note",
    "gate",
  ],
  properties: {
    base: {
      type: "object",
      required: ["verdict"],
      properties: { verdict: verdictEnum },
    },
    oneWay: {
      type: "array",
      items: {
        type: "object",
        required: ["driver", "label", "baseIsAssumed", "points"],
        properties: {
          driver: driverEnum,
          label: { type: "string" },
          baseIsAssumed: { type: "boolean" },
          points: {
            type: "array",
            items: {
              type: "object",
              required: ["value", "verdict"],
              properties: { value: num, verdict: verdictEnum },
            },
          },
        },
      },
    },
    twoWay: {
      type: "array",
      items: {
        type: "object",
        required: [
          "rowDriver",
          "colDriver",
          "rowValues",
          "colValues",
          "cells",
          "defaultPairing",
        ],
        properties: {
          rowDriver: driverEnum,
          colDriver: driverEnum,
          rowValues: { type: "array", items: num },
          colValues: { type: "array", items: num },
          cells: { type: "array" },
          defaultPairing: { type: "boolean" },
        },
      },
    },
    cases: {
      type: "array",
      items: {
        type: "object",
        required: ["name", "kind", "verdict", "testedAgainst"],
        properties: {
          name: { type: "string" },
          kind: { type: "string", enum: ["base", "downside", "upside"] },
          verdict: verdictEnum,
          testedAgainst: {
            type: "string",
            enum: ["base hurdle", "downside hurdle", "none"],
          },
        },
      },
    },
    combinedDownsideSupplied: { type: "boolean" },
    breakEvens: {
      type: "array",
      items: {
        type: "object",
        required: [
          "driver",
          "label",
          "direction",
          "baseValue",
          "status",
          "note",
        ],
        properties: {
          driver: {
            type: "string",
            enum: ["entryMultiple", "exitMultiple", "ebitdaGrowthRate"],
          },
          label: { type: "string" },
          direction: { type: "string", enum: ["maximum", "minimum"] },
          baseValue: num,
          status: {
            type: "string",
            enum: [
              "base-clears",
              "base-misses",
              "not-binding",
              "not-reachable",
              "not-tested",
            ],
          },
          note: { type: "string" },
        },
      },
    },
    hurdlesAreDefault: { type: "boolean" },
    assumptions: { type: "array", items: { type: "string" } },
    warnings: { type: "array", items: { type: "string" } },
    limitation: { type: "string" },
    note: { type: "string" },
    gate: { type: "string" },
  },
};

export const sensitivityManifest: SkillManifest = {
  id: "sensitivity",
  name: "Sensitivity & Break-evens",
  version: "1.0.0",
  owner: "fundexecs",
  hub: "run",
  applicableExecutives: ["analyst", "investment_committee"],
  supportedEntityTypes: ["deal"],
  requiredInputs: ["entryEbitda", "entryMultiple", "holdYears"],
  optionalInputs: [
    "leverageMultiple",
    "debtAmount",
    "exitMultiple",
    "ebitdaGrowthRate",
    "annualDebtPaydown",
    "transactionFeesPct",
    "hurdles",
    "drivers",
    "twoWay",
    "cases",
    "gateOwner",
  ],
  outputs: [
    "base",
    "oneWay",
    "twoWay",
    "cases",
    "breakEvens",
    "warnings",
    "note",
    "gate",
  ],
  artifactTypes: ["analysis"],
  dataPermissions: ["deal:read", "valuation:read"],
  tools: [],
  approvalTier: 1,
  riskClassification: "moderate",
  executionTimeoutMs: 15_000,
  retryPolicy: { maxAttempts: 1, backoffMs: 0 },
  validationRules: [
    "input matches input.schema.json",
    "output matches output.schema.json",
    "ranges and cases come only from the input",
    "uses the lbo core",
    "break-evens solved against the hurdle",
  ],
  evaluationCriteria: [
    "no range or case invented",
    "missing combined downside flagged",
    "default hurdles labelled",
    "break-even states room or shortfall",
  ],
  providerCapabilities: ["financial_reasoning"],
  allowedDownstreamSkills: ["bid-range", "ic-memo", "returns"],
  prohibitedActions: [
    "send_outreach",
    "distribute_report",
    "sign_document",
    "move_capital",
    "capital_call",
    "submit_term_sheet",
  ],
  inputSchema,
  outputSchema,
};

export const sensitivity: SkillDefinition<SensitivityInput, SensitivityOutput> =
  { manifest: sensitivityManifest, run };
