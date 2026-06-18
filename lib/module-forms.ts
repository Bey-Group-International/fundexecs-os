// Add-row field configs shared by the AddRowForm client component and the
// createModuleRow server action so both agree on exactly which columns exist.
// Lives outside the "use server" actions file (which may only export async
// functions).

export type FieldType = "text" | "number" | "select" | "checkbox";

export interface FieldConfig {
  name: string;
  label: string;
  type: FieldType;
  /** validation hint; the server action enforces required text columns */
  required?: boolean;
  /** options for select fields */
  options?: string[];
  /** default value for selects / checkboxes / text inputs */
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

const ASSET_TYPES = [
  "real_estate",
  "operating_company",
  "portfolio_company",
  "fund_interest",
  "other",
];

// Per-module allow-list keyed by the `${hub}/${module}` route key. Only these
// columns are ever written by createModuleRow.
export const ADD_ROW_CONFIGS: Record<string, AddRowConfig> = {
  "source/lp_pipeline": {
    fields: [
      { name: "name", label: "Investor name", type: "text", required: true },
      {
        name: "investor_type",
        label: "Investor type",
        type: "select",
        options: INVESTOR_TYPES,
        defaultValue: "lp",
      },
      {
        name: "pipeline_stage",
        label: "Pipeline stage",
        type: "text",
        defaultValue: "prospect",
      },
    ],
  },
  "source/deal_pipeline": {
    fields: [
      { name: "name", label: "Deal name", type: "text", required: true },
      {
        name: "stage",
        label: "Stage",
        type: "select",
        options: DEAL_STAGES,
        defaultValue: "sourced",
      },
      { name: "asset_class", label: "Asset class", type: "text" },
    ],
  },
  "build/thesis": {
    fields: [
      { name: "title", label: "Title", type: "text", required: true },
      { name: "summary", label: "Summary", type: "text" },
      {
        name: "is_active",
        label: "Active",
        type: "checkbox",
        defaultValue: true,
      },
    ],
  },
  "build/track_record": {
    fields: [
      { name: "deal_name", label: "Deal name", type: "text", required: true },
      { name: "vintage_year", label: "Vintage year", type: "number" },
      { name: "gross_irr", label: "Gross IRR", type: "number" },
      { name: "gross_moic", label: "Gross MOIC", type: "number" },
    ],
  },
  "execute/asset_management": {
    fields: [
      { name: "name", label: "Asset name", type: "text", required: true },
      {
        name: "asset_type",
        label: "Asset type",
        type: "select",
        options: ASSET_TYPES,
        defaultValue: "real_estate",
      },
    ],
  },
};
