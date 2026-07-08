// Data + Earn-driver seam.
//
// v1 runs entirely on self-contained demo state (the FLOWS constants and the
// roster derived from lib/agents.ts). This adapter defines the boundary so a
// later iteration can pipe live task/agent data and a live Earn (the repo's
// earn-conversation + @anthropic-ai/sdk) into the exact same primitives without
// touching geometry, rendering, or the engine.

import type { Step } from "./engine";
import { buildRoster } from "./roster";
import { FLOWS, type FlowDescriptor } from "./flows";
import type { AvatarDef } from "./types";

/** Produces the step timeline Earn should run for a given request. */
export interface EarnDriver {
  /** Scripted demo flows offered in the launcher. */
  listFlows(): FlowDescriptor[];
  /**
   * Turn a free-text directive into a timeline. The scripted driver matches it
   * to the closest demo flow; a live driver would call Earn and synthesize
   * Step[] from the plan it returns.
   */
  plan(prompt: string): Promise<{ kind: "A" | "B"; steps: Step[] }>;
}

/** Source of the world's executives. Swap for a live agent/task feed later. */
export interface WorldDataSource {
  getRoster(): AvatarDef[];
}

export const demoDataSource: WorldDataSource = {
  getRoster: () => buildRoster(),
};

export const scriptedEarnDriver: EarnDriver = {
  listFlows: () => FLOWS,
  plan: async (prompt: string) => {
    const p = prompt.toLowerCase();
    // Cheap intent match: words that imply hands-on reasoning route to Flow B
    // (Earn executes), everything else to Flow A (delegate the team).
    const direct = /thesis|tighten|review|flag|diligence|memo|check|refine/.test(p);
    const flow = FLOWS.find((f) => f.kind === (direct ? "B" : "A")) ?? FLOWS[0];
    // Swap the operator's own words into the opening user line.
    const steps = flow.steps.map((s) =>
      s.kind === "say" && s.role === "user" ? { ...s, text: prompt } : s,
    );
    return { kind: flow.kind, steps };
  },
};

// Live driver: asks the server (Claude) to synthesize Earn's dialogue + flow
// choice via /api/command-center/plan, and degrades to the scripted driver on
// any error. The route itself falls back deterministically when Claude isn't
// configured, so this is resilient end-to-end.
export const liveEarnDriver: EarnDriver = {
  listFlows: () => FLOWS,
  plan: async (prompt: string) => {
    try {
      const res = await fetch("/api/command-center/plan", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ prompt }),
      });
      if (!res.ok) throw new Error(`plan failed: ${res.status}`);
      const data = (await res.json()) as { kind?: unknown; steps?: unknown };
      if ((data.kind === "A" || data.kind === "B") && Array.isArray(data.steps)) {
        return { kind: data.kind, steps: data.steps as Step[] };
      }
      throw new Error("bad plan shape");
    } catch (err) {
      console.error("[liveEarnDriver] falling back to scripted:", err);
      return scriptedEarnDriver.plan(prompt);
    }
  },
};
