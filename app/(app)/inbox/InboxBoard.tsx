"use client";

import { memo, useMemo, useState, useTransition, useCallback } from "react";
import dynamic from "next/dynamic";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ActionKind, GateTier } from "@/lib/gates";
import { TIER_STYLE } from "@/lib/gates";
import type { InboxCategory, InboxChannel } from "@/lib/supabase/database.types";
import {
  actOnThread,
  shareCommandCenter,
  setThreadStatus,
  deleteThreadAction,
  clearInbox,
  assignThread,
  setThreadStar,
  bulkThreadAction,
  snoozeThread,
  type ThreadActionResult,
  type Teammate,
  type BulkAction,
} from "./actions";
import { relativeMeeting } from "./format";

// The conversation transcript + inline composer, loaded only when a thread is
// actually expanded. Opening a thread already waits on a server round trip for
// its messages, so the chunk fetch overlaps work the operator was waiting on —
// while every collapsed card on the board stops paying for that code.
const ThreadConversation = dynamic(
  () => import("./ThreadConversation").then((m) => m.ThreadConversation),
  { loading: () => <p className="mt-2 text-xs text-fg-muted">Loading conversation…</p>, ssr: false },
);

// Snooze presets, resolved to an absolute wake time when chosen (client-side so
// it's the operator's local clock). "Tomorrow" is 9am the next day.
const SNOOZE_PRESETS: { key: string; label: string; until: () => Date }[] = [
  { key: "3h", label: "3 hours", until: () => new Date(Date.now() + 3 * 3_600_000) },
  {
    key: "tomorrow",
    label: "Tomorrow 9am",
    until: () => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      d.setHours(9, 0, 0, 0);
      return d;
    },
  },
  { key: "week", label: "Next week", until: () => new Date(Date.now() + 7 * 86_400_000) },
];

// Fully server-prepared card data — no intelligence/AI module reaches the client.
export interface InboxCardData {
  id: string;
  channel: InboxChannel;
  channelLabel: string;
  channelIcon: string;
  category: InboxCategory;
  subject: string;
  counterparty: string;
  summary: string;
  intent: string | null;
  priority: number;
  bucket: "now" | "soon" | "later";
  // The Focused / Other tab this thread belongs to (resolved server-side).
  tab: "focused" | "other";
  unread: boolean;
  // Operator-set star — pins the thread and feeds the "Starred" saved view.
  starred: boolean;
  status: "open" | "snoozed" | "done";
  snoozedUntil: string | null;
  meetingAt: string | null;
  meetingUrl: string | null;
  context: { kind: "deal" | "investor"; id: string; name: string; href: string } | null;
  assignee: { id: string; name: string } | null;
  // Whether this org has connected the thread's channel; drives the composer's
  // "connect to send" hint.
  connected: boolean;
  suggested: { action: ActionKind; label: string; tier: GateTier } | null;
  // One-tap smart-reply openers shown above the composer (server-computed).
  quickReplies: string[];
  // Follow-up reminder pill (or null) — "waiting on you" / "gone cold".
  nudge: { kind: "awaiting_you" | "going_cold"; label: string; tone: "warn" | "muted" } | null;
  canShare: boolean;
  shareTier: GateTier;
}

// How many thread cards mount before the operator asks for more.
const CARDS_PER_PAGE = 30;

const BUCKETS = [
  { key: "now", label: "Needs you now", tone: "text-status-success" },
  { key: "soon", label: "Soon", tone: "text-gold-300" },
  { key: "later", label: "Later", tone: "text-fg-muted" },
] as const;

const FILTERS: { key: "all" | InboxCategory; label: string }[] = [
  { key: "all", label: "All" },
  { key: "messaging", label: "Messaging" },
  { key: "booking", label: "Booking" },
  { key: "video", label: "Video" },
  { key: "signing", label: "Signing" },
  { key: "finance", label: "Finance" },
];

