// lib/integrations/adapters/mock.ts
// The always-available fallback adapter. It never makes an external call — it
// records what WOULD have been dispatched, so the gate → dispatch loop is fully
// observable before any provider is connected. The registry routes any
// ActionKind that no concrete adapter claims here.
import type { DispatchAdapter, DispatchContext, DispatchResult } from "../types";

export const mockAdapter: DispatchAdapter = {
  channel: "mock",
  isConfigured: () => true,
  async dispatch(ctx: DispatchContext): Promise<DispatchResult> {
    const who = ctx.target?.name ? ` to ${ctx.target.name}` : "";
    return {
      ok: true,
      channel: "mock",
      live: false,
      detail: `Simulated ${ctx.action.replace(/_/g, " ")}${who} — connect a provider to act for real.`,
    };
  },
};
