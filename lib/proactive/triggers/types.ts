// lib/proactive/triggers/types.ts
// The Trigger contract — rules that turn state changes into candidate signals.
// A pluggable registry (registry.ts) so new signal types are CONFIG, not code:
// implement one TriggerDefinition, register it, and the sweep picks it up.
//
// A trigger has three responsibilities, kept separate so each is testable:
//   detect  — query state, emit raw Signals (the "what happened")
//   enrich  — pull PMI, attach provenance claims, adjust urgency/confidence
//   compose — turn an enriched signal into the Command objective + card title

import type { Hub } from "@/lib/supabase/database.types";
import type { ActionKind } from "@/lib/gates";
import type { createServiceClient } from "@/lib/supabase/server";
import type { Signal, SignalClass, ProvenancedClaim } from "@/lib/proactive/types";

export type TriggerClient = ReturnType<typeof createServiceClient>;

export interface TriggerContext {
  supabase: TriggerClient;
  orgId: string;
}

export interface EnrichedSignal {
  signal: Signal;
  /** PMI claims computed before surfacing (may be empty). */
  claims: ProvenancedClaim[];
  /** Post-PMI urgency/confidence (0–100). PMI's leverage on ranking lands here. */
  urgency: number;
  confidence: number;
}

export interface TriggerDefinition {
  key: string;
  label: string;
  hub: Hub;
  signalClass: SignalClass;
  /** The outward action the surfaced item ultimately asks the operator to take. */
  sendAction: ActionKind;
  /** True to run this trigger in the sweep. Config toggle. */
  enabled: boolean;
  /** Detect raw signals from current org state. Best-effort; never throws. */
  detect(ctx: TriggerContext): Promise<Signal[]>;
  /** Enrich a signal with PMI + adjusted urgency/confidence. */
  enrich(ctx: TriggerContext, signal: Signal): Promise<EnrichedSignal>;
  /** Compose the Command objective + card title from an enriched signal. */
  compose(enriched: EnrichedSignal): { objective: string; title: string };
}
