// lib/proactive/triggers/registry.ts
// The pluggable trigger registry. Adding a signal type is registering one
// TriggerDefinition here — the sweep iterates enabled triggers, so new
// initiative is config, not new orchestration code.
//
// The first slice wires cold-LP (Source) end-to-end. Build/Run/Execute triggers
// (term-drift, stale-mark, sub-doc-expiring, close-conditions-met) slot in here
// behind the same contract as they're built.

import type { TriggerDefinition } from "./types";
import { coldLpTrigger } from "./cold-lp";

export const TRIGGERS: TriggerDefinition[] = [
  coldLpTrigger,
  // build:   termDriftTrigger,        // Build — terms vs cohort (Carta)
  // run:     staleMarkTrigger,        // Run — mark review recommended (Carta FMV)
  // execute: closeConditionsTrigger,  // Execute — close conditions met
];

export function enabledTriggers(): TriggerDefinition[] {
  return TRIGGERS.filter((t) => t.enabled);
}

export function getTrigger(key: string): TriggerDefinition | null {
  return TRIGGERS.find((t) => t.key === key) ?? null;
}
