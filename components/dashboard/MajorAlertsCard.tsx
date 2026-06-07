'use client';

import { useState, useTransition } from 'react';
import Link from 'next/link';
import { AlertTriangle, AlertCircle, Info, ArrowUpRight, X } from 'lucide-react';
import { Badge, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/utils';
import { dismissAlert } from '@/lib/actions/dashboard';
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
 * leading dot + icon disc tone (critical · warning · info). Every alert links
 * to the surface that resolves it, and can be **dismissed inline** (optimistic
 * UI → `dismissAlert` server action → cookie). Empty state stays calm.
 */
export function MajorAlertsCard({ alerts, className }: MajorAlertsCardProps) {
  const [hidden, setHidden] = useState<Set<string>>(new Set());
  const [, startTransition] = useTransition();

  const visible = alerts.filter((a) => !hidden.has(a.id));

  function handleDismiss(id: string) {
    setHidden((prev) => new Set(prev).add(id)); // optimistic
    startTransition(() => {
      void dismissAlert(id);
    });
  }

  return (
    <Card className={cn('p-5', className)} data-testid="major-alerts-card">
      <div className="mb-3 flex items-center justify-between gap-3">
        <SectionTitle eyebrow="Top of mind" title="Major alerts" />
        {visible.length > 0 ? (
          <Badge tone="warning" dot className="text-[10px]">
            {visible.length}
          </Badge>
        ) : (
          <Badge tone="success" dot className="text-[10px]">
            Clear
          </Badge>
        )}
      </div>

      {visible.length === 0 ? (
        <div className="rounded-xl border border-dashed border-hairline bg-surface-1 px-4 py-6 text-center">
          <p className="text-[12.5px] font-medium text-fg-2">Nothing critical right now.</p>
          <p className="mt-0.5 text-[11px] text-fg-4">
            Your desk is on the record · documented as it forms.
          </p>
        </div>
      ) : (
        <ul className="flex flex-col gap-1.5">
          {visible.map((alert) => {
            const meta = SEVERITY_META[alert.severity];
            const Icon = meta.icon;
            return (
              <li
                key={alert.id}
                className="group relative flex items-stretch rounded-xl border border-hairline bg-bg-1 transition-[background,transform,box-shadow] hover:-translate-y-0.5 hover:bg-surface-2 hover:shadow-[var(--shadow-sm)]"
              >
                <Link
                  href={alert.href}
                  data-testid={`major-alert-${alert.id}`}
                  className="flex min-w-0 flex-1 items-start gap-3 px-3 py-2.5"
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
                <button
                  type="button"
                  onClick={() => handleDismiss(alert.id)}
                  data-testid={`major-alert-dismiss-${alert.id}`}
                  aria-label={`Dismiss alert: ${alert.title}`}
                  className="flex w-9 flex-none items-center justify-center rounded-r-xl border-l border-hairline text-fg-5 transition-colors hover:bg-surface-2 hover:text-fg-2"
                >
                  <X size={13} strokeWidth={2.2} aria-hidden />
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </Card>
  );
}
