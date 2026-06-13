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
  Sparkles,
  Send,
  Video,
  Search,
  Target,
  FolderOpen,
  type LucideIcon
} from 'lucide-react';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import {
  act_on_inbox_item,
  draft_inbox_reply,
  send_inbox_reply,
  type InboxAction
} from '@/lib/actions/inbox';
import { start_inbox_call } from '@/lib/actions/calls';
import {
  COMING_SOON_CHANNELS,
  WIRED_CHANNELS,
  type InboxChannel,
  type InboxDealOption,
  type InboxItem
} from '@/lib/inbox/channels';
import { suggestDeal } from '@/lib/inbox/suggest';
import { cn } from '@/lib/utils';

/* The Relationship Inbox (P1-P3). Channel-agnostic triage list with channel
 * filter chips + a "System" link back to notifications. Each pending email/
 * Slack item can be accepted, dismissed, or replied to: Earn drafts a reply
 * the operator edits and sends in-channel via the guarded server actions. */

const CHANNEL_META: Record<InboxChannel, { label: string; icon: LucideIcon }> = {
  email: { label: 'Email', icon: Mail },
  slack: { label: 'Slack', icon: MessageSquare },
  call: { label: 'Calls', icon: Phone },
  linkedin: { label: 'LinkedIn', icon: Contact },
  sms: { label: 'SMS', icon: MessageCircle },
  webinar: { label: 'Webinars', icon: Phone },
  dataroom: { label: 'Data Room', icon: FolderOpen }
};

