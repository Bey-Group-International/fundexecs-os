import Link from 'next/link';
import { AlertTriangle, AlertCircle, Info, ArrowUpRight } from 'lucide-react';
import { Badge, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { MajorAlert } from '@/lib/queries/dashboard';

const SEVERITY_META: Record<
  MajorAlert['severity'],
  { tone: BadgeTone; icon: typeof AlertCircle; color: string }
> = {
  critical: { tone: 'danger', icon: AlertTriangle, color: 'var(--danger)' },
  warning: { tone: 'warning', icon: AlertCircle, color: 'var(--warning)' },
  info: { tone: 'azure', icon: Info, color: 'var(--accent)' }
};

export interface MajorAlertsCardProps {
  alerts: MajorAlert[];
  className?: string;
}

/**
 * MajorAlertsCard — the top items needing attention now. Severity drives the
 * leading dot + icon disc tone (critical · warning · info). Every alert is a
 * link to the surface that resolves it. Empty state stays calm — no false
 * alarm when nothing is wrong.
 */
export function MajorAlertsCard({ alerts, className }: MajorAlertsCardProps) {
  return (
    <Card className={cn('p-5', className)} data-testid="major-alerts-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle eyebrow="Top of mind" title="Major alerts" />
        {alerts.length > 0 ? (
          <Badge tone="warning" dot className="text-[10px]">
            {alerts.length}
          </Badge>
        ) : (
          <Badge tone="success" dot className="text-[10px]">
            Clear
          </Badge>
        )}
      </div>

      {alerts.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-surface-1 px-4 py-6 text-center">
          <p className="text-[12.5px] font-medium text-fg-2">Nothing critical right now.</p>
          <p className="mt-0.5 text-[11px] text-fg-4">
            Your desk is on the record · documented as it forms.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {alerts.map((alert) => {
            const meta = SEVERITY_META[alert.severity];
            const Icon = meta.icon;
            return (
              <li key={alert.id}>
                <Link
                  href={alert.href}
                  data-testid={`major-alert-${alert.id}`}
                  className="group flex items-start gap-3 rounded-xl border border-hairline bg-bg-1 px-3 py-2.5 transition-[background,transform,box-shadow] hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-[var(--shadow-sm)]"
                >
                  <span
                    aria-hidden
                    className="flex h-8 w-8 flex-none items-center justify-center rounded-lg border bg-bg-1"
                    style={{ color: meta.color, borderColor: meta.color }}
                  >
                    <Icon size={15} strokeWidth={2} aria-hidden />
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <Badge tone={meta.tone} className="text-[9.5px] uppercase">
                        {alert.severity}
                      </Badge>
                      <p className="truncate text-[12.5px] font-semibold text-fg-1">
                        {alert.title}
                      </p>
                    </div>
                    <p className="mt-0.5 text-[11.5px] text-fg-3">{alert.detail}</p>
                  </div>
                  <ArrowUpRight
                    size={13}
                    strokeWidth={2}
                    className="mt-1 flex-none text-fg-4 transition-transform group-hover:translate-x-0.5 group-hover:text-azure-1"
                    aria-hidden
                  />
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
