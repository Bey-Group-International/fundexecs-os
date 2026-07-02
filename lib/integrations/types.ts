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
  // Optional channel hint. Most call sites route purely by ActionKind, but the
  // unified inbox knows which provider a thread flows through (e.g. a reply on a
  // Slack thread vs. an email thread) and pins dispatch to that channel. When set
  // and a matching adapter is registered, it overrides ActionKind routing.
  channel?: string;
  // Per-org connection state for this channel, resolved through the gateway
  // (lib/integrations/gateway). When provided, it authoritatively decides the
  // prepared (draft/mock) vs queued (route through the connected provider)
  // outcome — so dispatch reflects whether THIS org has connected the channel,
  // not just a deploy-wide env var. Omit to fall back to the adapter's env check.
  connected?: boolean;
  // The counterparty this action reaches, when known.
  target?: { name?: string; email?: string };
  // Drafted content when the action carries a message.
  subject?: string;
  body?: string;
  // Anything else an adapter needs; kept open so adapters can evolve their
  // inputs without churning this contract.
  metadata?: Record<string, unknown>;
  // Trust layer: the verification standing of the composer artifact this action
  // would carry outward, when one backs it. dispatchAction reads it through
  // `isVerifiable` (lib/grounding.ts) and pre-flight-blocks a Tier-2/3 send of
  // unverified, weakly-grounded work product. Omit for actions with no backing
  // artifact — those dispatch exactly as before.
  backingArtifact?: { verification_status: string; grounding_score: number };
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
  // Trust layer: set when dispatch was refused at the gate rather than attempted
  // — an unverified, weakly-grounded artifact cannot ride a Tier-2/3 send out to
  // a counterparty. `gated` results are always `ok: false` and `live: false`;
  // the reason rides in `detail`. Unset for every normal (attempted) dispatch.
  gated?: boolean;
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
