'use client';

import Link from 'next/link';
import { useRouter } from 'next/navigation';
import { useMemo, useState } from 'react';
import {
  Inbox as InboxIcon,
  Mail,
  MessageSquare,
  Phone,
  Contact,
  MessageCircle,
  Bell,
  ArrowRight,
  Check,
  X,
  Loader2,
  TriangleAlert,
  type LucideIcon
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { act_on_inbox_item, type InboxAction } from '@/lib/actions/inbox';
import {
  COMING_SOON_CHANNELS,
  WIRED_CHANNELS,
  type InboxChannel,
  type InboxItem
} from '@/lib/queries/inbox';
import { cn } from '@/lib/utils';

/* The Relationship Inbox (P1-P2). Channel-agnostic triage list with channel
 * filter chips + a "System" link back to notifications. Each pending item can
 * be accepted (routed onto the deal loop) or dismissed via the guarded
 * act_on_inbox_item RPC. Items arrive once ingestion runs (Gmail/Slack sync);
 * until then this renders a tasteful empty state. */

const CHANNEL_META: Record<InboxChannel, { label: string; icon: LucideIcon }> = {
  email: { label: 'Email', icon: Mail },
  slack: { label: 'Slack', icon: MessageSquare },
  call: { label: 'Calls', icon: Phone },
  linkedin: { label: 'LinkedIn', icon: Contact },
  sms: { label: 'SMS', icon: MessageCircle },
  webinar: { label: 'Webinars', icon: Phone }
};

type Filter = 'all' | InboxChannel;

/** Compact relative time (e.g. "4m", "3h", "2d") from an ISO timestamp. */
function relativeTime(iso: string | null): string {
  if (!iso) return '';
  const then = new Date(iso).getTime();
  if (Number.isNaN(then)) return '';
  const mins = Math.floor(Math.max(0, Date.now() - then) / 60_000);
  if (mins < 1) return 'now';
  if (mins < 60) return `${mins}m`;
  const hours = Math.floor(mins / 60);
  if (hours < 24) return `${hours}h`;
  return `${Math.floor(hours / 24)}d`;
}

export function InboxList({
  items: initialItems,
  countsByChannel
}: {
  items: InboxItem[];
  countsByChannel: Record<InboxChannel, number>;
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<Filter>('all');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.channel === filter)),
    [items, filter]
  );

  // Optimistically drop the item from the worklist; revert + surface an error
  // if the guarded RPC rejects the transition.
  async function act(item: InboxItem, action: InboxAction) {
    setPending(item.id);
    setError(null);
    const snapshot = items;
    setItems((prev) => prev.filter((i) => i.id !== item.id));
    try {
      const res = await act_on_inbox_item(item.id, action);
      if (res.ok) {
        router.refresh();
      } else {
        setItems(snapshot);
        setError(res.error ?? 'Could not update the conversation — try again.');
      }
    } catch {
      setItems(snapshot);
      setError('Could not update the conversation — check your connection and try again.');
    } finally {
      setPending(null);
    }
  }

  return (
    <div className="flex flex-col gap-4">
      <Card className="flex items-center gap-3 p-5">
        <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
          <InboxIcon size={22} strokeWidth={1.9} aria-hidden />
        </span>
        <div className="min-w-0 flex-1">
          <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">Inbox</h1>
          <p className="mt-0.5 text-[12.5px] text-fg-3">
            Every conversation — email, Slack, calls — routed onto the deal it belongs to, with Earn
            drafting the next reply.
          </p>
        </div>
        <Link
          href="/notifications"
          className="inline-flex flex-none items-center gap-1.5 rounded-lg border border-hairline bg-surface-1 px-2.5 py-1.5 text-[11.5px] font-medium text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
        >
          <Bell size={13} strokeWidth={1.9} aria-hidden />
          System
        </Link>
      </Card>

      {/* Channel filter chips */}
      <div className="flex flex-wrap items-center gap-1.5">
        <FilterChip active={filter === 'all'} onClick={() => setFilter('all')}>
          All
        </FilterChip>
        {WIRED_CHANNELS.map((ch) => {
          const meta = CHANNEL_META[ch];
          const count = countsByChannel[ch] ?? 0;
          return (
            <FilterChip key={ch} active={filter === ch} onClick={() => setFilter(ch)}>
              <meta.icon size={13} strokeWidth={1.9} aria-hidden />
              {meta.label}
              {count > 0 && (
                <span className="ml-0.5 text-[10px] text-fg-5 [font-feature-settings:'tnum']">
                  {count}
                </span>
              )}
            </FilterChip>
          );
        })}
        {COMING_SOON_CHANNELS.map((ch) => {
          const meta = CHANNEL_META[ch];
          return (
            <span
              key={ch}
              title={`${meta.label} — coming soon`}
              className="inline-flex cursor-not-allowed items-center gap-1.5 rounded-full border border-dashed border-hairline px-2.5 py-1 text-[11.5px] font-medium text-fg-5"
            >
              <meta.icon size={13} strokeWidth={1.9} aria-hidden />
              {meta.label}
              <Badge tone="neutral" className="px-1 py-0 text-[8.5px]">
                Soon
              </Badge>
            </span>
          );
        })}
      </div>

      {error && (
        <div className="flex items-center gap-2.5 rounded-xl border border-[var(--danger-line)] bg-[var(--danger-soft)] px-3.5 py-2.5 text-[12.5px] text-danger">
          <TriangleAlert size={15} aria-hidden />
          {error}
        </div>
      )}

      {visible.length === 0 ? (
        <Card className="p-8 text-center">
          <InboxIcon size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">Inbox zero</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            {items.length === 0
              ? 'Connect your email and Slack in Settings → Integrations. As messages arrive, the team routes each one onto the right deal and drafts a reply for you to approve.'
              : 'No conversations on this channel right now.'}
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2">
          {visible.map((item) => (
            <InboxRow
              key={item.id}
              item={item}
              busy={pending === item.id}
              onAct={(action) => void act(item, action)}
            />
          ))}
        </div>
      )}
    </div>
  );
}

