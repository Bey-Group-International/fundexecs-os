// lib/integrations/inbound/index.ts
// The inbound channel registry — the arriving counterpart to the dispatch
// adapter registry in ../index.ts. app/api/webhooks/[channel] resolves the
// path segment here; unknown channels 404. Adding a provider means writing one
// spec file (verify + map, both pure and unit-tested) and registering it below.
import type { InboundChannelSpec } from "./types";
import { calendlyInbound } from "./calendly";
import { resendInbound } from "./resend";

const SPECS: readonly InboundChannelSpec[] = [calendlyInbound, resendInbound];

export function getInboundChannel(channel: string): InboundChannelSpec | null {
  return SPECS.find((spec) => spec.channel === channel) ?? null;
}

export type { InboundChannelSpec, InboundEvent } from "./types";
