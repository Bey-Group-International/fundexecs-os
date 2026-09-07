// The shape of the access-request sign-up form, as data.
//
// The form, its validation, the admin review card and the decision page all
// derive from this one table. A question asked in the UI but never persisted —
// or persisted but never shown to the reviewer — is the failure mode this
// avoids: add a field here and every surface picks it up.
//
// Pure module: no IO, no React, no Supabase. That keeps it unit-testable and
// importable from both a client component and a server action.

/**
 * Who is asking. Four of these map one-to-one onto
 * `organizations.operator_role`; `lp` and `service_provider` do not exist as
 * operator roles, so they are captured and reviewed like anyone else and simply
 * choose their role in onboarding. See the migration comment for why we did not
 * widen the role enum here.
 */
export type ApplicantType =
  | "gp"
  | "family_office"
  | "advisory"
  | "operator"
  | "lp"
  | "service_provider";

export const APPLICANT_TYPES: ApplicantType[] = [
  "gp",
  "family_office",
  "advisory",
  "operator",
  "lp",
  "service_provider",
];

export function isApplicantType(value: unknown): value is ApplicantType {
  return typeof value === "string" && (APPLICANT_TYPES as string[]).includes(value);
}

export const APPLICANT_TYPE_LABEL: Record<ApplicantType, string> = {
  gp: "GP / Fund Manager",
  family_office: "Family Office",
  advisory: "Advisory / Placement",
  operator: "Operator / Co-GP",
  lp: "LP / Allocator",
  service_provider: "Service Provider",
};

export const APPLICANT_TYPE_DESC: Record<ApplicantType, string> = {
  gp: "Running a fund and deploying capital",
  family_office: "Managing capital for a single family",
  advisory: "Supporting GPs or sourcing on behalf of LPs",
  operator: "Running assets alongside a capital partner",
  lp: "Institution, endowment or fund-of-funds backing managers",
  service_provider: "Legal, audit, fund admin, tech or other services",
};

/**
 * The four that map onto `organizations.operator_role`. Returns null for the
 * two that don't — callers prefill what they can and leave the rest.
 */
export function operatorRoleForApplicantType(
  type: ApplicantType | null | undefined,
): "gp" | "family_office" | "advisory" | "operator" | null {
  if (type === "gp" || type === "family_office" || type === "advisory" || type === "operator") {
    return type;
  }
  return null;
}

export interface SelectOption {
  value: string;
  label: string;
}

export interface AccessRequestField {
  /** Form field name; also the `details` key when `column` is absent. */
  name: string;
  label: string;
  kind: "text" | "textarea" | "select" | "number";
  placeholder?: string;
  options?: SelectOption[];
  required?: boolean;
  /**
   * Persist to this typed column instead of `details`. Reserved for answers
   * onboarding also asks for, so prefill is a straight copy.
   */
  column?: "aum_range" | "fund_count" | "primary_strategy";
}

// Reused verbatim from the onboarding wizard so an approved request prefills it
// without translation.
export const AUM_OPTIONS: SelectOption[] = [
  { value: "sub_25m", label: "Under $25M" },
  { value: "25m_100m", label: "$25M – $100M" },
  { value: "100m_500m", label: "$100M – $500M" },
  { value: "500m_1b", label: "$500M – $1B" },
  { value: "over_1b", label: "Over $1B" },
];

export const STRATEGY_OPTIONS: SelectOption[] = [
  { value: "real_estate", label: "Real Estate" },
  { value: "private_equity", label: "Private Equity" },
  { value: "credit", label: "Private Credit" },
  { value: "multi", label: "Multi-strategy" },
];

const CHECK_SIZE_OPTIONS: SelectOption[] = [
  { value: "under_1m", label: "Under $1M" },
  { value: "1m_5m", label: "$1M – $5M" },
  { value: "5m_25m", label: "$5M – $25M" },
  { value: "25m_plus", label: "$25M+" },
];

const SERVICE_LINE_OPTIONS: SelectOption[] = [
  { value: "legal", label: "Legal" },
  { value: "audit_tax", label: "Audit & tax" },
  { value: "fund_admin", label: "Fund administration" },
  { value: "placement", label: "Placement & IR" },
  { value: "technology", label: "Technology" },
  { value: "other", label: "Other" },
];

const ALLOCATOR_TYPE_OPTIONS: SelectOption[] = [
  { value: "family_office", label: "Family office" },
  { value: "pension", label: "Pension" },
  { value: "endowment", label: "Endowment / foundation" },
  { value: "fund_of_funds", label: "Fund of funds" },
  { value: "sovereign_wealth", label: "Sovereign wealth" },
  { value: "hnw", label: "HNW / private wealth" },
  { value: "other", label: "Other" },
];

