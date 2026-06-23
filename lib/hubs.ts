// The four operational hubs and their modules. Single source of truth for
// navigation and routing; mirrors the architecture in AGENT.md / README.
import type { Hub } from "./supabase/database.types";

export interface HubModule {
  key: string;
  label: string;
}

export interface HubDefinition {
  key: Hub;
  label: string;
  purpose: string;
  modules: HubModule[];
  /** Hubs whose actions reach outside the firm and so run behind an explicit
   * approval gate (per the mockups, "Approval-gated"). Surfaced as a rail badge. */
  approvalGated?: boolean;
}

export const HUBS: HubDefinition[] = [
  {
    key: "build",
    label: "Build",
    purpose:
      "Build your firm's investor-facing identity — profile, thesis, materials, and team. Earn reads everything here to draft LP memos, score deal fit, and position you accurately in the ecosystem.",
    modules: [
      { key: "profile", label: "Profile" },
      { key: "thesis", label: "Thesis" },
      { key: "brand", label: "Brand" },
      { key: "entity", label: "Entity" },
      { key: "track_record", label: "Track Record" },
      { key: "team", label: "Team" },
      { key: "data_room", label: "Materials & Data Room" },
    ],
  },
  {
    key: "source",
    label: "Source",
    purpose:
      "Build LP, deal, and partner pipelines that move. Earn surfaces qualified matches, scores relationship momentum, and alerts you the moment a counterparty is ready for the next step.",
    modules: [
      { key: "lp_pipeline", label: "LP Pipeline" },
      { key: "debt", label: "Debt & Hybrid" },
      { key: "partners", label: "Partners" },
      { key: "providers", label: "Providers" },
      { key: "deal_pipeline", label: "Deal Pipeline" },
    ],
  },
  {
    key: "run",
    label: "Run",
    purpose:
      "Underwrite and advance active deals with conviction. Earn scores diligence coverage, flags open risks, and keeps your IC package current — every action that touches deal records or sends communications runs behind your explicit sign-off.",
    approvalGated: true,
    modules: [
      { key: "strategy", label: "Strategy" },
      { key: "diligence", label: "Diligence" },
      { key: "underwriting", label: "Underwriting" },
      { key: "stress_test", label: "Stress Test" },
      { key: "comms", label: "Comms" },
      { key: "risk", label: "Risk" },
    ],
  },
  {
    key: "execute",
    label: "Execute",
    purpose:
      "Operate assets from close to exit — cap table, capital calls, LP reporting, waterfall, and valuations. Every action that moves capital or modifies ownership requires your approval before it executes.",
    modules: [
      { key: "closing", label: "Closing" },
      { key: "signing", label: "Signing" },
      { key: "issuance", label: "Issuance" },
      { key: "capital_events", label: "Capital Events" },
      { key: "asset_management", label: "Asset Management" },
      { key: "valuations", label: "Valuations" },
      { key: "cap_table", label: "Cap Table" },
      { key: "ownership", label: "Ownership" },
      { key: "waterfall", label: "Waterfall" },
      { key: "reporting", label: "Reporting" },
      { key: "exit", label: "Exit" },
    ],
  },
];

export const HUB_BY_KEY: Record<Hub, HubDefinition> = Object.fromEntries(
  HUBS.map((h) => [h.key, h]),
) as Record<Hub, HubDefinition>;
