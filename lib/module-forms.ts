// Add-row field configs shared by the AddRowForm client component and the
// createModuleRow server action, so both agree on exactly which columns exist.
// Lives outside the "use server" actions file (which may only export async
// functions).
//
// Scope: FK-free, table-backed modules whose hub does NOT already have a
// bespoke editor. Build › Thesis and Build › Track Record are handled by their
// own modules (components/build/*), so they're intentionally absent here.

export type FieldType = "text" | "number" | "select" | "checkbox" | "date";

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  required?: boolean;
  options?: string[];
  defaultValue?: string | boolean;
}

export interface AddRowConfig {
  fields: FieldConfig[];
}

const INVESTOR_TYPES = [
  "lp",
  "family_office",
  "institution",
  "fund_of_funds",
  "lender",
  "bank",
  "co_gp",
  "other",
];

const DEAL_STAGES = [
  "sourced",
  "screening",
  "diligence",
  "underwriting",
  "ic_review",
  "closing",
  "owned",
  "exited",
  "passed",
  "dead",
];

const ASSET_TYPES = ["real_estate", "operating_company", "portfolio_company", "fund_interest", "other"];
const ASSET_STATUSES = ["active", "monitoring", "underperforming", "exited", "written_off"];

const CAPITAL_EVENT_TYPES = [
  "capital_call",
  "distribution",
  "contribution",
  "fee",
  "return_of_capital",
  "carry",
];

const PARTNER_TYPES = ["co_gp", "operating_partner", "advisor", "introducer", "other"];
const PARTNER_STATUSES = ["active", "prospective", "dormant", "former"];

const PROVIDER_TYPES = ["legal", "audit", "tax", "fund_admin", "placement", "bank", "other"];
const PROVIDER_STATUSES = ["active", "prospective", "former"];

const FACILITY_TYPES = ["term_loan", "revolver", "mezzanine", "sub_debt", "bridge", "preferred", "other"];
const FACILITY_STATUSES = ["prospective", "term_sheet", "committed", "drawn", "repaid", "closed"];

// Per-module allow-list keyed by the `${hub}/${module}` route key. Only these
// columns are ever written by createModuleRow.
export const ADD_ROW_CONFIGS: Record<string, AddRowConfig> = {
  "source/lp_pipeline": {
    fields: [
      { name: "name", label: "Investor name", type: "text", required: true },
      { name: "investor_type", label: "Investor type", type: "select", options: INVESTOR_TYPES, defaultValue: "lp" },
      { name: "pipeline_stage", label: "Pipeline stage", type: "text", defaultValue: "prospect" },
    ],
  },
  "source/deal_pipeline": {
    fields: [
      { name: "name", label: "Deal name", type: "text", required: true },
      { name: "stage", label: "Stage", type: "select", options: DEAL_STAGES, defaultValue: "sourced" },
      { name: "asset_class", label: "Asset class", type: "text" },
    ],
  },
  "execute/asset_management": {
    fields: [
      { name: "name", label: "Asset name", type: "text", required: true },
      { name: "asset_type", label: "Asset type", type: "select", options: ASSET_TYPES, defaultValue: "real_estate" },
      { name: "acquisition_cost", label: "Acquisition cost", type: "number" },
      { name: "current_value", label: "Current value", type: "number" },
      { name: "acquisition_date", label: "Acquisition date", type: "date" },
      { name: "status", label: "Status", type: "select", options: ASSET_STATUSES, defaultValue: "active" },
      { name: "noi", label: "NOI", type: "number" },
      { name: "cap_rate", label: "Cap rate (%)", type: "number" },
    ],
  },
  "execute/capital_events": {
    fields: [
      { name: "event_type", label: "Event type", type: "select", options: CAPITAL_EVENT_TYPES, defaultValue: "capital_call" },
      { name: "amount", label: "Amount", type: "number", required: true },
      { name: "effective_date", label: "Effective date", type: "date" },
      { name: "currency", label: "Currency", type: "text", defaultValue: "USD" },
      { name: "reference", label: "Reference", type: "text" },
    ],
  },
  "source/partners": {
    fields: [
      { name: "name", label: "Partner name", type: "text", required: true },
      { name: "partner_type", label: "Partner type", type: "select", options: PARTNER_TYPES, defaultValue: "co_gp" },
      { name: "relationship", label: "Relationship", type: "text" },
      { name: "contact_name", label: "Contact name", type: "text" },
      { name: "contact_email", label: "Contact email", type: "text" },
      { name: "status", label: "Status", type: "select", options: PARTNER_STATUSES, defaultValue: "active" },
    ],
  },
  "source/providers": {
    fields: [
      { name: "name", label: "Provider name", type: "text", required: true },
      { name: "provider_type", label: "Provider type", type: "select", options: PROVIDER_TYPES, defaultValue: "legal" },
      { name: "contact_name", label: "Contact name", type: "text" },
      { name: "contact_email", label: "Contact email", type: "text" },
      { name: "status", label: "Status", type: "select", options: PROVIDER_STATUSES, defaultValue: "active" },
    ],
  },
  "source/debt": {
    fields: [
      { name: "name", label: "Facility name", type: "text", required: true },
      { name: "facility_type", label: "Facility type", type: "select", options: FACILITY_TYPES, defaultValue: "term_loan" },
      { name: "lender", label: "Lender", type: "text" },
      { name: "commitment_amount", label: "Commitment amount", type: "number" },
      { name: "interest_rate", label: "Interest rate (%)", type: "number" },
      { name: "currency", label: "Currency", type: "text", defaultValue: "USD" },
      { name: "status", label: "Status", type: "select", options: FACILITY_STATUSES, defaultValue: "prospective" },
    ],
  },
};
