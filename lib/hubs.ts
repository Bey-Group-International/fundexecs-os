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
}

export const HUBS: HubDefinition[] = [
  {
    key: "build",
    label: "Build",
    purpose: "Define identity and foundation.",
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
    purpose: "Manage pipelines and relationships.",
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
    purpose: "Evaluate and manage active deals.",
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
    purpose: "Operate assets post-closing.",
    modules: [
      { key: "closing", label: "Closing" },
      { key: "capital_events", label: "Capital Events" },
      { key: "asset_management", label: "Asset Management" },
      { key: "reporting", label: "Reporting" },
      { key: "exit", label: "Exit" },
    ],
  },
];

export const HUB_BY_KEY: Record<Hub, HubDefinition> = Object.fromEntries(
  HUBS.map((h) => [h.key, h]),
) as Record<Hub, HubDefinition>;
