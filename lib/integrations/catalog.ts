import {
  Mail,
  Calendar,
  CalendarClock,
  MessageSquare,
  HardDrive,
  FileText,
  Presentation,
  Video,
  Webcam,
  Inbox,
  Users,
  CloudUpload,
  Package,
  Box,
  Share2,
  Target,
  Cloud,
  Rocket,
  PenTool,
  PieChart,
  NotebookPen,
  Table2,
  Mic,
  Sparkles,
  AudioLines,
  type LucideIcon
} from 'lucide-react';
import type { ProviderConnection } from '@/lib/queries/integrations';

/* ============================================================================
 * lib/integrations/catalog.ts — the static provider catalog + view helpers,
 * shared by the standalone /integrations page and the Settings → Integrations
 * section so both render the identical set of providers, grouped by category.
 *
 * Providers fall into two buckets:
 *   • wired      — a real connect/sync path exists (OAuth or API key). These
 *                  render a live "Connect" control.
 *   • comingSoon — catalogued for visibility; surface "Request access" until the
 *                  server-side credentials/ingestion are wired. No per-provider
 *                  setup is required to ship the card.
 * ========================================================================= */

export type Provider =
  // Email & calendar
  | 'gmail'
  | 'google_calendar'
  | 'calendly'
  | 'outlook'
  // Collaboration (chat + meetings)
  | 'slack'
  | 'zoom'
  | 'google_meet'
  | 'microsoft_teams'
  // Files & storage
  | 'google_drive'
  | 'google_docs'
  | 'google_slides'
  | 'onedrive'
  | 'dropbox'
  | 'box'
  | 'docsend'
  // CRM & outreach
  | 'hubspot'
  | 'salesforce'
  | 'apollo'
  // E-sign & cap table
  | 'docusign'
  | 'carta'
  // Knowledge & notes
  | 'notion'
  | 'airtable'
  | 'granola'
  | 'read_ai'
  | 'otter';

export type ConnectionStatus = ProviderConnection['status'];

/** Top-level grouping used for the category tabs + section headers. */
export type IntegrationGroup =
  | 'email_calendar'
  | 'collaboration'
  | 'files'
  | 'crm'
  | 'esign_captable'
  | 'knowledge';

export interface IntegrationGroupMeta {
  id: IntegrationGroup;
  label: string;
  blurb: string;
}

/** Ordered groups — drives tab order and section order on the page. */
export const GROUP_ORDER: IntegrationGroupMeta[] = [
  {
    id: 'email_calendar',
    label: 'Email & calendar',
    blurb: 'Capture conversations and meetings as relationship signals.'
  },
  {
    id: 'collaboration',
    label: 'Collaboration',
    blurb: 'Push alerts and log calls across chat and conferencing.'
  },
  {
    id: 'files',
    label: 'Files & storage',
    blurb: 'Sync decks, memos and data-room files into deals and records.'
  },
  {
    id: 'crm',
    label: 'CRM & outreach',
    blurb: 'Two-way sync of contacts, companies and outreach sequences.'
  },
  {
    id: 'esign_captable',
    label: 'E-sign & cap table',
    blurb: 'Track signatures, ownership and closing documents.'
  },
  {
    id: 'knowledge',
    label: 'Knowledge & notes',
    blurb: 'Pull meeting notes, transcripts and structured knowledge.'
  }
];

/** How a provider connects — informs the card copy + connect affordance. */
export type ConnectKind = 'oauth' | 'api_key' | 'request';

export interface ProviderMeta {
  name: string;
  description: string;
  icon: LucideIcon;
  /** Short eyebrow shown on the card (e.g. "Email", "Cap table"). */
  category: string;
  /** Top-level group for tabs + sectioning. */
  group: IntegrationGroup;
  /** Connect mechanism. 'request' = catalogued, not yet wired. */
  connect: ConnectKind;
  /** Catalogued but not yet wired — renders "Request access". */
  comingSoon?: boolean;
}

