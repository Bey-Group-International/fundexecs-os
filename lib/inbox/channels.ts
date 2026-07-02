// lib/inbox/channels.ts
// The channel catalog for the Unified Inbox — the single mapping from each
// provider to its display label, its pillar (messaging / booking / video /
// signing), and a glyph for the list view. Pure (no I/O), so it is shared by the
// RSC inbox page, the server actions, and any client component alike.
//
// The dispatch-channel hint passed to lib/integrations is simply the channel key
// itself: the adapter in lib/integrations/adapters registers under the same name,
// so an inbox thread always dispatches through its own provider.
import type { InboxChannel, InboxCategory } from "@/lib/supabase/database.types";

export interface ChannelMeta {
  channel: InboxChannel;
  label: string;
  category: InboxCategory;
  icon: string;
}

export const INBOX_CHANNELS: Record<InboxChannel, ChannelMeta> = {
  gmail: { channel: "gmail", label: "Gmail", category: "messaging", icon: "✉" },
  slack: { channel: "slack", label: "Slack", category: "messaging", icon: "▣" },
  calendly: { channel: "calendly", label: "Calendly", category: "booking", icon: "◷" },
  google_calendar: {
    channel: "google_calendar",
    label: "Google Calendar",
    category: "booking",
    icon: "▦",
  },
  zoom: { channel: "zoom", label: "Zoom", category: "video", icon: "▷" },
  google_meet: { channel: "google_meet", label: "Google Meet", category: "video", icon: "◉" },
  docusign: { channel: "docusign", label: "Docusign", category: "signing", icon: "✍" },
  // Earn's instant ecosystem match alerts — a new org matched across the
  // Capital/LP, Debt, Partners, Providers, and Deals lanes (lib/ecosystem-match).
  ecosystem: { channel: "ecosystem", label: "Ecosystem", category: "messaging", icon: "◈" },
  // A deal shared across the ecosystem that fits this org (lib/deal-share).
  deal_share: { channel: "deal_share", label: "Deal flow", category: "messaging", icon: "◆" },
  // The recurring Act-now Radar digest — the ranked sourcing brief delivered
  // in-app (lib/radar-digest, lib/radar-send).
  radar_digest: { channel: "radar_digest", label: "Radar digest", category: "messaging", icon: "◎" },
  // Accounting: Xero invoices, bills, and overdue/awaiting-approval alerts.
  xero: { channel: "xero", label: "Xero", category: "finance", icon: "▤" },
  // Payments: Jax transactions, statements, and payment-status alerts.
  jax: { channel: "jax", label: "Jax", category: "finance", icon: "▥" },
};

export interface CategoryMeta {
  category: InboxCategory;
  label: string;
}

// Presentation order for the three intelligence pillars plus signing and finance.
export const INBOX_CATEGORIES: CategoryMeta[] = [
  { category: "messaging", label: "Messaging" },
  { category: "booking", label: "Booking" },
  { category: "video", label: "Video" },
  { category: "signing", label: "Signing" },
  { category: "finance", label: "Finance" },
];

export function channelMeta(channel: InboxChannel): ChannelMeta {
  return INBOX_CHANNELS[channel];
}
