// Shared display-label maps for organization profile fields.
// Applied only at the render layer — stored DB values are never changed.
// Covers legacy snake_case enum values from seeded/API data as well as the
// current DB CHECK constraint values (migration 0025_onboarding_fields.sql).

export const STRATEGY_LABELS: Record<string, string> = {
  private_equity: "Private Equity",
  venture_capital: "Venture Capital",
  real_estate: "Real Estate",
  credit_debt: "Credit / Debt",
  infrastructure: "Infrastructure",
  multi_strategy: "Multi-Strategy",
  fund_of_funds: "Fund of Funds",
  hedge_fund: "Hedge Fund",
  other: "Other",
};

// Matches DB CHECK constraint: sub_25m | 25m_100m | 100m_500m | 500m_1b | over_1b
export const AUM_LABELS: Record<string, string> = {
  sub_25m: "Under $25M",
  "25m_100m": "$25M – $100M",
  "100m_500m": "$100M – $500M",
  "500m_1b": "$500M – $1B",
  over_1b: "Over $1B",
};

export const ROLE_LABELS: Record<string, string> = {
  gp: "GP",
  family_office: "Family Office",
  advisory: "Advisory",
  operator: "Operator",
  lp: "LP",
  sponsor: "Sponsor",
  placement_agent: "Placement Agent",
  fund_administrator: "Fund Administrator",
  ria: "RIA",
  other: "Other",
};

// entity_type is free-text, so we title-case unknown values rather than
// mapping every possible string.
export function displayLabel(raw: string, map: Record<string, string>): string {
  return map[raw] ?? map[raw.toLowerCase()] ?? raw;
}

export function titleCase(s: string): string {
  return s
    .split(/[_\s]+/)
    .map((w) => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(" ");
}