/** Channels we can send a reply through today. */
const SENDABLE: InboxChannel[] = ['email', 'slack'];

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
  countsByChannel,
  dealOptions = []
}: {
  items: InboxItem[];
  countsByChannel: Record<InboxChannel, number>;
  dealOptions?: InboxDealOption[];
}) {
  const router = useRouter();
  const [items, setItems] = useState(initialItems);
  const [filter, setFilter] = useState<Filter>('all');
  const [pending, setPending] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);

  // A successful action calls router.refresh(), which re-runs the server query
  // and passes fresh props. Resync during render (React's "adjust state on prop
  // change" pattern) so refreshed rows + chip counts show without a full
  // navigation — and without a setState-in-effect.
  const [prevInitial, setPrevInitial] = useState(initialItems);
  if (initialItems !== prevInitial) {
    setPrevInitial(initialItems);
    setItems(initialItems);
  }

  // Spin up an in-app call room and jump into it. Surfaces a clear message when
  // LiveKit isn't configured rather than failing silently.
  async function startCall() {
    setStarting(true);
    setError(null);
    try {
      const res = await start_inbox_call();
      if (res.ok && res.room) {
        router.push(`/inbox/call/${res.room}`);
      } else if (res.reason === 'not_configured') {
        setError('In-app calls aren’t set up yet — add LiveKit credentials to enable them.');
      } else {
        setError(res.error ?? 'Could not start a call — try again.');
      }
    } catch {
      setError('Could not start a call — check your connection and try again.');
    } finally {
      setStarting(false);
    }
  }

  const visible = useMemo(
    () => (filter === 'all' ? items : items.filter((i) => i.channel === filter)),
    [items, filter]
  );

  function removeItem(id: string) {
    setItems((prev) => prev.filter((i) => i.id !== id));
  }

  // Optimistically drop the item from the worklist; revert + surface an error
  // if the guarded RPC rejects the transition. `dealId` routes an accepted
  // conversation onto a deal (null = accept without routing).
  async function act(item: InboxItem, action: InboxAction, dealId: string | null = null) {
    // Serialize triage mutations: one in-flight RPC at a time, so an
    // out-of-order failure can't roll the list back to a stale snapshot.
    if (pending) return;
    setPending(item.id);
    setError(null);
    const snapshot = items;
    removeItem(item.id);
    try {
      const res = await act_on_inbox_item(item.id, action, dealId);
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
        <button
          type="button"
          onClick={() => void startCall()}
          disabled={starting}
          className="inline-flex flex-none items-center gap-1.5 rounded-lg border border-hairline bg-surface-1 px-2.5 py-1.5 text-[11.5px] font-medium text-fg-3 transition hover:bg-surface-2 hover:text-fg-1 disabled:opacity-50"
        >
          {starting ? (
            <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden />
          ) : (
            <Video size={13} strokeWidth={1.9} aria-hidden />
          )}
          New call
        </button>
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
              dealOptions={dealOptions}
              busy={pending !== null}
              onAct={(action, dealId) => void act(item, action, dealId)}
              onSent={() => removeItem(item.id)}
              onError={setError}
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
  dealOptions,
  busy,
  onAct,
  onSent,
  onError
}: {
  item: InboxItem;
  dealOptions: InboxDealOption[];
  busy: boolean;
  onAct: (action: InboxAction, dealId: string | null) => void;
  onSent: () => void;
  onError: (msg: string) => void;
}) {
  const meta = CHANNEL_META[item.channel];
  const pendingItem = item.status === 'pending';
  const canReply = pendingItem && SENDABLE.includes(item.channel);
  const isCall = item.channel === 'call';

  const [routing, setRouting] = useState(false);
  const [composing, setComposing] = useState(false);
  const [draft, setDraft] = useState(item.draftReply ?? '');
  const [drafting, setDrafting] = useState(false);
  const [sending, setSending] = useState(false);
  // Lock the whole row while any of its mutations is in flight, so a reply
  // can't race a triage transition on the same item.
  const rowBusy = busy || drafting || sending;

  async function generate() {
    setDrafting(true);
    onError('');
    try {
      const res = await draft_inbox_reply(item.id);
      if (res.ok && res.draft) setDraft(res.draft);
      else onError('Earn could not draft a reply right now — write one or try again.');
    } catch {
      onError('Earn could not draft a reply — check your connection and try again.');
    } finally {
      setDrafting(false);
    }
  }

  async function openComposer() {
    setComposing(true);
    if (!draft.trim()) await generate();
  }

  async function send() {
    setSending(true);
    onError('');
    try {
      const res = await send_inbox_reply(item.id, draft);
      if (res.ok) onSent();
      else onError(res.error ?? 'Could not send the reply — try again.');
    } catch {
      onError('Could not send the reply — check your connection and try again.');
    } finally {
      setSending(false);
    }
  }

  return (
    <Card className="flex flex-col gap-3 p-4">
      <div className="flex items-start gap-3">
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
            {isCall && item.externalId ? (
              <Link
                href={`/inbox/call/${item.externalId}`}
                className="flex h-7 items-center gap-1 rounded-lg border border-[var(--accent-line)] bg-[var(--accent-soft)] px-2 text-[11px] font-semibold text-[var(--accent)] transition hover:opacity-90"
              >
                <Video size={12} strokeWidth={1.9} aria-hidden />
                Join
              </Link>
            ) : (
              canReply &&
              !composing && (
                <button
                  type="button"
                  title="Reply with Earn"
                  aria-label={`Reply to "${item.subject || meta.label}"`}
                  disabled={rowBusy}
                  onClick={() => void openComposer()}
                  className="flex h-7 items-center gap-1 rounded-lg border border-hairline px-2 text-[11px] font-medium text-fg-3 transition hover:bg-surface-2 hover:text-fg-1 disabled:opacity-50"
                >
                  <Sparkles size={12} strokeWidth={1.9} aria-hidden />
                  Reply
                </button>
              )
            )}
            {!isCall && (
              <button
                type="button"
                title="Accept — route onto the deal loop"
                aria-label={`Accept conversation "${item.subject || meta.label}"`}
                aria-expanded={routing}
                disabled={rowBusy}
                onClick={() =>
                  dealOptions.length === 0 ? onAct('accepted', null) : setRouting((v) => !v)
                }
                className={cn(
                  'flex h-7 w-7 items-center justify-center rounded-lg border transition disabled:opacity-50',
                  routing
                    ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]'
                    : 'border-hairline text-fg-4 hover:bg-surface-2 hover:text-fg-1'
                )}
              >
                {busy ? (
                  <Loader2 size={13} className="motion-safe:animate-spin" aria-hidden />
                ) : (
                  <Check size={13} aria-hidden />
                )}
              </button>
            )}
            <button
              type="button"
              title="Dismiss"
              aria-label={`Dismiss conversation "${item.subject || meta.label}"`}
              disabled={rowBusy}
              onClick={() => onAct('dismissed', null)}
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-hairline text-fg-4 transition hover:bg-surface-2 hover:text-fg-1 disabled:opacity-50"
            >
              <X size={13} aria-hidden />
            </button>
          </div>
        )}
      </div>

      {routing && (
        <DealPicker
          item={item}
          deals={dealOptions}
          busy={rowBusy}
          onCancel={() => setRouting(false)}
          onRoute={(dealId) => onAct('accepted', dealId)}
        />
      )}

      {composing && (
        <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface-1 p-3">
          <div className="flex items-center gap-1.5 text-[11px] font-semibold text-fg-3">
            <Sparkles size={12} strokeWidth={1.9} className="text-[var(--accent)]" aria-hidden />
            Earn&apos;s draft — edit before you send
          </div>
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            rows={5}
            disabled={drafting || sending}
            placeholder={drafting ? 'Earn is drafting…' : 'Write your reply…'}
            className="w-full resize-y rounded-lg border border-hairline bg-bg-0 px-3 py-2 text-[12.5px] leading-relaxed text-fg-1 outline-none focus:border-[var(--accent-line)] disabled:opacity-60"
          />
          <div className="flex items-center justify-end gap-2">
            <button
              type="button"
              onClick={() => setComposing(false)}
              disabled={drafting || sending}
              className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium text-fg-4 transition hover:text-fg-1 disabled:opacity-50"
            >
              Cancel
            </button>
            <button
              type="button"
              onClick={() => void generate()}
              disabled={drafting || sending}
              className="inline-flex items-center gap-1.5 rounded-lg border border-hairline px-2.5 py-1.5 text-[11.5px] font-medium text-fg-3 transition hover:bg-surface-2 hover:text-fg-1 disabled:opacity-50"
            >
              {drafting ? (
                <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden />
              ) : (
                <Sparkles size={12} strokeWidth={1.9} aria-hidden />
              )}
              Redraft
            </button>
            <button
              type="button"
              onClick={() => void send()}
              disabled={sending || drafting || !draft.trim()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11.5px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
            >
              {sending ? (
                <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden />
              ) : (
                <Send size={12} strokeWidth={2} aria-hidden />
              )}
              Send
            </button>
          </div>
        </div>
      )}
    </Card>
  );
}

