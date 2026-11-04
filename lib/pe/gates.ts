// lib/pe/gates.ts
// The human gates of the PE department, and the firm file that names who owns each.
// Every PE skill ends by naming a gate owner and never describes its output as
// approved. Until a firm names its owners, each skill uses a labelled generic role
// ("The deal lead", "The IC"); once the firm file does, the skill names the real
// person or committee instead. Pure.

export const GATE_KEYS = [
  "mandate_screen",
  "target_screen_review",
  "first_look",
  "revenue_quality",
  "adjusted_ebitda",
  "red_flag_treatment",
  "legal_findings",
  "tax_exposures",
  "technology_risk_ratings",
  "improvement_register",
  "bid_price",
  "sensitivity_basis",
  "financing_structure",
  "debt_structure",
  "compliance_certificate",
  "kpi_trend_review",
  "cash_forecast",
  "exit_launch",
  "ipo_decision",
  "exit_route",
  "data_room_redaction",
  "final_report_review",
] as const;
export type GateKey = (typeof GATE_KEYS)[number];

export function isGateKey(k: string): k is GateKey {
  return (GATE_KEYS as readonly string[]).includes(k);
}

export interface GateInfo {
  key: GateKey;
  label: string;
}

/** Which gate each PE skill ends on. The skill's own default role is unchanged when the firm names no owner. */
export const SKILL_GATES: Record<string, GateInfo> = {
  "mandate-screen": { key: "mandate_screen", label: "Mandate screen sign-off" },
  "target-screen": { key: "target_screen_review", label: "Review of every pass before outreach" },
  "first-look": { key: "first_look", label: "Go / no-go on first look" },
  "revenue-quality": { key: "revenue_quality", label: "Treatment of customer concentration" },
  "qoe-bridge": { key: "adjusted_ebitda", label: "Diligence-adjusted EBITDA" },
  "legal-dd": { key: "legal_findings", label: "Legal findings" },
  "operational-dd": { key: "improvement_register", label: "Improvement register" },
  "technology-dd": { key: "technology_risk_ratings", label: "Technology risk ratings" },
  "tax-dd": { key: "tax_exposures", label: "Tax exposures before price or SPA" },
  "red-flag-register": { key: "red_flag_treatment", label: "Treatment of walk-away and price items" },
  "bid-range": { key: "bid_price", label: "Bid price" },
  sensitivity: { key: "sensitivity_basis", label: "Case the price rests on" },
  "financing-terms": { key: "financing_structure", label: "Financing structure and lender selection" },
  "debt-structure": { key: "debt_structure", label: "Debt structure before lenders see it" },
  "covenant-watch": { key: "compliance_certificate", label: "Compliance certificate" },
  "kpi-variance": { key: "kpi_trend_review", label: "KPI trend classifications" },
  "cash-13-week": { key: "cash_forecast", label: "13-week cash forecast" },
  "exit-readiness": { key: "exit_launch", label: "Exit launch timing" },
  "ipo-readiness": { key: "ipo_decision", label: "Decision to pursue a listing" },
  "exit-routes": { key: "exit_route", label: "Exit route" },
  "data-room-prep": { key: "data_room_redaction", label: "Redaction list before the room opens" },
  "final-investment-report": { key: "final_report_review", label: "Final investment report" },
};

export const MAX_OWNER_CHARS = 120;

export interface FirmFile {
  firmName?: string;
  gateOwners: Partial<Record<GateKey, string>>;
}

export interface FirmParse {
  firm: FirmFile | null;
  /** Gate keys present in the input but not known to the platform. */
  unknownKeys: string[];
  /** Owners dropped for being empty or over the length cap. */
  droppedOwners: string[];
}

function cleanText(v: unknown): string | undefined {
  if (typeof v !== "string") return undefined;
  const t = v.trim();
  return t && t.length <= MAX_OWNER_CHARS ? t : undefined;
}

/** Defensive parse of the stored firm file. firm is null when neither a firm name nor any gate owner survives. Never throws. */
export function parseFirmFile(raw: unknown): FirmParse {
  const empty: FirmParse = { firm: null, unknownKeys: [], droppedOwners: [] };
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return empty;
  const o = raw as Record<string, unknown>;

  const gateOwners: FirmFile["gateOwners"] = {};
  const unknownKeys: string[] = [];
  const droppedOwners: string[] = [];
  const g = o.gateOwners;
  if (g && typeof g === "object" && !Array.isArray(g)) {
    for (const [k, v] of Object.entries(g as Record<string, unknown>)) {
      if (!isGateKey(k)) {
        unknownKeys.push(k);
        continue;
      }
      const t = cleanText(v);
      if (t) gateOwners[k] = t;
      else if (typeof v === "string" && v.trim()) droppedOwners.push(k); // present but too long
    }
  }
  const firmName = cleanText(o.firmName);
  if (!firmName && Object.keys(gateOwners).length === 0) return { firm: null, unknownKeys, droppedOwners };
  return { firm: { ...(firmName ? { firmName } : {}), gateOwners }, unknownKeys, droppedOwners };
}

/** The firm's owner for a skill's gate, or undefined to leave the skill's labelled default. */
export function gateOwnerFor(skillId: string, firm: FirmFile | null | undefined): string | undefined {
  const gate = SKILL_GATES[skillId];
  return gate ? firm?.gateOwners[gate.key] : undefined;
}