/** Known integrations we surface, with display metadata. */
export const PROVIDER_META: Record<Provider, ProviderMeta> = {
  // ── Email & calendar ──────────────────────────────────────────────────
  gmail: {
    name: 'Gmail',
    description: 'Sync email threads to enrich relationship warmth.',
    icon: Mail,
    category: 'Email',
    group: 'email_calendar',
    connect: 'oauth'
  },
  google_calendar: {
    name: 'Google Calendar',
    description: 'Log meetings as interactions across your network.',
    icon: Calendar,
    category: 'Calendar',
    group: 'email_calendar',
    connect: 'oauth'
  },
  calendly: {
    name: 'Calendly',
    description: 'Capture booked calls and route them to deals.',
    icon: CalendarClock,
    category: 'Scheduling',
    group: 'email_calendar',
    connect: 'oauth'
  },
  outlook: {
    name: 'Outlook',
    description: 'Sync Microsoft 365 mail and calendar into your records.',
    icon: Inbox,
    category: 'Email',
    group: 'email_calendar',
    connect: 'request',
    comingSoon: true
  },

  // ── Collaboration ─────────────────────────────────────────────────────
  slack: {
    name: 'Slack',
    description: 'Push synergy alerts and digests to your channels.',
    icon: MessageSquare,
    category: 'Messaging',
    group: 'collaboration',
    connect: 'oauth'
  },
  zoom: {
    name: 'Zoom',
    description: 'Log Zoom meetings as interactions across your network.',
    icon: Video,
    category: 'Meetings',
    group: 'collaboration',
    connect: 'oauth'
  },
  google_meet: {
    name: 'Google Meet',
    description: 'Capture Meet calls as interactions on deals and contacts.',
    icon: Webcam,
    category: 'Meetings',
    group: 'collaboration',
    connect: 'oauth'
  },
  microsoft_teams: {
    name: 'Microsoft Teams',
    description: 'Log Teams meetings and channel activity as signals.',
    icon: Users,
    category: 'Meetings',
    group: 'collaboration',
    connect: 'request',
    comingSoon: true
  },

  // ── Files & storage ───────────────────────────────────────────────────
  google_drive: {
    name: 'Google Drive',
    description: 'Sync files and folders into your data room and records.',
    icon: HardDrive,
    category: 'Files',
    group: 'files',
    connect: 'oauth'
  },
  google_docs: {
    name: 'Google Docs',
    description: 'Pull in memos and notes as documents and evidence.',
    icon: FileText,
    category: 'Documents',
    group: 'files',
    connect: 'oauth'
  },
  google_slides: {
    name: 'Google Slides',
    description: 'Attach decks and pitch materials to deals and records.',
    icon: Presentation,
    category: 'Documents',
    group: 'files',
    connect: 'oauth'
  },
  onedrive: {
    name: 'OneDrive',
    description: 'Sync Microsoft 365 files into your data room and records.',
    icon: CloudUpload,
    category: 'Files',
    group: 'files',
    connect: 'request',
    comingSoon: true
  },
  dropbox: {
    name: 'Dropbox',
    description: 'Bring shared folders and deal files into your records.',
    icon: Package,
    category: 'Files',
    group: 'files',
    connect: 'request',
    comingSoon: true
  },
  box: {
    name: 'Box',
    description: 'Sync secure enterprise files into deals and data rooms.',
    icon: Box,
    category: 'Files',
    group: 'files',
    connect: 'request',
    comingSoon: true
  },
  docsend: {
    name: 'DocSend',
    description: 'Track deck views and link engagement on your raises.',
    icon: Share2,
    category: 'Document tracking',
    group: 'files',
    connect: 'request',
    comingSoon: true
  },

  // ── CRM & outreach ────────────────────────────────────────────────────
  hubspot: {
    name: 'HubSpot',
    description: 'Two-way sync of contacts, companies and deal pipeline.',
    icon: Target,
    category: 'CRM',
    group: 'crm',
    connect: 'request',
    comingSoon: true
  },
  salesforce: {
    name: 'Salesforce',
    description: 'Mirror accounts, contacts and opportunities into Earn.',
    icon: Cloud,
    category: 'CRM',
    group: 'crm',
    connect: 'request',
    comingSoon: true
  },
  apollo: {
    name: 'Apollo',
    description: 'Enrich contacts and sync outreach sequences with an API key.',
    icon: Rocket,
    category: 'Outreach',
    group: 'crm',
    connect: 'api_key'
  },

  // ── E-sign & cap table ────────────────────────────────────────────────
  docusign: {
    name: 'DocuSign',
    description: 'Track envelopes and signatures on closing documents.',
    icon: PenTool,
    category: 'E-signature',
    group: 'esign_captable',
    connect: 'request',
    comingSoon: true
  },
  carta: {
    name: 'Carta',
    description: 'Sync cap table, ownership and SAFE/round data.',
    icon: PieChart,
    category: 'Cap table',
    group: 'esign_captable',
    connect: 'request',
    comingSoon: true
  },

  // ── Knowledge & notes ─────────────────────────────────────────────────
  notion: {
    name: 'Notion',
    description: 'Pull pages and databases in as documents and notes.',
    icon: NotebookPen,
    category: 'Knowledge',
    group: 'knowledge',
    connect: 'request',
    comingSoon: true
  },
  airtable: {
    name: 'Airtable',
    description: 'Sync bases of contacts, deals and pipeline records.',
    icon: Table2,
    category: 'Knowledge',
    group: 'knowledge',
    connect: 'request',
    comingSoon: true
  },
  granola: {
    name: 'Granola',
    description: 'Capture AI meeting notes and action items as signals.',
    icon: Mic,
    category: 'Meeting notes',
    group: 'knowledge',
    connect: 'request',
    comingSoon: true
  },
  read_ai: {
    name: 'Read AI',
    description: 'Bring meeting summaries and engagement metrics into Earn.',
    icon: Sparkles,
    category: 'Meeting notes',
    group: 'knowledge',
    connect: 'request',
    comingSoon: true
  },
  otter: {
    name: 'Otter',
    description: 'Sync call transcripts and notes onto deals and contacts.',
    icon: AudioLines,
    category: 'Transcripts',
    group: 'knowledge',
    connect: 'request',
    comingSoon: true
  }
};