/**
 * Asked of everyone, in this order, before the type-specific block. `email` and
 * `full_name` are handled by the form itself rather than listed here — they are
 * the two the queue cannot function without and get their own treatment.
 */
export const COMMON_FIELDS: AccessRequestField[] = [
  {
    name: "organization_name",
    label: "Firm / organization",
    kind: "text",
    placeholder: "Meridian Capital Partners",
    required: true,
  },
  { name: "role", label: "Your title", kind: "text", placeholder: "Managing Partner" },
  { name: "hq_location", label: "Head office", kind: "text", placeholder: "New York, NY" },
  { name: "website", label: "Website", kind: "text", placeholder: "meridiancap.com" },
  { name: "phone", label: "Phone", kind: "text", placeholder: "+1 212 555 0100" },
];

/** The block that changes with who is asking. */
export const FIELDS_BY_TYPE: Record<ApplicantType, AccessRequestField[]> = {
  gp: [
    { name: "aum_range", label: "Assets under management", kind: "select", options: AUM_OPTIONS, column: "aum_range" },
    { name: "fund_count", label: "Funds raised to date", kind: "number", placeholder: "2", column: "fund_count" },
    { name: "primary_strategy", label: "Primary strategy", kind: "select", options: STRATEGY_OPTIONS, column: "primary_strategy", required: true },
  ],
  family_office: [
    { name: "aum_range", label: "Assets under management", kind: "select", options: AUM_OPTIONS, column: "aum_range" },
    { name: "primary_strategy", label: "Primary strategy", kind: "select", options: STRATEGY_OPTIONS, column: "primary_strategy" },
    { name: "check_size", label: "Typical check size", kind: "select", options: CHECK_SIZE_OPTIONS },
  ],
  advisory: [
    { name: "service_line", label: "Service line", kind: "select", options: SERVICE_LINE_OPTIONS, required: true },
    { name: "clients_served", label: "Who you work with", kind: "text", placeholder: "Emerging GPs raising Fund I–II" },
  ],
  operator: [
    { name: "sector", label: "Sector", kind: "text", placeholder: "Industrial real estate", required: true },
    { name: "primary_strategy", label: "Asset class", kind: "select", options: STRATEGY_OPTIONS, column: "primary_strategy" },
    { name: "portfolio_size", label: "Assets you operate", kind: "text", placeholder: "12 properties / 1.4M sq ft" },
  ],
  lp: [
    { name: "allocator_type", label: "Allocator type", kind: "select", options: ALLOCATOR_TYPE_OPTIONS, required: true },
    { name: "aum_range", label: "Assets under management", kind: "select", options: AUM_OPTIONS, column: "aum_range" },
    { name: "check_size", label: "Typical commitment", kind: "select", options: CHECK_SIZE_OPTIONS },
    { name: "primary_strategy", label: "Strategy focus", kind: "select", options: STRATEGY_OPTIONS, column: "primary_strategy" },
  ],
  service_provider: [
    { name: "service_line", label: "Service line", kind: "select", options: SERVICE_LINE_OPTIONS, required: true },
    { name: "clients_served", label: "Who you work with", kind: "text", placeholder: "GPs and family offices in private credit" },
  ],
};

/** The closing free-text question, asked of everyone. */
export const NOTE_FIELD: AccessRequestField = {
  name: "note",
  label: "What do you want to run in FundExecs?",
  kind: "textarea",
  placeholder: "Fund II diligence, LP reporting, deal sourcing…",
};

/** Every field for one applicant type, in the order the form renders them. */
export function fieldsFor(type: ApplicantType): AccessRequestField[] {
  return [...COMMON_FIELDS, ...FIELDS_BY_TYPE[type], NOTE_FIELD];
}

/**
 * Human label for a stored `details` value, for the admin card and the decision
 * page. Falls back to the raw value so a key we later stop asking for still
 * renders something truthful rather than disappearing.
 */
export function labelForDetail(fieldName: string, value: string): string {
  for (const fields of Object.values(FIELDS_BY_TYPE)) {
    const field = fields.find((f) => f.name === fieldName);
    if (field?.options) {
      return field.options.find((o) => o.value === value)?.label ?? value;
    }
    if (field) return value;
  }
  return value;
}

/** Human label for a `details` key. */
export function labelForDetailKey(fieldName: string): string {
  for (const fields of Object.values(FIELDS_BY_TYPE)) {
    const field = fields.find((f) => f.name === fieldName);
    if (field) return field.label;
  }
  return fieldName;
}
