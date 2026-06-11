'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useState } from 'react';
import { ArrowRight, Bell, Check, CheckCheck, Loader2, TriangleAlert, X } from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Button } from '@/components/ui/Button';
import { Card } from '@/components/ui/Card';
import {
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead
} from '@/lib/actions/notifications';
import type { NotificationItem } from '@/lib/queries/notifications';
import { cn } from '@/lib/utils';

/** The notifications inbox — real rows, real reads, every CTA same-origin. */
export function NotificationsList({ items: initialItems }: { items: NotificationItem[] }) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const unread = items.filter((i) => !i.read).length;

  async function run(id: string, fn: () => Promise<{ ok: boolean }>, apply: () => void) {
    setPending(id);
    setError(null);
    try {
      const res = await fn();
      if (res.ok) {
        apply();
        router.refresh();
      } else {
        setError('Could not update the notification — try again.');
      }
    } catch {
      setError('Could not update the notification — check your connection and try again.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-center gap-3 p-5">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
          <Bell size={22} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">Notifications</h1>
          <p className="mt-0.5 text-[12.5px] text-fg-3">
            What the team surfaced for you — every item links straight to the surface it lives on.
          </p>
        </div>
        {unread > 0 && (
          <Button
            variant="secondary"
            size="sm"
            icon={pending === 'all' ? Loader2 : CheckCheck}
            disabled={pending === 'all'}
            onClick={() =>
              void run(
                'all',
                () => markAllNotificationsRead(),
                () => setItems((prev) => prev.map((i) => ({ ...i, read: true })))
              )
            }
          >
            Mark all read
          </Button>
        )}
      </Card>

      {error && (
        <div className="flex items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger">
          <TriangleAlert size={15} aria-hidden />
          {error}
        </div>
      )}

      {items.length === 0 ? (
        <Card className="p-8 text-center">
          <Bell size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">All clear</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            Nothing needs you right now. As the team works — diligence verdicts, intro replies,
            deliverables coming due — it lands here.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {items.map((n) => (
            <Card
              key={n.id}
              className={cn('flex items-start gap-3 p-4', !n.read && 'border-[var(--azure-line)]')}
            >
              <span
                className={cn(
                  'mt-1 h-2 w-2 flex-none rounded-full',
                  n.read ? 'bg-surface-3' : 'bg-azure-1'
                )}
                aria-hidden
              />
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2">
                  <span className="text-[13px] font-semibold text-fg-1">{n.title}</span>
                  <Badge tone="neutral" className="px-1.5 py-0 text-[9px]">
                    {n.category}
                  </Badge>
                  <span className="text-[10.5px] text-fg-5">{n.time}</span>
                </div>
                {n.body && <p className="mt-1 text-[12.5px] leading-relaxed text-fg-3">{n.body}</p>}
                {n.href && (
                  <Link
                    href={n.href}
                    className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-azure-1"
                  >
                    Take action
                    <ArrowRight size={12} strokeWidth={2} aria-hidden />
                  </Link>
                )}
              </div>
              <div className="flex flex-none items-center gap-1">
                {!n.read && (
                  <button
                    type="button"
                    title="Mark read"
                    aria-label={`Mark "${n.title}" read`}
                    disabled={pending === n.id}
                    onClick={() =>
                      void run(
                        n.id,
                        () => markNotificationRead(n.id),
                        () =>
                          setItems((prev) =>
                            prev.map((i) => (i.id === n.id ? { ...i, read: true } : i))
                          )
                      )
                    }
                    className="flex h-7 w-7 items-center justify-center rounded-lg border border-hairline text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
                  >
                    {pending === n.id ? (
                      <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden />
                    ) : (
                      <Check size={13} aria-hidden />
                    )}
                  </button>
                )}
                <button
                  type="button"
                  title="Dismiss"
                  aria-label={`Dismiss "${n.title}"`}
                  disabled={pending === n.id}
                  onClick={() =>
                    void run(
                      n.id,
                      () => dismissNotification(n.id),
                      () => setItems((prev) => prev.filter((i) => i.id !== n.id))
                    )
                  }
                  className="flex h-7 w-7 items-center justify-center rounded-lg border border-hairline text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
                >
                  <X size={13} aria-hidden />
                </button>
              </div>
            </Card>
          ))}
        </div>
      )}
    </div>
  );
}
