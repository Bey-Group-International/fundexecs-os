// lib/integrations/types.ts
// The dispatch-adapter contract — the seam between the gate layer (which decides
// IF an action may happen) and the outside world (which makes it happen).
//
// Every concrete channel (Gmail, Docusign, …) implements DispatchAdapter and
// declares which ActionKinds it handles via an AdapterModule. The registry
// assembles those modules into one ActionKind → adapter routing map. Adapters
// follow a mock-or-real discipline: when their credentials are absent they still
// return a well-formed result in mock mode (prepared/queued, not sent), so the
// product behaves identically whether or not a provider is connected.
import type { ActionKind } from "@/lib/gates";

export interface DispatchContext {
  orgId: string;
  actorId: string;
  // The action being dispatched.
  action: ActionKind;
  // The counterparty this action reaches, when known.
  target?: { name?: string; email?: string };
  // Drafted content when the action carries a message.
  subject?: string;
  body?: string;
  // Anything else an adapter needs; kept open so adapters can evolve their
  // inputs without churning this contract.
  metadata?: Record<string, unknown>;
}

export interface DispatchResult {
  ok: boolean;
  // The channel that handled it ("gmail", "docusign", "mock", …).
  channel: string;
  // True only when a real external call was made. Mock/queued results are false.
  live: boolean;
  // Human-readable outcome, surfaced to the operator.
  detail: string;
  // External reference (message id, envelope id, booking url) when one exists.
  reference?: string;
  error?: string;
}

export interface DispatchAdapter {
  // Stable channel name; also used as the mock-mode label.
  channel: string;
  // Whether real credentials are present. When false the adapter operates in
  // mock mode rather than failing.
  isConfigured(): boolean;
  dispatch(ctx: DispatchContext): Promise<DispatchResult>;
}

export interface AdapterModule {
  // The ActionKinds this adapter is responsible for.
  handles: ActionKind[];
  adapter: DispatchAdapter;
}
