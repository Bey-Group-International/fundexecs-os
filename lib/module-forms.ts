// Add-row field configs shared by the AddRowForm client component and the
// createModuleRow server action, so both agree on exactly which columns exist.
// Lives outside the "use server" actions file (which may only export async
// functions).
//
// Scope: FK-free, table-backed modules whose hub does NOT already have a
// bespoke editor. Build › Thesis and Build › Track Record are handled by their
// own modules (components/build/*), so they're intentionally absent here.

export type FieldType = "text" | "number" | "select" | "checkbox";

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
    ],
  },
};
