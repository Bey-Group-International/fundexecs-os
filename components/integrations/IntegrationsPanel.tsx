import { AlertTriangle, CheckCircle2, PlugZap, type LucideIcon } from 'lucide-react';
import { Badge, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { ConnectButton } from '@/components/integrations/ConnectButton';
import { PROVIDER_META, syncedLabel, type IntegrationView } from '@/lib/integrations/catalog';

/* ============================================================================
 * IntegrationsPanel — the provider grid + status summary, shared by the
 * standalone /integrations page and the Settings → Integrations section.
 * Presentational: callers fetch + merge connections and pass them in.
 * `variant` tunes the grid density for the narrower Settings pane.
 * ========================================================================= */

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
    <Card className="flex items-center gap-3 p-3.5">
      <span
        className="flex h-9 w-9 flex-none items-center justify-center rounded-xl border"
        style={{
          color: TONE_HEX[stat.tone],
          background: `var(--${stat.tone}-soft, var(--surface-2))`,
          borderColor: `var(--${stat.tone}-line, var(--border))`
        }}
      >
        <Icon size={16} strokeWidth={1.9} aria-hidden />
      </span>
      <div>
        <div className="text-[19px] font-semibold tabular-nums leading-none tracking-[-0.02em] text-fg-1">
          {stat.value}
        </div>
        <div className="mt-1 text-[11px] text-fg-4">{stat.label}</div>
      </div>
    </Card>
  );
}

function IntegrationCard({ conn }: { conn: IntegrationView }) {
  const meta = PROVIDER_META[conn.provider];
  const Icon = meta.icon;
  const connected = conn.status === 'connected';
  const error = conn.status === 'error';
  const available = conn.available;

  return (
    <Card className="flex flex-col gap-4 p-5">
      <div className="flex items-start justify-between gap-3">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-xl border border-hairline bg-surface-2 text-fg-2">
          <Icon size={20} strokeWidth={1.9} aria-hidden />
        </span>
        {!available ? (
          <Badge tone="info">Coming soon</Badge>
        ) : connected ? (
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
            {available ? syncedLabel(conn.last_synced_at) : 'Available soon'}
          </div>
        </div>
        {available ? (
          <ConnectButton provider={conn.provider} connected={connected} />
        ) : (
          <span className="rounded-xl border border-hairline bg-surface-2 px-3 py-1.5 text-[12px] font-medium text-fg-5">
            Coming soon
          </span>
        )}
      </div>
    </Card>
  );
}

export function IntegrationsPanel({
  connections,
  variant = 'page'
}: {
  connections: IntegrationView[];
  /** 'page' = wide standalone page (up to 3 cols); 'settings' = narrow pane (2 cols). */
  variant?: 'page' | 'settings';
}) {
  const connectedCount = connections.filter((c) => c.status === 'connected').length;
  const attentionCount = connections.filter((c) => c.status === 'error').length;
  const notConnectedCount = connections.filter((c) => c.status === 'disconnected').length;

  const summary: SummaryStat[] = [
    { label: 'Connected', value: connectedCount, icon: CheckCircle2, tone: 'success' },
    { label: 'Needs attention', value: attentionCount, icon: AlertTriangle, tone: 'danger' },
    { label: 'Not connected', value: notConnectedCount, icon: PlugZap, tone: 'neutral' }
  ];

  const gridCols =
    variant === 'settings'
      ? 'grid-cols-1 sm:grid-cols-2'
      : 'grid-cols-1 sm:grid-cols-2 lg:grid-cols-3';

  return (
    <div>
      <div className="mb-[18px] grid grid-cols-3 gap-3">
        {summary.map((s) => (
          <SummaryCard key={s.label} stat={s} />
        ))}
      </div>

      <SectionTitle
        eyebrow={`${connectedCount} of ${connections.length} connected`}
        title="Integrations"
      />
      <div className={`grid gap-3.5 ${gridCols}`}>
        {connections.map((c) => (
          <IntegrationCard key={c.provider} conn={c} />
        ))}
      </div>
    </div>
  );
}

export default IntegrationsPanel;
