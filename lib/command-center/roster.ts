// Maps the shipped 15-agent catalog (lib/agents.ts) onto the spatial world:
// Earn anchors the hub as the orchestrator; the other executives are stationed
// in the office that matches their workflow, with a four-strong "bench" idling
// in the Command Center alongside Earn.

import { AGENTS, AGENT_BY_KEY } from "@/lib/agents";
import type { AgentKey } from "@/lib/supabase/database.types";
import type { AvatarDef, Cell } from "./types";
import { ROOM_BY_ID } from "./map";

// Which office each executive calls home, and the desk slot index they take.
const STATIONING: { key: AgentKey; room: string; slot: number }[] = [
  { key: "deal_sourcer", room: "mandate", slot: 0 },
  { key: "analyst", room: "mandate", slot: 1 },
  { key: "investor_relations", room: "relationship", slot: 0 },
  { key: "capital_raiser", room: "relationship", slot: 1 },
  { key: "rainmaker", room: "outbound", slot: 0 },
  { key: "lead_generator", room: "outbound", slot: 1 },
  { key: "diligence", room: "diligence", slot: 0 },
  { key: "portfolio_ops", room: "diligence", slot: 1 },
  { key: "capital_connector", room: "capital", slot: 0 },
  { key: "fund_admin", room: "capital", slot: 1 },
  // The bench in the hub around Earn.
  { key: "executive_advisor", room: "hub", slot: 0 },
  { key: "pr_director", room: "hub", slot: 1 },
  { key: "seo_disruptor", room: "hub", slot: 2 },
  { key: "curator", room: "hub", slot: 3 },
];

function monogram(name: string): string {
  const parts = name.trim().split(/\s+/);
  if (parts.length === 1) return parts[0].slice(0, 2).toUpperCase();
  return (parts[0][0] + parts[1][0]).toUpperCase();
}

export const EARN_ID = "earn";
export const EARN_AGENT_KEY: AgentKey = "associate";

export function buildRoster(): AvatarDef[] {
  const earnDef = AGENT_BY_KEY[EARN_AGENT_KEY];
  const hub = ROOM_BY_ID.hub;

  const earn: AvatarDef = {
    id: EARN_ID,
    name: earnDef.name, // "Earn"
    role: "Chief Operating Officer",
    color: "#c7ff6b", // the neural-green of the Earn coin halo
    homeRoom: "hub",
    spawn: { x: 21, y: 12 },
    monogram: "E",
    isEarn: true,
  };

  const execs: AvatarDef[] = STATIONING.map(({ key, room, slot }) => {
    const def = AGENT_BY_KEY[key];
    const r = ROOM_BY_ID[room];
    const spawn: Cell = r.stand[slot % r.stand.length] ?? r.stand[0];
    return {
      id: key,
      name: def.name,
      role: def.role.split(".")[0], // first sentence is the headline role
      color: def.color,
      homeRoom: room,
      spawn,
      monogram: monogram(def.name),
      isEarn: false,
    };
  });

  return [earn, ...execs];
}

/** Display order for any roster legend / status wall. */
export const ROSTER_ORDER = [EARN_ID, ...STATIONING.map((s) => s.key)];

export { AGENTS };