export function InboxBoard({ cards, teammates }: { cards: InboxCardData[]; teammates: Teammate[] }) {
  const router = useRouter();
  // The Focused / Other split sits above the pillar filters — an instant,
  // client-side facet like the pillar chips. Focused is the default view.
  const [tab, setTab] = useState<"focused" | "other">("focused");
  const [filter, setFilter] = useState<"all" | InboxCategory>("all");
  const [clearing, startClearTransition] = useTransition();
  const [clearError, setClearError] = useState<string | null>(null);

  // Multi-select for bulk triage. A Set of thread ids; the bulk bar appears when
  // any are selected.
  const [selected, setSelected] = useState<ReadonlySet<string>>(() => new Set());
  const [bulking, startBulkTransition] = useTransition();

  const toggleSelect = useCallback((id: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);
  const clearSelection = useCallback(() => setSelected(new Set()), []);

  function handleClear() {
    const n = visible.filter((c) => c.status === "open").length;
    if (!confirm(`Clear ${n} open thread${n === 1 ? "" : "s"}${filter !== "all" ? ` in ${filter}` : ""}? This cannot be undone.`)) return;
    setClearError(null);
    startClearTransition(async () => {
      const r = await clearInbox(filter !== "all" ? { category: filter as InboxCategory } : undefined);
      if (r.ok) {
        router.refresh();
      } else {
        setClearError("Failed to clear inbox. Try again.");
      }
    });
  }

  const visible = useMemo(
    () =>
      cards.filter(
        (c) => c.status !== "done" && c.tab === tab && (filter === "all" || c.category === filter),
      ),
    [cards, tab, filter],
  );
  // Snoozed threads leave the active board and sit in their own collapsible
  // section until their wake time returns them to open (autoUnsnoozeExpired).
  const active = useMemo(() => visible.filter((c) => c.status !== "snoozed"), [visible]);
  const snoozed = useMemo(() => visible.filter((c) => c.status === "snoozed"), [visible]);
  // The server hands over as many as 100 threads. Mounting all of them means a
  // hundred fully-interactive cards — selects, composers, transition hooks —
  // built before the operator has looked at the first one. Render a screenful
  // and reveal the rest on request; `active` is already ranked hottest-first,
  // so the cards that matter are the ones on screen.
  const [shown, setShown] = useState(CARDS_PER_PAGE);
  const activeShown = useMemo(() => active.slice(0, shown), [active, shown]);
  const hiddenCount = active.length - activeShown.length;
  const [showSnoozed, setShowSnoozed] = useState(false);

  // Run a bulk triage action over the current selection, then clear it.
  const runBulk = useCallback(
    (action: BulkAction) => {
      const ids = visible.filter((c) => selected.has(c.id)).map((c) => c.id);
      if (!ids.length) return;
      startBulkTransition(async () => {
        const r = await bulkThreadAction(ids, action);
        if (r.ok) {
          clearSelection();
          router.refresh();
        }
      });
    },
    [visible, selected, clearSelection, router],
  );

  // Pillar-chip counts, scoped to the active tab so the numbers match the list.
  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) {
      if (c.status === "done" || c.status === "snoozed") continue;
      if (c.tab !== tab) continue;
      m.set("all", (m.get("all") ?? 0) + 1);
      m.set(c.category, (m.get(c.category) ?? 0) + 1);
    }
    return m;
  }, [cards, tab]);

  // Tab badges count every active (open, non-snoozed) thread on each side,
  // independent of the pillar filter so the split stays a stable headline.
  const tabCounts = useMemo(() => {
    let focused = 0;
    let other = 0;
    for (const c of cards) {
      if (c.status === "done" || c.status === "snoozed") continue;
      if (c.tab === "focused") focused += 1;
      else other += 1;
    }
    return { focused, other };
  }, [cards]);

  // Switching tabs drops any selection carried from the other side so the bulk
  // bar's count always reflects what's actually visible.
  const switchTab = useCallback(
    (next: "focused" | "other") => {
      setTab(next);
      setShown(CARDS_PER_PAGE);
      clearSelection();
    },
    [clearSelection],
  );

  if (cards.length === 0) {
    return (
      <div className="fx-card animate-fade-up p-10 text-center">
        <p className="text-sm text-fg-muted">
          Your unified inbox is empty. Connect your channels and booking, messaging,
          video, and signing threads will land here — triaged, ranked, and ready to act on.
        </p>
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-4">
      {/* Focused / Other — the high-signal vs ambient split, above the pillars. */}
      <div
        role="tablist"
        aria-label="Inbox focus"
        className="flex items-center gap-0.5 self-start rounded-full border border-line bg-surface-1 p-0.5 text-xs"
      >
        {([
          { key: "focused", label: "Focused" },
          { key: "other", label: "Other" },
        ] as const).map((t) => {
          const on = tab === t.key;
          return (
            <button
              key={t.key}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => switchTab(t.key)}
              className={`rounded-full px-3.5 py-1 transition ${
                on
                  ? "bg-gold-500/15 text-gold-300"
                  : "text-fg-secondary hover:text-fg-primary"
              }`}
            >
              {t.label}
              <span className="ml-1.5 font-mono text-[11px] text-fg-muted">{tabCounts[t.key]}</span>
            </button>
          );
        })}
      </div>

      {/* Pillar filters + Clear */}
      <div className="flex flex-wrap items-center gap-1.5">
        {FILTERS.map((f) => {
          const active = filter === f.key;
          const n = counts.get(f.key) ?? 0;
          return (
            <button
              key={f.key}
              type="button"
              onClick={() => {
                setFilter(f.key);
                setShown(CARDS_PER_PAGE);
              }}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                active
                  ? "border-gold-500 bg-gold-500/10 text-gold-300"
                  : "border-line text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
              }`}
            >
              {f.label}
              <span className="ml-1.5 font-mono text-[11px] text-fg-muted">{n}</span>
            </button>
          );
        })}
        {visible.length > 0 && (
          <button
            type="button"
            disabled={clearing}
            onClick={handleClear}
            className="ml-auto rounded-md border border-line px-3 py-1 text-xs text-fg-muted transition hover:border-status-danger/50 hover:text-status-danger disabled:opacity-50"
          >
            {clearing ? "Clearing…" : "Clear inbox"}
          </button>
        )}
      </div>

      {clearError ? (
        <p className="text-xs text-status-danger">{clearError}</p>
      ) : null}

      {/* Bulk-triage bar — appears when threads are selected. */}
      {selected.size > 0 ? (
        <div className="flex flex-wrap items-center gap-2 rounded-lg border border-gold-500/40 bg-gold-500/5 px-3 py-2">
          <span className="text-xs font-medium text-gold-300">{selected.size} selected</span>
          <div className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              disabled={bulking}
              onClick={() => runBulk("done")}
              className="rounded-md border border-line bg-surface-0/80 px-2.5 py-1 text-xs text-fg-primary transition hover:border-gold-500 disabled:opacity-50"
            >
              {bulking ? "Working…" : "Mark done"}
            </button>
            <button
              type="button"
              disabled={bulking}
              onClick={() => runBulk("snooze")}
              className="rounded-md border border-line bg-surface-0/80 px-2.5 py-1 text-xs text-fg-primary transition hover:border-gold-500 disabled:opacity-50"
            >
              Snooze
            </button>
            <button
              type="button"
              disabled={bulking}
              onClick={() => runBulk("read")}
              className="rounded-md border border-line bg-surface-0/80 px-2.5 py-1 text-xs text-fg-primary transition hover:border-gold-500 disabled:opacity-50"
            >
              Mark read
            </button>
            <button
              type="button"
              onClick={clearSelection}
              className="rounded-md px-2 py-1 text-xs text-fg-muted transition hover:text-fg-primary"
            >
              Cancel
            </button>
          </div>
        </div>
      ) : null}

      {active.length === 0 ? (
        <p className="px-1 py-6 text-sm text-fg-muted">
          {tab === "focused" && filter === "all" && tabCounts.other > 0 ? (
            <>
              Focused is clear.{" "}
              <button
                type="button"
                onClick={() => switchTab("other")}
                className="text-gold-300 transition hover:underline"
              >
                See {tabCounts.other} in Other →
              </button>
            </>
          ) : (
            "Nothing here — inbox clear for this filter."
          )}
        </p>
      ) : (
        <>
          {BUCKETS.map((bucket) => {
            const inBucket = activeShown.filter((c) => c.bucket === bucket.key);
            if (inBucket.length === 0) return null;
            return (
              <section key={bucket.key}>
                <h2 className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest">
                  <span className={bucket.tone}>{bucket.label}</span>
                  <span className="text-fg-muted">{inBucket.length}</span>
                </h2>
                <div className="flex flex-col gap-2">
                  {inBucket.map((c) => (
                    <ThreadCard
                      key={c.id}
                      card={c}
                      teammates={teammates}
                      selected={selected.has(c.id)}
                      onToggleSelect={toggleSelect}
                    />
                  ))}
                </div>
              </section>
            );
          })}
          {hiddenCount > 0 ? (
            <button
              type="button"
              onClick={() => setShown((n) => n + CARDS_PER_PAGE)}
              className="self-start rounded-md border border-line px-3 py-1.5 text-xs text-fg-secondary transition hover:border-gold-500 hover:text-fg-primary"
            >
              Show {Math.min(hiddenCount, CARDS_PER_PAGE)} more
              <span className="ml-1.5 font-mono text-[11px] text-fg-muted">{hiddenCount} left</span>
            </button>
          ) : null}
        </>
      )}

      {/* Snoozed — collapsed by default; each returns to the board at its wake time. */}
      {snoozed.length > 0 ? (
        <section>
          <button
            type="button"
            onClick={() => setShowSnoozed((s) => !s)}
            className="mb-2 flex items-center gap-2 font-mono text-[11px] uppercase tracking-widest text-fg-muted transition hover:text-fg-primary"
            aria-expanded={showSnoozed}
          >
            <span className="text-[11px]">{showSnoozed ? "▾" : "▸"}</span>
            Snoozed
            <span>{snoozed.length}</span>
          </button>
          {showSnoozed ? (
            <div className="flex flex-col gap-2">
              {snoozed.map((c) => (
                <ThreadCard
                  key={c.id}
                  card={c}
                  teammates={teammates}
                  selected={selected.has(c.id)}
                  onToggleSelect={toggleSelect}
                />
              ))}
            </div>
          ) : null}
        </section>
      ) : null}
    </div>
  );
}

/**
 * One thread row.
 *
 * Memoized: the board holds the selection set, the tab and the pillar filter,
 * so without this every keystroke of triage — ticking one checkbox, switching
 * tabs — re-rendered all of the cards on screen rather than the one that
 * changed. Its props are stable by construction: `card` and `teammates` come
 * straight from server props, `onToggleSelect` is a `useCallback` with no
 * dependencies, and `selected` flips only for the card actually toggled.
 */
const ThreadCard = memo(function ThreadCard({
  card,
  teammates,
  selected,
  onToggleSelect,
}: {
  card: InboxCardData;
  teammates: Teammate[];
  selected: boolean;
  onToggleSelect: (id: string) => void;
}) {
  const router = useRouter();
  const [result, setResult] = useState<ThreadActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<string | null>(null);
  const [deleting, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [assigning, startAssignTransition] = useTransition();

  // Star toggle — optimistic so the pin flips instantly, reverting on failure.
  const [starred, setStarred] = useState(card.starred);
  const [starPending, startStarTransition] = useTransition();
  const toggleStar = useCallback(() => {
    const next = !starred;
    setStarred(next);
    startStarTransition(async () => {
      const r = await setThreadStar(card.id, next);
      if (r.ok) router.refresh();
      else setStarred(!next);
    });
  }, [starred, card.id, router]);

  // Assign / reassign the thread to a teammate (empty value clears it).
  const onAssign = useCallback(
    (value: string) => {
      startAssignTransition(async () => {
        const r = await assignThread(card.id, value || null);
        if (r.ok) router.refresh();
      });
    },
    [card.id, router],
  );

  // Expandable conversation view + inline composer. Only the open/closed flag
  // lives here now — the transcript, composer state and their five hooks moved
  // into ThreadConversation, which mounts on expand. A collapsed card (the
  // overwhelming majority on any board) carries none of it.
  const [expanded, setExpanded] = useState(false);
  // Once opened, the panel stays mounted and is merely hidden when collapsed, so
  // re-expanding a thread does not refetch its transcript and smart replies —
  // the state the card used to hold for it now lives in the panel. Cards the
  // operator never opens still mount nothing.
  const [hasOpened, setHasOpened] = useState(false);
  const toggleThread = useCallback(() => {
    setExpanded((open) => !open);
    setHasOpened(true);
  }, []);

  // The panel reports its draft/send outcome back up so the card keeps showing
  // results in the same place, below the action row, as it always has.
  const onPanelResult = useCallback((r: ThreadActionResult | null, key: string | null) => {
    setResult(r);
    setActive(key);
  }, []);

  const handleDelete = useCallback(() => {
    if (!confirm("Delete this thread? This cannot be undone.")) return;
    setDeleteError(null);
    setResult(null);
    setActive(null);
    startDeleteTransition(async () => {
      const r = await deleteThreadAction(card.id);
      if (!r.ok) {
        setDeleteError("Failed to delete thread. Try again.");
        return;
      }
      router.refresh();
    });
  }, [card.id, router]);

  function run(key: string, fn: () => Promise<ThreadActionResult>) {
    setResult(null);
    startTransition(async () => {
      setActive(key);
      const r = await fn();
      setResult(r);
      // Refresh server components so the nav badge and thread list reflect the
      // change immediately rather than waiting for the 30-second poll.
      if (r.ok) router.refresh();
    });
  }

  function fd(extra: Record<string, string>): FormData {
    const f = new FormData();
    f.set("thread_id", card.id);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  }

  return (
    <div className={`fx-card fx-card-hover relative overflow-hidden p-4 ${selected ? "ring-1 ring-gold-500/60" : ""}`}>
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-gold-500/60 to-transparent"
        style={{ opacity: card.priority / 100 }}
      />

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={selected}
              onChange={() => onToggleSelect(card.id)}
              aria-label={`Select thread: ${card.subject}`}
              className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-gold-500"
            />
            <span className="font-mono text-base leading-none text-gold-300" title={card.channelLabel}>
              {card.channelIcon}
            </span>
            <h3 className={`truncate text-sm ${card.unread ? "font-semibold text-fg-primary" : "text-fg-primary"}`}>
              {card.subject}
            </h3>
            {card.unread ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold-400" title="Unread" /> : null}
          </div>
          <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
            {card.counterparty} · {card.channelLabel}
            {card.intent ? ` · ${card.intent}` : ""}
          </p>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            onClick={toggleStar}
            disabled={starPending}
            aria-pressed={starred}
            aria-label={starred ? "Unstar thread" : "Star thread"}
            title={starred ? "Starred — click to unstar" : "Star this thread"}
            className={`text-sm leading-none transition disabled:opacity-50 ${
              starred ? "text-gold-300" : "text-fg-muted hover:text-gold-300"
            }`}
          >
            {starred ? "★" : "☆"}
          </button>
          <span className="font-mono text-[11px] text-fg-muted" title="Triage priority">
            {card.priority}
          </span>
        </div>
      </div>

      {card.summary ? <p className="mt-2 line-clamp-2 text-sm text-fg-secondary">{card.summary}</p> : null}

      {card.nudge ? (
        <p
          className={`mt-2 inline-flex items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
            card.nudge.tone === "warn"
              ? "border-gold-500/40 bg-gold-500/10 text-gold-300"
              : "border-line text-fg-muted"
          }`}
          title="Follow-up reminder"
        >
          <span aria-hidden>⏰</span> {card.nudge.label}
        </p>
      ) : null}

      <div className="mt-2 flex flex-wrap items-center gap-x-3 gap-y-1 text-[11px]">
        {card.context ? (
          <Link href={card.context.href} className="text-gold-300 hover:underline">
            {card.context.kind === "deal" ? "Deal" : "Investor"}: {card.context.name} →
          </Link>
        ) : (
          <span className="text-fg-muted">No linked context</span>
        )}
        {card.meetingAt ? (
          <span className="text-fg-secondary">🗓 {relativeMeeting(card.meetingAt)}</span>
        ) : null}
        {card.status === "snoozed" && card.snoozedUntil ? (
          <span className="text-fg-muted">💤 until {relativeMeeting(card.snoozedUntil)}</span>
        ) : null}
        {card.meetingUrl ? (
          <a href={card.meetingUrl} target="_blank" rel="noreferrer" className="text-gold-300 hover:underline">
            Meeting link →
          </a>
        ) : null}
        {/* Assignee picker — route the thread to a teammate. */}
        <label className="ml-auto inline-flex items-center gap-1 text-fg-muted">
          <span className="font-mono text-[11px] uppercase tracking-wider">Owner</span>
          <select
            value={card.assignee?.id ?? ""}
            disabled={assigning}
            onChange={(e) => onAssign(e.target.value)}
            aria-label="Assign thread to a teammate"
            className="max-w-[9rem] rounded border border-line bg-surface-2 px-1.5 py-0.5 text-[11px] text-fg-secondary outline-none focus:border-gold-500 disabled:opacity-50"
          >
            <option value="">Unassigned</option>
            {/* Keep the current assignee selectable even if they've since left the member list. */}
            {card.assignee && !teammates.some((t) => t.id === card.assignee!.id) ? (
              <option value={card.assignee.id}>{card.assignee.name}</option>
            ) : null}
            {teammates.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
        </label>
      </div>

      {/* Expand into the full conversation + inline composer */}
      <button
        type="button"
        onClick={toggleThread}
        aria-expanded={expanded}
        className="mt-2 inline-flex items-center gap-1 text-[11px] text-fg-muted transition hover:text-fg-primary"
      >
        <span className="font-mono text-[11px]">{expanded ? "▾" : "▸"}</span>
        {expanded ? "Hide thread" : "View thread"}
      </button>

      {hasOpened ? (
        <div hidden={!expanded}>
          <ThreadConversation card={card} onResult={onPanelResult} />
        </div>
      ) : null}

      {/* Gated next moves */}
      <div className="mt-3 flex flex-wrap items-center gap-2">
        {card.suggested ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("suggested", () => actOnThread(fd({ action: card.suggested!.action })))}
            className="group inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-0/80 px-3 py-1.5 text-sm text-fg-primary transition hover:-translate-y-px hover:border-gold-500 disabled:opacity-50"
          >
            <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider ${TIER_STYLE[card.suggested.tier]}`}>
              T{card.suggested.tier}
            </span>
            {pending && active === "suggested" ? "Working…" : card.suggested.label}
          </button>
        ) : null}

        {card.canShare ? (
          <button
            type="button"
            disabled={pending}
            onClick={() => run("share", () => shareCommandCenter(fd({})))}
            title="Attach this deal/investor's Command Center details to a reply"
            className="inline-flex items-center gap-1.5 rounded-md border border-line bg-surface-0/80 px-3 py-1.5 text-sm text-fg-primary transition hover:-translate-y-px hover:border-gold-500 disabled:opacity-50"
          >
            <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider ${TIER_STYLE[card.shareTier]}`}>
              T{card.shareTier}
            </span>
            {pending && active === "share" ? "Working…" : "Share Command Center"}
          </button>
        ) : null}

        <button
          type="button"
          disabled={pending || deleting}
          onClick={() => run("done", async () => {
            const r = await setThreadStatus(fd({ status: "done", unread: "false" }));
            return r.ok ? { ok: true, message: "Marked done." } : { ok: false, error: "Failed to mark as done. Try again." };
          })}
          className="ml-auto rounded-md px-2 py-1 text-xs text-fg-muted transition hover:text-fg-primary disabled:opacity-50"
        >
          Done
        </button>
        {card.status === "snoozed" ? (
          <button
            type="button"
            disabled={pending || deleting}
            onClick={() => run("unsnooze", async () => {
              const r = await setThreadStatus(fd({ status: "open" }));
              return r.ok ? { ok: true, message: "Back in inbox." } : { ok: false, error: "Couldn't unsnooze. Try again." };
            })}
            className="rounded-md px-2 py-1 text-xs text-fg-muted transition hover:text-fg-primary disabled:opacity-50"
          >
            Unsnooze
          </button>
        ) : (
          <select
            aria-label="Snooze thread until…"
            disabled={pending || deleting}
            value=""
            onChange={(e) => {
              const preset = SNOOZE_PRESETS.find((p) => p.key === e.target.value);
              if (!preset) return;
              const iso = preset.until().toISOString();
              run("snooze", async () => {
                const r = await snoozeThread(card.id, iso);
                return r.ok ? { ok: true, message: `Snoozed until ${preset.label.toLowerCase()}.` } : { ok: false, error: "Failed to snooze. Try again." };
              });
            }}
            className="rounded-md bg-transparent px-1.5 py-1 text-xs text-fg-muted outline-none transition hover:text-fg-primary disabled:opacity-50"
          >
            <option value="" disabled>
              Snooze…
            </option>
            {SNOOZE_PRESETS.map((p) => (
              <option key={p.key} value={p.key}>
                {p.label}
              </option>
            ))}
          </select>
        )}
        <button
          type="button"
          disabled={pending || deleting}
          onClick={handleDelete}
          className="rounded-md px-2 py-1 text-xs text-fg-muted transition hover:text-status-danger disabled:opacity-50"
          aria-label="Delete thread"
        >
          {deleting ? "Deleting…" : "Delete"}
        </button>
      </div>

      {result && active ? (
        <p className={`mt-2 text-xs ${result.ok ? "text-status-success" : "text-status-danger"}`}>
          {result.ok ? result.message : result.error}
        </p>
      ) : null}
      {deleteError ? (
        <p className="mt-2 text-xs text-status-danger">{deleteError}</p>
      ) : null}
    </div>
  );
});