function FilterChip({
  active,
  onClick,
  children
}: {
  active: boolean;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11.5px] font-medium transition',
        active
          ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]'
          : 'border-hairline bg-surface-1 text-fg-3 hover:bg-surface-2 hover:text-fg-1'
      )}
    >
      {children}
    </button>
  );
}

function InboxRow({
  item,
  busy,
  onAct
}: {
  item: InboxItem;
  busy: boolean;
  onAct: (action: InboxAction) => void;
}) {
  const meta = CHANNEL_META[item.channel];
  const pendingItem = item.status === 'pending';
  return (
    <Card className="flex items-start gap-3 p-4">
      <span className="mt-0.5 flex h-8 w-8 flex-none items-center justify-center rounded-[10px] border border-hairline bg-surface-1 text-fg-3">
        <meta.icon size={15} strokeWidth={1.9} aria-hidden />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="truncate text-[13px] font-semibold text-fg-1">
            {item.subject || meta.label}
          </span>
          <Badge tone="neutral" className="px-1.5 py-0 text-[9px]">
            {meta.label}
          </Badge>
          <span className="text-[10.5px] text-fg-5">
            {relativeTime(item.occurredAt ?? item.createdAt)}
          </span>
        </div>
        {item.preview && (
          <p className="mt-1 line-clamp-2 text-[12.5px] leading-relaxed text-fg-3">
            {item.preview}
          </p>
        )}
        {item.dealId && (
          <Link
            href={`/source?deal=${item.dealId}`}
            className="mt-2 inline-flex items-center gap-1 text-[11.5px] font-semibold text-azure-1"
          >
            View deal
            <ArrowRight size={12} strokeWidth={2} aria-hidden />
          </Link>
        )}
      </div>
      {pendingItem && (
        <div className="flex flex-none items-center gap-1">
          <button
            type="button"
            title="Accept — route onto the deal loop"
            aria-label={`Accept conversation "${item.subject || meta.label}"`}
            disabled={busy}
            onClick={() => onAct('accepted')}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-hairline text-fg-4 transition hover:bg-surface-2 hover:text-fg-1 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden />
            ) : (
              <Check size={13} aria-hidden />
            )}
          </button>
          <button
            type="button"
            title="Dismiss"
            aria-label={`Dismiss conversation "${item.subject || meta.label}"`}
            disabled={busy}
            onClick={() => onAct('dismissed')}
            className="flex h-7 w-7 items-center justify-center rounded-lg border border-hairline text-fg-4 transition hover:bg-surface-2 hover:text-fg-1 disabled:opacity-50"
          >
            <X size={13} aria-hidden />
          </button>
        </div>
      )}
    </Card>
  );
}
