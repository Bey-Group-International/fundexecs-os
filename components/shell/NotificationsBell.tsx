'use client';

import { useCallback, useEffect, useRef, useState, useTransition } from 'react';
import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { Bell, CheckCheck, Loader2 } from 'lucide-react';
import { cn } from '@/lib/utils';
import { markAllNotificationsRead, markNotificationRead } from '@/lib/actions/notifications';
import type { NotificationItem } from '@/lib/queries/notifications';

/* ============================================================================
 * NotificationsBell — the top-nav alerts bell, as a dropdown (not a route jump).
 *
 * Click opens a popover that lazy-fetches the latest notifications from
 * `/api/notifications`. Items show unread state + relative time; clicking one
 * marks it read and follows its `href` (or the inbox). "Mark all read" and a
 * "View all" footer link to the full /notifications page round it out.
 * ========================================================================= */

export function NotificationsBell({ initialUnread }: { initialUnread: number }) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [items, setItems] = useState<NotificationItem[]>([]);
  const [unread, setUnread] = useState(initialUnread);
  const [, startTransition] = useTransition();

  // Fetch the latest notifications (kept out of the effect body so the load
  // happens via a callback, not synchronous state-setting on mount).
  const load = useCallback(async () => {
    setLoading(true);
    try {
      const r = await fetch('/api/notifications', { cache: 'no-store' });
      const d: { items?: NotificationItem[]; unreadCount?: number } = r.ok
        ? await r.json()
        : { items: [], unreadCount: 0 };
      setItems(Array.isArray(d.items) ? d.items : []);
      setUnread(d.unreadCount ?? 0);
      setLoaded(true);
    } catch {
      // Keep whatever we had; the badge + "View all" still work.
    } finally {
      setLoading(false);
    }
  }, []);

  // Toggle the dropdown; lazy-load the latest when opening (kept off `useEffect`
  // so we never set state synchronously inside an effect).
  function toggle() {
    const willOpen = !open;
    setOpen(willOpen);
    if (willOpen) void load();
  }

  // Click-outside + Esc close.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === 'Escape') setOpen(false);
    }
    document.addEventListener('mousedown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('mousedown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  function openItem(n: NotificationItem) {
    if (!n.read) {
      setItems((xs) => xs.map((x) => (x.id === n.id ? { ...x, read: true } : x)));
      setUnread((u) => Math.max(0, u - 1));
      startTransition(() => {
        void markNotificationRead(n.id);
      });
    }
    setOpen(false);
    router.push(n.href ?? '/notifications');
  }

  function markAll() {
    if (unread === 0) return;
    setItems((xs) => xs.map((x) => ({ ...x, read: true })));
    setUnread(0);
    startTransition(() => {
      void markAllNotificationsRead();
    });
  }

  const badge = unread > 9 ? '9+' : String(unread);

  return (
    <div ref={wrapRef} className="relative flex-none">
      <button
        type="button"
        onClick={toggle}
        aria-haspopup="menu"
        aria-expanded={open}
        aria-label={unread > 0 ? `Notifications, ${unread} unread` : 'Notifications'}
        data-testid="topnav-notifications-bell"
        className={cn(
          'relative flex h-[38px] w-[38px] items-center justify-center rounded-[10px] border border-hairline bg-surface-1 text-fg-3 transition-[background,box-shadow] hover:bg-surface-2 hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1',
          open && 'bg-surface-2 text-fg-1'
        )}
      >
        <Bell size={17} strokeWidth={1.9} aria-hidden />
        {unread > 0 ? (
          <span
            data-testid="topnav-unread-badge"
            className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-bg-0 bg-azure-1 px-1 text-[10px] font-bold text-white"
          >
            {badge}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          role="menu"
          aria-label="Notifications"
          data-testid="topnav-notifications-popover"
          className="absolute right-0 top-full z-50 mt-2 w-80 overflow-hidden rounded-2xl border border-hairline bg-bg-1 shadow-[var(--shadow-lg)] motion-safe:animate-in motion-safe:fade-in motion-safe:slide-in-from-top-1 motion-safe:duration-100"
        >
          {/* Header */}
          <div className="flex items-center justify-between border-b border-hairline px-4 py-3">
            <span className="text-[13px] font-semibold text-fg-1">
              Notifications
              {unread > 0 ? (
                <span className="ml-1.5 text-[11.5px] text-fg-4">{unread} new</span>
              ) : null}
            </span>
            {unread > 0 ? (
              <button
                type="button"
                onClick={markAll}
                className="inline-flex items-center gap-1 text-[11.5px] font-medium text-azure-1 transition hover:brightness-110"
              >
                <CheckCheck size={13} strokeWidth={2} aria-hidden />
                Mark all read
              </button>
            ) : null}
          </div>

          {/* Body */}
          <div className="max-h-[min(60vh,420px)] overflow-y-auto">
            {loading && !loaded ? (
              <div className="flex items-center justify-center gap-2 px-4 py-8 text-[12px] text-fg-4">
                <Loader2 size={14} strokeWidth={2} className="animate-spin" aria-hidden />
                Loading…
              </div>
            ) : items.length === 0 ? (
              <div className="px-4 py-8 text-center text-[12.5px] text-fg-4">
                You&apos;re all caught up.
              </div>
            ) : (
              <ul className="flex flex-col">
                {items.map((n) => (
                  <li key={n.id}>
                    <button
                      type="button"
                      onClick={() => openItem(n)}
                      className="flex w-full items-start gap-2.5 border-b border-hairline px-4 py-3 text-left transition last:border-b-0 hover:bg-surface-1"
                    >
                      <span
                        className={cn(
                          'mt-1.5 h-1.5 w-1.5 flex-none rounded-full',
                          n.read ? 'bg-transparent' : 'bg-azure-1'
                        )}
                        aria-hidden
                      />
                      <span className="min-w-0 flex-1">
                        <span className="flex items-center justify-between gap-2">
                          <span
                            className={cn(
                              'truncate text-[12.5px]',
                              n.read ? 'font-medium text-fg-2' : 'font-semibold text-fg-1'
                            )}
                          >
                            {n.title}
                          </span>
                          <span className="flex-none text-[10.5px] tabular-nums text-fg-5">
                            {n.time}
                          </span>
                        </span>
                        {n.body ? (
                          <span className="mt-0.5 line-clamp-2 block text-[11.5px] leading-snug text-fg-4">
                            {n.body}
                          </span>
                        ) : null}
                      </span>
                    </button>
                  </li>
                ))}
              </ul>
            )}
          </div>

          {/* Footer */}
          <div className="border-t border-hairline px-2 py-2">
            <Link
              href="/notifications"
              onClick={() => setOpen(false)}
              className="flex items-center justify-center rounded-[10px] px-3 py-2 text-[12.5px] font-medium text-fg-2 transition hover:bg-surface-1 hover:text-fg-1"
            >
              View all notifications
            </Link>
          </div>
        </div>
      ) : null}
    </div>
  );
}

export default NotificationsBell;
