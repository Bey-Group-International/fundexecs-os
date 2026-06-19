// lib/integrations/index.ts
// Public entry point for the integration dispatch layer. `dispatchAction` is the
// one call sites use: it routes an action to the channel that handles it and
// returns a structured result. Unconfigured providers degrade to mock mode and
// any adapter error is captured (never thrown) so a dispatch can't break the
// caller's flow.
import { getAdapter } from "./registry";
import type { DispatchContext, DispatchResult } from "./types";

export type {
  DispatchContext,
  DispatchResult,
  DispatchAdapter,
  AdapterModule,
} from "./types";
export { getAdapter } from "./registry";

export async function dispatchAction(ctx: DispatchContext): Promise<DispatchResult> {
  const adapter = getAdapter(ctx.action);
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
