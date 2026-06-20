// lib/integrations/registry.ts
// Assembles the registered adapter modules into a single ActionKind → adapter
// routing map. Any ActionKind no module claims resolves to the mock adapter, so
// dispatch is always defined.
import type { ActionKind } from "@/lib/gates";
import type { DispatchAdapter } from "./types";
import { ADAPTERS } from "./adapters";
import { mockAdapter } from "./adapters/mock";

// Last module to claim a kind wins, which lets a real adapter supersede a
// placeholder for the same ActionKind.
const ROUTING = new Map<ActionKind, DispatchAdapter>();
// Channel routing: every registered adapter is reachable by its channel name, so
// a caller that knows the provider (the unified inbox) can pin dispatch to it.
const CHANNEL_ROUTING = new Map<string, DispatchAdapter>();
for (const mod of ADAPTERS) {
  for (const kind of mod.handles) ROUTING.set(kind, mod.adapter);
  CHANNEL_ROUTING.set(mod.adapter.channel, mod.adapter);
}

// Resolve the adapter for an action, optionally pinned to a specific channel.
// A valid channel hint wins; otherwise we route by ActionKind, falling back to
// the always-available mock adapter so dispatch is never undefined.
export function getAdapter(action: ActionKind, channel?: string): DispatchAdapter {
  if (channel) {
    const byChannel = CHANNEL_ROUTING.get(channel);
    if (byChannel) return byChannel;
  }
  return ROUTING.get(action) ?? mockAdapter;
}
