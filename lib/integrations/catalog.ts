// lib/integrations/catalog.ts
// The static catalog of integration channels and the operational actions each
// can run — independent of whether any given org has connected it. Sourced from
// the dispatch layer so there is one source of truth: the channels are the
// registered adapters, and each channel's capabilities are the ActionKinds the
// adapters route to it. Connection state lives elsewhere (lib/integrations/
// gateway.ts); this module is pure and safe to use on the client.
import { ADAPTERS } from "./adapters";
import { tierForAction, TIER_LABEL, type ActionKind, type GateTier } from "@/lib/gates";

// One operational action a connected integration can perform, with the gate
// tier that still governs running it.
export interface IntegrationCapability {
  kind: ActionKind;
  label: string;
  tier: GateTier;
  tierLabel: string;
}

// A channel and everything it can do — the connection-independent descriptor.
export interface IntegrationDescriptor {
  channel: string;
  label: string;
  capabilities: IntegrationCapability[];
}

// Friendly display names for the channels the dispatch layer registers. Any
// channel without an entry falls back to a humanized form of its key.
const CHANNEL_LABELS: Record<string, string> = {
  gmail: "Gmail",
  docusign: "Docusign",
  slack: "Slack",
  calendly: "Calendly",
  google_calendar: "Google Calendar",
  zoom: "Zoom",
  google_meet: "Google Meet",
};

export function labelForChannel(channel: string): string {
  return (
    CHANNEL_LABELS[channel] ??
    channel
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

// Turn an ActionKind ("send_diligence_request") into a readable label
// ("Send diligence request"), matching the Settings Connections panel.
function humanizeKind(kind: string): string {
  const words = kind.replace(/_/g, " ").trim();
  return words.charAt(0).toUpperCase() + words.slice(1);
}

function capabilityFor(kind: ActionKind): IntegrationCapability {
  const tier = tierForAction(kind);
  return { kind, label: humanizeKind(kind), tier, tierLabel: TIER_LABEL[tier] };
}

// Every distinct channel, in registration order, with the union of the
// capabilities its adapter modules declare. Multiple modules can share a
// channel, so we dedupe by channel key.
export function integrationCatalog(): IntegrationDescriptor[] {
  const byChannel = new Map<string, Set<ActionKind>>();
  const order: string[] = [];
  for (const { adapter, handles } of ADAPTERS) {
    let kinds = byChannel.get(adapter.channel);
    if (!kinds) {
      kinds = new Set<ActionKind>();
      byChannel.set(adapter.channel, kinds);
      order.push(adapter.channel);
    }
    for (const kind of handles) kinds.add(kind);
  }
  return order.map((channel) => ({
    channel,
    label: labelForChannel(channel),
    capabilities: [...byChannel.get(channel)!].map(capabilityFor),
  }));
}

// The channels whose adapter has real credentials in this environment. This is
// the deploy-wide fallback the per-org gateway connections layer builds on.
export function envConfiguredChannels(): Set<string> {
  const set = new Set<string>();
  for (const { adapter } of ADAPTERS) {
    if (adapter.isConfigured()) set.add(adapter.channel);
  }
  return set;
}
