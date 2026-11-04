// lib/pe/root-file-templates.ts
// Starter structures for the typed PE root files. Deliberately carry NO invented
// numbers: thresholds are left out (or null), so a starter saved as-is is either
// rejected (returns / financing / kpi) or saved as a DRAFT mandate with
// "no threshold" blockers that stop it being approved. The firm supplies the numbers.

import { GATE_KEYS } from "./gates";
import { DEFAULT_MEMO_TITLES, MEMO_SECTION_KEYS } from "./memo-structure";
import type { RootFileKey } from "./root-files";

export interface RootFileMeta {
  key: RootFileKey;
  title: string;
  blurb: string;
  starter: string;
}

const j = (v: unknown) => JSON.stringify(v, null, 2);

export const ROOT_FILE_META: RootFileMeta[] = [
  {
    key: "mandate",
    title: "Investment mandate",
    blurb: "Hard limits (LPA / side letters), scored preferences and kill facts, each with a number. Read by mandate-screen, target-screen and first-look. Results are labelled default-screened until a partner approves it.",
    starter: j({
      hardLimits: [
        { id: "geography", label: "Geography", metric: "geography", allow: [], source: "LPA clause" },
        { id: "control", label: "Control", metric: "ownershipPct", band: {}, source: "LPA clause" },
      ],
      preferences: [{ id: "ebitda", label: "EBITDA", metric: "ebitda", strong: {}, acceptable: {}, weight: 1 }],
      killFacts: [{ id: "concentration", label: "Single customer above a set share", metric: "topCustomerPct" }],
    }),
  },
  {
    key: "returns",
    title: "Return hurdles",
    blurb: "Base and downside hurdles and the underwriting hold period. IRR is a decimal (0.2 = 20%). Read by bid-range, sensitivity, exit-routes and final-investment-report.",
    starter: j({ base: { irr: null, moic: null }, downside: { irr: null, moic: null }, holdYears: null }),
  },
  {
    key: "financing",
    title: "Financing limits",
    blurb: "Leverage limits, covenant warning threshold (percent), liquidity minimum, call protection the firm resists. Read by covenant-watch, cash-13-week and financing-terms.",
    starter: j({ maxTotalLeverage: null, maxSeniorLeverage: null, minInterestCoverDownside: null, minEquityPct: null, covenantWarnHeadroomPct: null, escalateBelowPct: null, escalateTo: "", liquidityMinimum: null, maxCallProtectionMonths: null }),
  },
  {
    key: "kpi",
    title: "KPI materiality",
    blurb: "Flag a variance at or above a percent of budget, and above an absolute amount if you set one. Read by kpi-variance and operational-dd.",
    starter: j({ materialityPct: null, materialityAbs: null, trendPeriods: null }),
  },
  {
    key: "firm",
    title: "Firm and gate owners",
    blurb: "Who owns each human gate. Every PE skill ends by naming a gate owner; with a name here it names that person or committee instead of a generic role. Read by all 22 PE skills.",
    starter: j({ firmName: "", gateOwners: Object.fromEntries(GATE_KEYS.map((k) => [k, ""])) }),
  },
  {
    key: "evidence",
    title: "Evidence grades",
    blurb: "Which evidence grades may support a price. A is audited / contractual, B is management data with support, C is assertion without support, U is untested. U can never support a price. Read by red-flag-register, technology-dd and operational-dd.",
    starter: j({ supportsPrice: { A: null, B: null, C: null } }),
  },
  {
    key: "ic_memo",
    title: "IC memo structure",
    blurb: "Which sections the IC memo has, in what order, under what title, and which are required. The ic-memo skill generates twelve known sections; any other section you list appears as an open placeholder, never filled in. Sections you leave out are not emitted. The starter is the skill's own structure.",
    starter: j({ sections: MEMO_SECTION_KEYS.map((k) => ({ key: k, title: DEFAULT_MEMO_TITLES[k], required: false })) }),
  },
  {
    key: "reporting",
    title: "Reporting style",
    blurb: "How the quarterly LP update shows its figures: the currency and units NAV is in, decimal places, and your own labels for NAV / DPI / TVPI / Net IRR. Presentation only — it never changes a value or converts units. Read by lp-update.",
    starter: j({ currency: "", units: "", decimals: null, labels: { nav: "", dpi: "", tvpi: "", netIrr: "" } }),
  },
];
