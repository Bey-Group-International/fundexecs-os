// lib/integrations/index.ts
// Public entry point for the integration dispatch layer. `dispatchAction` is the
// one call sites use: it routes an action to the channel that handles it and
// returns a structured result. Unconfigured providers degrade to mock mode and
// any adapter error is captured (never thrown) so a dispatch can't break the
// caller's flow.
import { getAdapter } from "./registry";
import { tierForAction } from "@/lib/gates";
import { isVerifiable } from "@/lib/grounding";
import type { DispatchContext, DispatchResult } from "./types";

export type {
  DispatchContext,
  DispatchResult,
  DispatchAdapter,
  AdapterModule,
} from "./types";
export { getAdapter } from "./registry";

export async function dispatchAction(ctx: DispatchContext): Promise<DispatchResult> {
  const adapter = getAdapter(ctx.action, ctx.channel);

  // Trust layer pre-flight: nothing unverified leaves the building. When an
  // action carries a backing composer artifact and that artifact is not
  // verifiable (neither operator-signed nor automatically well-grounded), a
  // Tier-2/3 send is refused at the gate instead of silently going out. Tier 1
  // is internal work product and always proceeds; actions with no backing
  // artifact are unaffected — the same dispatch path as before.
  if (ctx.backingArtifact && tierForAction(ctx.action) >= 2 && !isVerifiable(ctx.backingArtifact)) {
    return {
      ok: false,
      channel: adapter.channel,
      live: false,
      gated: true,
      detail:
        "Blocked at the trust gate: unverified, weakly-grounded work product cannot be sent to a counterparty. Verify it first.",
    };
  }

  try {
    return await adapter.dispatch(ctx);
  } catch (err) {
    return {
      ok: false,
      channel: adapter.channel,
      live: false,
      detail: "Dispatch failed.",
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
