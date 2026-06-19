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
for (const mod of ADAPTERS) {
  for (const kind of mod.handles) ROUTING.set(kind, mod.adapter);
}

export function getAdapter(action: ActionKind): DispatchAdapter {
  return ROUTING.get(action) ?? mockAdapter;
}