/** Route-on-accept picker: a suggested deal (when there's a real name match)
 * pinned on top, a searchable list, and an "accept without a deal" escape. */
function DealPicker({
  item,
  deals,
  busy,
  onCancel,
  onRoute
}: {
  item: InboxItem;
  deals: InboxDealOption[];
  busy: boolean;
  onCancel: () => void;
  onRoute: (dealId: string | null) => void;
}) {
  const suggestion = useMemo(() => suggestDeal(item, deals), [item, deals]);
  const [query, setQuery] = useState('');
  const [selected, setSelected] = useState<string | null>(suggestion?.dealId ?? null);

  const filtered = useMemo(() => {
    const q = query.trim().toLowerCase();
    const matches = q ? deals.filter((d) => d.name.toLowerCase().includes(q)) : deals;
    // Pin the suggested deal to the top so the operator's eye lands on it.
    if (!suggestion) return matches;
    const sugg = matches.find((d) => d.id === suggestion.dealId);
    if (!sugg) return matches;
    return [sugg, ...matches.filter((d) => d.id !== suggestion.dealId)];
  }, [deals, query, suggestion]);

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-hairline bg-surface-1 p-3">
      <div className="flex items-center gap-1.5 text-[11px] font-semibold text-fg-3">
        <Target size={12} strokeWidth={1.9} className="text-[var(--accent)]" aria-hidden />
        Route onto a deal
      </div>

      {suggestion && suggestion.matched.length > 0 && (
        <p className="text-[10.5px] text-fg-5">
          Suggested — matches{' '}
          {suggestion.matched.map((m, i) => (
            <span key={m} className="font-medium text-fg-3">
              {i > 0 ? ', ' : ''}“{m}”
            </span>
          ))}
        </p>
      )}

      {deals.length > 6 && (
        <div className="flex items-center gap-1.5 rounded-lg border border-hairline bg-bg-0 px-2.5">
          <Search size={12} className="flex-none text-fg-5" aria-hidden />
          <input
            value={query}
            onChange={(e) => setQuery(e.target.value)}
            placeholder="Search deals…"
            disabled={busy}
            className="w-full bg-transparent py-1.5 text-[12px] text-fg-1 outline-none disabled:opacity-60"
          />
        </div>
      )}

      <div className="flex max-h-44 flex-col gap-1 overflow-y-auto">
        {filtered.length === 0 ? (
          <p className="px-1 py-2 text-[11.5px] text-fg-5">No matching deals.</p>
        ) : (
          filtered.map((deal) => {
            const isSel = selected === deal.id;
            const isSugg = suggestion?.dealId === deal.id;
            return (
              <button
                key={deal.id}
                type="button"
                disabled={busy}
                onClick={() => setSelected(isSel ? null : deal.id)}
                aria-pressed={isSel}
                className={cn(
                  'flex items-center gap-2 rounded-lg border px-2.5 py-1.5 text-left text-[12px] transition disabled:opacity-50',
                  isSel
                    ? 'border-[var(--accent-line)] bg-[var(--accent-soft)] text-fg-1'
                    : 'border-hairline bg-bg-0 text-fg-2 hover:bg-surface-2'
                )}
              >
                <span
                  className={cn(
                    'flex h-3.5 w-3.5 flex-none items-center justify-center rounded-full border',
                    isSel
                      ? 'border-[var(--accent)] bg-[var(--accent)] text-white'
                      : 'border-hairline'
                  )}
                >
                  {isSel && <Check size={10} strokeWidth={3} aria-hidden />}
                </span>
                <span className="min-w-0 flex-1 truncate font-medium">{deal.name}</span>
                {isSugg && (
                  <Badge tone="neutral" className="px-1 py-0 text-[8.5px]">
                    Suggested
                  </Badge>
                )}
                {deal.stage && (
                  <span className="flex-none text-[10px] text-fg-5">{deal.stage}</span>
                )}
              </button>
            );
          })
        )}
      </div>

      <div className="flex items-center justify-between gap-2">
        <button
          type="button"
          onClick={() => onRoute(null)}
          disabled={busy}
          className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium text-fg-4 transition hover:text-fg-1 disabled:opacity-50"
        >
          Accept without a deal
        </button>
        <div className="flex items-center gap-2">
          <button
            type="button"
            onClick={onCancel}
            disabled={busy}
            className="rounded-lg px-2.5 py-1.5 text-[11.5px] font-medium text-fg-4 transition hover:text-fg-1 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => onRoute(selected)}
            disabled={busy || !selected}
            className="inline-flex items-center gap-1.5 rounded-lg bg-accent px-3 py-1.5 text-[11.5px] font-semibold text-white transition hover:opacity-90 disabled:opacity-50"
          >
            {busy ? (
              <Loader2 size={12} className="motion-safe:animate-spin" aria-hidden />
            ) : (
              <Check size={12} strokeWidth={2.5} aria-hidden />
            )}
            Route &amp; accept
          </button>
        </div>
      </div>
    </div>
  );
}
