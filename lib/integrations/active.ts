// lib/integrations/active.ts
// Server-side read of which dispatch channels are actually connected (real
// credentials present), so a surface like the composer's "+" menu can show the
// operator the integrations they have active without leaving the page.
//
// "Active" mirrors the Connections panel's notion of Connected: an adapter whose
// isConfigured() is true. Channels still running in mock mode are intentionally
// excluded — they aren't reaching the outside world yet. isConfigured() reads
// process.env, so this must run on the server and be passed down as a prop.
import { ADAPTERS } from "./adapters";
import { tierForAction, TIER_LABEL, type ActionKind, type GateTier } from "@/lib/gates";

// One operational action a connected integration can perform, sourced from the
// ActionKinds the dispatch layer already routes to that channel. The gate tier
// travels with it so the composer can show that running it stays approval-gated.
export interface IntegrationCapability {
  kind: ActionKind;
  label: string;
  tier: GateTier;
  tierLabel: string;
}

export interface ActiveIntegration {
  channel: string;
  label: string;
  capabilities: IntegrationCapability[];
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

function labelFor(channel: string): string {
  return (
    CHANNEL_LABELS[channel] ??
    channel
      .split("_")
      .map((w) => w.charAt(0).toUpperCase() + w.slice(1))
      .join(" ")
  );
}

// The distinct connected channels, in registration order, each with the
// operational actions it can run. Multiple adapter modules can share a channel,
// so we dedupe by channel key and union their declared handles.
export function getActiveIntegrations(): ActiveIntegration[] {
  const byChannel = new Map<string, { kinds: Set<ActionKind> }>();
  const order: string[] = [];
  for (const { adapter, handles } of ADAPTERS) {
    if (!adapter.isConfigured()) continue;
    let entry = byChannel.get(adapter.channel);
    if (!entry) {
      entry = { kinds: new Set<ActionKind>() };
      byChannel.set(adapter.channel, entry);
      order.push(adapter.channel);
    }
    for (const kind of handles) entry.kinds.add(kind);
  }
  return order.map((channel) => ({
    channel,
    label: labelFor(channel),
    capabilities: [...byChannel.get(channel)!.kinds].map(capabilityFor),
  }));
}