export const PROVIDER_ORDER: Provider[] = [
  // Email & calendar
  'gmail',
  'google_calendar',
  'calendly',
  'outlook',
  // Collaboration
  'slack',
  'zoom',
  'google_meet',
  'microsoft_teams',
  // Files & storage
  'google_drive',
  'google_docs',
  'google_slides',
  'onedrive',
  'dropbox',
  'box',
  'docsend',
  // CRM & outreach
  'hubspot',
  'salesforce',
  'apollo',
  // E-sign & cap table
  'docusign',
  'carta',
  // Knowledge & notes
  'notion',
  'airtable',
  'granola',
  'read_ai',
  'otter'
];

export interface IntegrationView {
  provider: Provider;
  status: ConnectionStatus;
  external_account: string | null;
  last_synced_at: string | null;
  available: boolean;
  /** True when the member has already requested early access (comingSoon only). */
  requested: boolean;
  /** Persisted per-connection sync cadence; null until a row exists. */
  sync_frequency: string | null;
}

/**
 * A provider is "available" (shows a live Connect/Sync control) when it has a
 * real connect path wired. Catalogued-but-not-yet-wired providers
 * (`comingSoon`) surface "Request access" instead. Wired providers that still
 * need server-side credentials (Slack/Calendly/Zoom OAuth client id + secret,
 * the Google Workspace file scopes) surface a clear error on connect until
 * those are set — they remain "available" here.
 */
export function providerAvailable(provider: Provider): boolean {
  return !PROVIDER_META[provider].comingSoon;
}

/**
 * Merge DB rows with the static catalog so every known provider renders.
 * `requestedProviders` marks which comingSoon providers the member has already
 * requested early access for, so the card shows a durable "Requested" state.
 */
export function mergeConnections(
  rows: ProviderConnection[],
  requestedProviders: Iterable<string> = []
): IntegrationView[] {
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  const requested = new Set(requestedProviders);
  return PROVIDER_ORDER.map((provider) => {
    const row = byProvider.get(provider);
    return {
      provider,
      status: row?.status ?? 'disconnected',
      external_account: row?.external_account ?? null,
      last_synced_at: row?.last_synced_at ?? null,
      available: providerAvailable(provider),
      requested: requested.has(provider),
      sync_frequency: row?.sync_frequency ?? null
    };
  });
}

export interface IntegrationGroupView {
  group: IntegrationGroupMeta;
  items: IntegrationView[];
}

/** Bucket merged connections by their provider group, preserving GROUP_ORDER. */
export function groupConnections(views: IntegrationView[]): IntegrationGroupView[] {
  return GROUP_ORDER.map((group) => ({
    group,
    items: views.filter((v) => PROVIDER_META[v.provider].group === group.id)
  })).filter((g) => g.items.length > 0);
}

/** Relative "synced Xm ago" label (or "Never synced"). */
export function syncedLabel(iso: string | null): string {
  if (!iso) return 'Never synced';
  const ts = new Date(iso).getTime();
  if (Number.isNaN(ts)) return 'Never synced';
  const mins = Math.max(0, Math.round((Date.now() - ts) / 60_000));
  if (mins < 60) return `Synced ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Synced ${hrs}h ago`;
  return `Synced ${Math.round(hrs / 24)}d ago`;
}
