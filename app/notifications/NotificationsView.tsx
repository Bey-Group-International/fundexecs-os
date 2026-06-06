'use client';

import { useMemo, useState } from 'react';
import { useRouter } from 'next/navigation';
import { useCardState } from '@/lib/ui/useCardState';
import {
  Zap,
  Eye,
  Link2,
  ShieldCheck,
  Target,
  Sparkles,
  Shield,
  Bell,
  CheckCheck,
  Check,
  Archive,
  Trash2,
  X,
  ArrowRight,
  type LucideIcon
} from 'lucide-react';
import { Badge, Button, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/utils';
import type { NotificationItem } from '@/lib/queries/notifications';
import {
  dismissNotification,
  markAllNotificationsRead,
  markNotificationRead
} from '@/lib/actions/notifications';

/** Map a notification category to a display icon + tone. Unknown categories
 * fall back to a neutral bell. */
const CATEGORY_META: Record<string, { icon: LucideIcon; tone: BadgeTone }> = {
  Synergy: { icon: Zap, tone: 'gold' },
  'LP interest': { icon: Eye, tone: 'azure' },
  'Capital match': { icon: Link2, tone: 'info' },
  'Chain of Trust': { icon: ShieldCheck, tone: 'success' },
  Strategy: { icon: Target, tone: 'warning' },
  Team: { icon: Sparkles, tone: 'azure' },
  Admin: { icon: Shield, tone: 'danger' }
};

/** Legacy DB category values (pre-team-rename) mapped to the new key. */
const CATEGORY_ALIASES: Record<string, string> = {
  Copilot: 'Team'
};

function metaFor(category: string): { icon: LucideIcon; tone: BadgeTone } {
  const key = CATEGORY_ALIASES[category] ?? category;
  return CATEGORY_META[key] ?? { icon: Bell, tone: 'neutral' };
}

type Action = 'read' | 'archive' | 'delete';

const ROW_ACTIONS: Array<{ act: Action; icon: LucideIcon; label: string }> = [
  { act: 'read', icon: Check, label: 'Mark read' },
  { act: 'archive', icon: Archive, label: 'Archive' },
  { act: 'delete', icon: Trash2, label: 'Delete' }
];

function NotifRow({
  n,
  onAct,
  onOpen
}: {
  n: NotificationItem;
  onAct: (id: string, a: Action) => void;
  onOpen: (n: NotificationItem) => void;
}) {
  const { icon: Icon, tone } = metaFor(n.category);
  return (
    <button
      type="button"
      onClick={() => onOpen(n)}
      className={cn(
        'group flex w-full items-start gap-3 rounded-xl border border-transparent p-3.5 text-left transition',
        n.read ? 'hover:bg-surface-1' : 'border-hairline bg-surface-1'
      )}
    >
      <span
        className="flex h-[34px] w-[34px] flex-none items-center justify-center rounded-[9px] border"
        style={{
          color: `var(--${tone}-1, var(--fg-3))`,
          background: `var(--${tone}-soft, var(--surface-2))`,
          borderColor: `var(--${tone}-line, var(--border))`
        }}
      >
        <Icon size={16} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          {!n.read && (
            <span
              className="h-1.5 w-1.5 flex-none rounded-full"
              style={{ background: `var(--${tone}-1, var(--fg-3))` }}
              aria-hidden
            />
          )}
          <span className="text-[13.5px] font-semibold text-fg-1">{n.title}</span>
        </div>
        {n.body && <div className="mt-1 text-[12.5px] leading-relaxed text-fg-3">{n.body}</div>}
        <div className="mt-1.5 font-mono text-[10.5px] text-fg-5">{n.meta}</div>
      </div>
      <div className="flex flex-col items-end gap-2">
        <span className="font-mono text-[10.5px] text-fg-5">{n.time}</span>
        <span
          className="flex gap-1 opacity-0 transition group-hover:opacity-100"
          // Prevent row-open when clicking an action button.
          onClick={(e) => e.stopPropagation()}
        >
          {ROW_ACTIONS.map(({ act, icon: ActIcon, label }) => (
            <span
              key={act}
              role="button"
              tabIndex={0}
              title={label}
              aria-label={label}
              onClick={() => onAct(n.id, act)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' || e.key === ' ') onAct(n.id, act);
              }}
              className="flex h-[26px] w-[26px] items-center justify-center rounded-md border border-hairline bg-surface-1 text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
            >
              <ActIcon size={12} strokeWidth={1.9} aria-hidden />
            </span>
          ))}
        </span>
      </div>
    </button>
  );
}

