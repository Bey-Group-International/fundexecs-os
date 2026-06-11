import type { Provider } from './catalog';
import type { ProviderConnection } from '@/lib/queries/integrations';

/* ============================================================================
 * lib/integrations/providers.ts — the PURE, icon-free core of the integrations
 * catalog: provider order, the availability fact, and the view-merge logic the
 * /integrations and /settings loaders depend on.
 *
 * This split exists so the merge logic is unit-testable. The display catalog
 * (`catalog.ts`) imports lucide-react icons, which trips `react.createContext`
 * under the `--conditions=react-server` test runner — so anything that imports
 * it can't be tested there. Everything here is plain data + functions with no
 * React/icon dependency; `catalog.ts` re-exports it so existing import sites are
 * unchanged.
 * ========================================================================= */

export type ConnectionStatus = ProviderConnection['status'];

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

/** Display + merge order for every known provider, grouped by category. */
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

/**
 * Single source of truth for availability: `true` = catalogued but not yet
 * wired (renders "Request access"), `false` = a real connect/sync path exists.
 * Typed as `Record<Provider, boolean>` so the compiler forces an entry for
 * every provider — a new provider can't silently default to "available".
 */
export const PROVIDER_COMING_SOON: Record<Provider, boolean> = {
  gmail: false,
  google_calendar: false,
  calendly: false,
  outlook: true,
  slack: false,
  zoom: false,
  google_meet: false,
  microsoft_teams: true,
  google_drive: false,
  google_docs: false,
  google_slides: false,
  onedrive: true,
  dropbox: true,
  box: true,
  docsend: true,
  hubspot: true,
  salesforce: true,
  apollo: false,
  docusign: true,
  carta: true,
  notion: true,
  airtable: true,
  granola: true,
  read_ai: true,
  otter: true
};

/**
 * A provider is "available" (shows a live Connect/Sync control) when it has a
 * real connect path wired. Catalogued-but-not-yet-wired providers
 * (`comingSoon`) surface "Request access" instead. Wired providers that still
 * need server-side credentials (Slack/Calendly/Zoom OAuth client id + secret,
 * the Google Workspace file scopes) surface a clear error on connect until
 * those are set — they remain "available" here.
 */
export function providerAvailable(provider: Provider): boolean {
  return !PROVIDER_COMING_SOON[provider];
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
