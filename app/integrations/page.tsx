import type { Metadata } from 'next';
import {
  Mail,
  Calendar,
  CalendarClock,
  MessageSquare,
  Rocket,
  Inbox,
  Check,
  RefreshCw,
  Plus,
  type LucideIcon
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { Badge, Button, Card, SectionTitle } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getIntegrationConnections, type ProviderConnection } from '@/lib/queries/integrations';

export const metadata: Metadata = { title: 'Integrations' };

type Provider = 'gmail' | 'google_calendar' | 'calendly' | 'slack' | 'apollo' | 'outlook';
type ConnectionStatus = ProviderConnection['status'];

interface ProviderMeta {
  name: string;
  description: string;
  icon: LucideIcon;
  category: string;
}

/* Static provider catalog — the known integrations we surface. */
const PROVIDER_META: Record<Provider, ProviderMeta> = {
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
  apollo: {
    name: 'Apollo',
    description: 'Enrich contacts with firmographic and role data.',
    icon: Rocket,
    category: 'Enrichment'
  },
  outlook: {
    name: 'Outlook',
    description: 'Sync Microsoft 365 mail and calendar activity.',
    icon: Inbox,
    category: 'Email'
  }
};

const PROVIDER_ORDER: Provider[] = [
  'gmail',
  'google_calendar',
  'calendly',
  'slack',
  'apollo',
  'outlook'
];

interface IntegrationView {
  provider: Provider;
  status: ConnectionStatus;
  external_account: string | null;
  last_synced_at: string | null;
}

function syncedLabel(iso: string | null): string {
  if (!iso) return 'Never synced';
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60_000));
  if (mins < 60) return `Synced ${mins}m ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `Synced ${hrs}h ago`;
  return `Synced ${Math.round(hrs / 24)}d ago`;
}

function IntegrationCard({ conn }: { conn: IntegrationView }) {
  const meta = PROVIDER_META[conn.provider];
  const Icon = meta.icon;
  const connected = conn.status === 'connected';
  const error = conn.status === 'error';

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-hairline bg-surface-2 text-fg-2">
          <Icon size={20} strokeWidth={1.9} aria-hidden />
        </span>
        {connected ? (
          <Badge tone="success" dot>
            Connected
          </Badge>
        ) : error ? (
          <Badge tone="danger" dot>
            Needs attention
          </Badge>
        ) : (
          <Badge tone="neutral">Not connected</Badge>
        )}
      </div>

      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <h3 className="text-[14.5px] font-semibold text-fg-1">{meta.name}</h3>
          <span className="text-[10.5px] font-medium uppercase tracking-[0.08em] text-fg-5">
            {meta.category}
          </span>
        </div>
        <p className="mt-1 text-[12px] leading-snug text-fg-4">{meta.description}</p>
      </div>

      <div className="flex items-center justify-between border-t border-hairline pt-3.5">
        <div className="min-w-0">
          {conn.external_account ? (
            <div className="truncate text-[12px] font-medium text-fg-2">
              {conn.external_account}
            </div>
          ) : (
            <div className="text-[12px] text-fg-5">No account linked</div>
          )}
          <div className="text-[11px] tabular-nums text-fg-5">
            {syncedLabel(conn.last_synced_at)}
          </div>
        </div>
        {connected ? (
          <Button variant="secondary" size="sm" icon={Check}>
            Manage
          </Button>
        ) : error ? (
          <Button variant="secondary" size="sm" icon={RefreshCw}>
            Reconnect
          </Button>
        ) : (
          <Button variant="primary" size="sm" icon={Plus}>
            Connect
          </Button>
        )}
      </div>
    </Card>
  );
}

/** Merge DB rows with the static catalog so every known provider renders. */
function mergeConnections(rows: ProviderConnection[]): IntegrationView[] {
  const byProvider = new Map(rows.map((r) => [r.provider, r]));
  return PROVIDER_ORDER.map((provider) => {
    const row = byProvider.get(provider);
    return {
      provider,
      status: row?.status ?? 'disconnected',
      external_account: row?.external_account ?? null,
      last_synced_at: row?.last_synced_at ?? null
    };
  });
}

export default async function IntegrationsPage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AppShell
        title="Integrations"
        subtitle="Connect your tools to power relationship intelligence"
      >
        <Card className="p-10 text-center">
          <h2 className="text-[15px] font-semibold text-fg-1">No organization yet</h2>
          <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
            Join or create an organization to connect Gmail, Calendar, Slack and more.
          </p>
        </Card>
      </AppShell>
    );
  }

  const rows = await getIntegrationConnections(org.orgId, org.userId);
  const connections = mergeConnections(rows);
  const connectedCount = connections.filter((c) => c.status === 'connected').length;

  return (
    <AppShell title="Integrations" subtitle="Connect your tools to power relationship intelligence">
      <SectionTitle
        eyebrow={`${connectedCount} of ${connections.length} connected`}
        title="Integrations"
      />
      <div className="grid gap-3.5 sm:grid-cols-2 lg:grid-cols-3">
        {connections.map((c) => (
          <IntegrationCard key={c.provider} conn={c} />
        ))}
      </div>
    </AppShell>
  );
}