function NotifDetail({
  n,
  onClose,
  onAct,
  onTakeAction
}: {
  n: NotificationItem;
  onClose: () => void;
  onAct: (id: string, a: Action) => void;
  onTakeAction: (href: string) => void;
}) {
  const { icon: Icon, tone } = metaFor(n.category);
  return (
    <div className="fixed inset-0 z-[60] flex items-center justify-center p-4">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden />
      <Card className="relative z-10 w-[460px] max-w-[92vw] bg-bg-1 p-6">
        <div className="flex items-center gap-3">
          <span
            className="flex h-10 w-10 flex-none items-center justify-center rounded-[11px] border"
            style={{
              color: `var(--${tone}-1, var(--fg-3))`,
              background: `var(--${tone}-soft, var(--surface-2))`,
              borderColor: `var(--${tone}-line, var(--border))`
            }}
          >
            <Icon size={19} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <Badge tone={tone} className="text-[10px]">
              {n.category}
            </Badge>
            <div className="mt-1.5 text-[16px] font-semibold tracking-[-0.015em] text-fg-1">
              {n.title}
            </div>
          </div>
          <button
            type="button"
            onClick={onClose}
            aria-label="Close"
            className="flex-none text-fg-4 transition hover:text-fg-1"
          >
            <X size={18} strokeWidth={1.9} aria-hidden />
          </button>
        </div>
        {n.body && <p className="mt-4 text-[13.5px] leading-relaxed text-fg-2">{n.body}</p>}
        <div className="mt-2.5 font-mono text-[11px] text-fg-5">
          {n.meta} · {n.time}
        </div>
        <div className="mt-5 flex gap-2.5">
          {n.href ? (
            <Button
              variant="primary"
              iconRight={ArrowRight}
              className="flex-1"
              onClick={() => onTakeAction(n.href as string)}
              data-testid="notif-take-action"
            >
              Take action
            </Button>
          ) : null}
          <Button
            variant="secondary"
            icon={Archive}
            className={n.href ? undefined : 'flex-1'}
            onClick={() => {
              onAct(n.id, 'archive');
              onClose();
            }}
          >
            Archive
          </Button>
          <Button
            variant="ghost"
            icon={Trash2}
            aria-label="Delete"
            onClick={() => {
              onAct(n.id, 'delete');
              onClose();
            }}
          />
        </div>
      </Card>
    </div>
  );
}

export function NotificationsView({ initial }: { initial: NotificationItem[] }) {
  const cards = useCardState(initial, (n) => ({ read: n.read }));
  const [category, setCategory] = useState('All');
  const [open, setOpen] = useState<NotificationItem | null>(null);
  const router = useRouter();

  const categories = useMemo(() => {
    const set = new Set<string>();
    for (const n of initial) set.add(n.category);
    return ['All', ...Array.from(set)];
  }, [initial]);

  function act(id: string, a: Action) {
    if (a === 'delete') {
      cards.delete(id);
      void dismissNotification(id).then(() => router.refresh());
    } else if (a === 'archive') {
      cards.archive(id);
      void dismissNotification(id).then(() => router.refresh());
    } else if (a === 'read') {
      cards.markRead(id);
      void markNotificationRead(id).then(() => router.refresh());
    }
  }

  function handleMarkAllRead() {
    cards.markAllRead();
    void markAllNotificationsRead().then(() => router.refresh());
  }

  // Opening a notification marks it read; the detail modal then surfaces it.
  function openNotification(n: NotificationItem) {
    setOpen(n);
    if (!n.read) {
      cards.markRead(n.id);
      void markNotificationRead(n.id);
    }
  }

  // "Take action" routes to the notification's same-origin target.
  function takeAction(href: string) {
    setOpen(null);
    router.push(href);
  }

  // Archived / deleted notifications drop out of the inbox.
  const present = cards.items.filter((n) => !n.archived && !n.deleted);
  const visible = present.filter((n) => category === 'All' || n.category === category);
  const unread = present.filter((n) => !n.read).length;

  return (
    <div className="flex flex-col gap-[18px]">
      <div className="flex items-end justify-between">
        <SectionTitle eyebrow={`${unread} unread`} title="Notification center" className="mb-0" />
        <Button
          variant="secondary"
          icon={CheckCheck}
          size="sm"
          onClick={handleMarkAllRead}
          data-testid="notif-mark-all-read"
        >
          Mark all read
        </Button>
      </div>

      {categories.length > 1 && (
        <div className="flex flex-wrap gap-2">
          {categories.map((c) => {
            const on = category === c;
            return (
              <button
                key={c}
                type="button"
                onClick={() => setCategory(c)}
                className={cn(
                  'rounded-full border border-hairline px-3 py-1.5 text-xs font-medium transition',
                  on ? 'bg-surface-3 text-fg-1' : 'bg-surface-1 text-fg-4 hover:text-fg-2'
                )}
              >
                {c}
              </button>
            );
          })}
        </div>
      )}

      <Card className="p-2">
        {visible.length ? (
          visible.map((n, i) => (
            <div key={n.id}>
              <NotifRow n={n} onAct={act} onOpen={openNotification} />
              {i < visible.length - 1 && <div className="mx-3.5 h-px bg-hairline-faint" />}
            </div>
          ))
        ) : (
          <div className="p-10 text-center text-[13px] text-fg-5">
            Nothing here. You&rsquo;re all caught up.
          </div>
        )}
      </Card>

      {open && (
        <NotifDetail n={open} onClose={() => setOpen(null)} onAct={act} onTakeAction={takeAction} />
      )}
    </div>
  );
}
