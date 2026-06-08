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
  type LucideIcon
} from 'lucide-react';
import type { ProviderConnection } from '@/lib/queries/integrations';

/* ============================================================================
 * lib/integrations/catalog.ts — the static provider catalog + view helpers,
 * shared by the standalone /integrations page and the Settings → Integrations
 * section so both render the identical set of providers and statuses.
 * ========================================================================= */

export type Provider =
  | 'gmail'
  | 'google_calendar'
  | 'google_drive'
  | 'google_docs'
  | 'google_slides'
  | 'calendly'
  | 'slack'
  | 'zoom'
  | 'google_meet';

export type ConnectionStatus = ProviderConnection['status'];

export interface ProviderMeta {
  name: string;
  description: string;
  icon: LucideIcon;
  category: string;
}

/** Known integrations we surface, with display metadata. */
export const PROVIDER_META: Record<Provider, ProviderMeta> = {
  gmail: {
    name: 'Gmail',
    description: 'Sync email threads to enrich relationship warmth.',
    icon: Mail,
    category: 'Email'
  },
  google_calendar: {
    name: 'Google Calendar',
    description: 'Log meetings as interactions across your network.',
    icon: Calendar,
    category: 'Calendar'
  },
  calendly: {
    name: 'Calendly',
    description: 'Capture booked calls and route them to deals.',
    icon: CalendarClock,
    category: 'Scheduling'
  },
  slack: {
    name: 'Slack',
    description: 'Push synergy alerts and digests to your channels.',
    icon: MessageSquare,
    category: 'Messaging'
  },
  google_drive: {
    name: 'Google Drive',
    description: 'Sync files and folders into your data room and records.',
    icon: HardDrive,
    category: 'Files'
  },
  google_docs: {
    name: 'Google Docs',
    description: 'Pull in memos and notes as documents and evidence.',
    icon: FileText,
    category: 'Documents'
  },
  google_slides: {
    name: 'Google Slides',
    description: 'Attach decks and pitch materials to deals and records.',
    icon: Presentation,
    category: 'Documents'
  },
  zoom: {
    name: 'Zoom',
    description: 'Log Zoom meetings as interactions across your network.',
    icon: Video,
    category: 'Meetings'
  },
  google_meet: {
    name: 'Google Meet',
    description: 'Capture Meet calls as interactions on deals and contacts.',
    icon: Webcam,
    category: 'Meetings'
  }
};

export const PROVIDER_ORDER: Provider[] = [
  'gmail',
  'google_calendar',
  'google_drive',
  'google_docs',
  'google_slides',
  'calendly',
  'slack',
  'zoom',
  'google_meet'
];

export interface IntegrationView {
  provider: Provider;
  status: ConnectionStatus;
  external_account: string | null;
  last_synced_at: string | null;
  available: boolean;
}

/**
 * All integrations are activated — every card shows "Connect". Providers that
 * still need server-side credentials surface a clear error on connect until
 * those are set (Slack/Calendly/Zoom OAuth client id + secret; the Google
 * Workspace file scopes additionally need OAuth-app verification).
 */
export function providerAvailable(_provider: Provider): boolean {
  return true;
}

/** Merge DB rows with the static catalog so every known provider renders. */
export function mergeConnections(rows: ProviderConnection[]): IntegrationView[] {
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return PROVIDER_ORDER.map((provider) => {
    const row = byProvider.get(provider);
    return {
      provider,
      status: row?.status ?? 'disconnected',
      external_account: row?.external_account ?? null,
      last_synced_at: row?.last_synced_at ?? null,
      available: providerAvailable(provider)
    };
  });
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
