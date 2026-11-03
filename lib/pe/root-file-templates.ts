// lib/pe/root-file-templates.ts
// Starter structures for the typed PE root files. Deliberately carry NO invented
// numbers: thresholds are left out (or null), so a starter saved as-is is either
// rejected (returns / financing / kpi) or saved as a DRAFT mandate with
// "no threshold" blockers that stop it being approved. The firm supplies the numbers.

import type { RootFileKey } from "./root-files";

export interface RootFileMeta {
  key: RootFileKey;
  title: string;
  blurb: string;
  /** True when a skill reads this file today. */
  typed: boolean;
  starter: string;
}

const j = (v: unknown) => JSON.stringify(v, null, 2);

export const ROOT_FILE_META: RootFileMeta[] = [
  {
    key: "mandate",
    title: "Investment mandate",
    blurb: "Hard limits (LPA / side letters), scored preferences and kill facts, each with a number. Read by mandate-screen, target-screen and first-look. Results are labelled default-screened until a partner approves it.",
    typed: true,
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
    blurb: "Base and downside hurdles and the underwriting hold period. IRR is a decimal (0.2 = 20%). Read by bid-range, exit-routes and final-investment-report.",
    typed: true,
    starter: j({ base: { irr: null, moic: null }, downside: { irr: null, moic: null }, holdYears: null }),
  },
  {
    key: "financing",
    title: "Financing limits",
    blurb: "Leverage limits, covenant warning threshold (percent), liquidity minimum, call protection the firm resists. Read by covenant-watch, cash-13-week and financing-terms.",
    typed: true,
    starter: j({ maxTotalLeverage: null, maxSeniorLeverage: null, minInterestCoverDownside: null, minEquityPct: null, covenantWarnHeadroomPct: null, escalateBelowPct: null, escalateTo: "", liquidityMinimum: null, maxCallProtectionMonths: null }),
  },
  {
    key: "kpi",
    title: "KPI materiality",
    blurb: "Flag a variance at or above a percent of budget, and above an absolute amount if you set one. Read by kpi-variance.",
    typed: true,
    starter: j({ materialityPct: null, materialityAbs: null, trendPeriods: null }),
  },
  { key: "firm", title: "Firm, gate owners, house style", blurb: "Who signs each gate, advisers, house style.", typed: false, starter: j({ firmName: "", gateOwners: {} }) },
  { key: "evidence", title: "Evidence grades", blurb: "The firm's evidence scale and citation format.", typed: false, starter: j({ grades: {} }) },
  { key: "ic_memo", title: "IC memo format", blurb: "The firm's IC memo structure.", typed: false, starter: j({ sections: [] }) },
  { key: "reporting", title: "Reporting policy", blurb: "Board, LP and valuation reporting formats.", typed: false, starter: j({ formats: {} }) },
];
