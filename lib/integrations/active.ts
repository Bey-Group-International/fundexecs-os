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

export interface ActiveIntegration {
  channel: string;
  label: string;
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

// The distinct connected channels, in registration order. Multiple adapter
// modules can share a channel, so we dedupe by channel key.
export function getActiveIntegrations(): ActiveIntegration[] {
  const seen = new Set<string>();
  const active: ActiveIntegration[] = [];
  for (const { adapter } of ADAPTERS) {
    if (seen.has(adapter.channel)) continue;
    if (!adapter.isConfigured()) continue;
    seen.add(adapter.channel);
    active.push({ channel: adapter.channel, label: labelFor(adapter.channel) });
  }
  return active;
}
