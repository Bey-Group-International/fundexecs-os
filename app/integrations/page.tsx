import type { Metadata } from 'next';
import {
  Mail,
  Calendar,
  CalendarClock,
  MessageSquare,
  Rocket,
  HardDrive,
  FileText,
  Presentation,
  PlugZap,
  CheckCircle2,
  AlertTriangle,
  type LucideIcon
} from 'lucide-react';
import { AppShell } from '@/components/shell/AppShell';
import { getShellIdentity } from '@/lib/queries/identity';
import { Badge, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { ConnectButton } from '@/components/integrations/ConnectButton';
import { getActiveOrg } from '@/lib/queries/org';
import { getIntegrationConnections, type ProviderConnection } from '@/lib/queries/integrations';

export const metadata: Metadata = { title: 'Integrations' };

type Provider =
  | 'gmail'
  | 'google_calendar'
  | 'google_drive'
  | 'google_docs'
  | 'google_slides'
  | 'calendly'
  | 'slack'
  | 'apollo';
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
  }
};

const PROVIDER_ORDER: Provider[] = [
  'gmail',
  'google_calendar',
  'google_drive',
  'google_docs',
  'google_slides',
  'calendly',
  'slack',
  'apollo'
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

const TONE_HEX: Record<BadgeTone, string> = {
  neutral: 'var(--fg-4)',
  gold: 'var(--gold-1)',
  azure: 'var(--azure-1)',
  success: 'var(--success)',
  warning: 'var(--warning)',
  danger: 'var(--danger)',
  info: 'var(--info)'
};

interface SummaryStat {
  label: string;
  value: number;
  icon: LucideIcon;
  tone: BadgeTone;
}

function SummaryCard({ stat }: { stat: SummaryStat }) {
  const Icon = stat.icon;
  return (
    <Card className="flex items-center gap-3.5 p-4">
      <span
        className="flex h-10 w-10 flex-none items-center justify-center rounded-xl border"
        style={{
          color: TONE_HEX[stat.tone],
          background: `var(--${stat.tone}-soft, var(--surface-2))`,
          borderColor: `var(--${stat.tone}-line, var(--border))`
        }}
      >
        <Icon size={18} strokeWidth={1.9} aria-hidden />
      </span>
      <div>
        <div className="text-[22px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-fg-1">
          {stat.value}
        </div>
        <div className="mt-1.5 text-[11.5px] text-fg-4">{stat.label}</div>
      </div>
    </Card>
  );
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
        <ConnectButton provider={conn.provider} connected={connected} />
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
  const attentionCount = connections.filter((c) => c.status === 'error').length;
  const notConnectedCount = connections.filter((c) => c.status === 'disconnected').length;

  const summary: SummaryStat[] = [
    { label: 'Connected', value: connectedCount, icon: CheckCircle2, tone: 'success' },
    { label: 'Needs attention', value: attentionCount, icon: AlertTriangle, tone: 'danger' },
    { label: 'Not connected', value: notConnectedCount, icon: PlugZap, tone: 'neutral' }
  ];

  return (
    <AppShell
      identity={await getShellIdentity()}
      title="Integrations"
      subtitle="Connect your tools to power relationship intelligence"
    >
      <div className="mb-[18px] grid grid-cols-3 gap-3.5">
        {summary.map((s) => (
          <SummaryCard key={s.label} stat={s} />
        ))}
      </div>

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
