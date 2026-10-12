"use client";

import { memo, useEffect, useMemo, useRef, useState, useTransition, useCallback } from "react";
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
import { relativeMeeting, rowTime } from "./format";

// The conversation transcript + inline composer, loaded only when a thread is
// actually opened. Opening a thread already waits on a server round trip for
// its messages, so the chunk fetch overlaps work the operator was waiting on —
// while the list of rows never pays for that code.
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
  /** Earn's summary of the thread, shown in the reading pane. */
  summary: string;
  /** The latest message's preview — the row's snippet. */
  snippet: string;
  /** When the latest message landed; the row's time. */
  lastMessageAt: string | null;
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
  // The meeting this thread is the follow-up of; links to its report.
  meeting: { id: string; title: string; href: string } | null;
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
  /**
   * Unsent reply text waiting on this thread — written by a meeting report's
   * follow-up, and sendable only from the composer below. Null for almost every
   * thread.
   */
  draft: { body: string; origin: string; revision: string } | null;
}

// How many rows mount before the operator asks for more.
const CARDS_PER_PAGE = 50;

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

/** The `?t=` param that keeps the open thread across reloads and shared links. */
const OPEN_PARAM = "t";

function writeOpenParam(id: string | null) {
  if (typeof window === "undefined") return;
  const url = new URL(window.location.href);
  if (id) url.searchParams.set(OPEN_PARAM, id);
  else url.searchParams.delete(OPEN_PARAM);
  // replaceState, not a router navigation: opening a thread is a view change on
  // this page, not a new server render, and it must not stack history entries.
  window.history.replaceState(window.history.state, "", url);
}

function isTypingTarget(t: EventTarget | null): boolean {
  if (!(t instanceof HTMLElement)) return false;
  return t.isContentEditable || ["INPUT", "TEXTAREA", "SELECT"].includes(t.tagName);
}

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

  // The thread in the reading pane. Restored from `?t=` on load so a reload or a
  // pasted link lands on the same conversation.
  const [openId, setOpenId] = useState<string | null>(null);
  useEffect(() => {
    const t = new URLSearchParams(window.location.search).get(OPEN_PARAM);
    if (t) setOpenId(t);
  }, []);
  const openThread = useCallback((id: string | null) => {
    setOpenId(id);
    writeOpenParam(id);
  }, []);

  // Threads read in this visit. Opening a thread marks it read on the server;
  // this un-bolds its row immediately instead of after the refresh lands.
  const [readIds, setReadIds] = useState<ReadonlySet<string>>(() => new Set());

  function handleClear() {
    const n = visible.filter((c) => c.status === "open").length;
    if (!confirm(`Clear ${n} open thread${n === 1 ? "" : "s"}${filter !== "all" ? ` in ${filter}` : ""}? This cannot be undone.`)) return;
    setClearError(null);
    startClearTransition(async () => {
      const r = await clearInbox(filter !== "all" ? { category: filter as InboxCategory } : undefined);
      if (r.ok) {
        openThread(null);
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
  // Snoozed threads leave the active list and sit in their own collapsible
  // section until their wake time returns them to open (autoUnsnoozeExpired).
  const active = useMemo(() => visible.filter((c) => c.status !== "snoozed"), [visible]);
  const snoozed = useMemo(() => visible.filter((c) => c.status === "snoozed"), [visible]);
  // The server hands over as many as 100 threads. Render a screenful of rows and
  // reveal the rest on request; `active` is already ranked hottest-first.
  const [shown, setShown] = useState(CARDS_PER_PAGE);
  const activeShown = useMemo(() => active.slice(0, shown), [active, shown]);
  const hiddenCount = active.length - activeShown.length;
  const [showSnoozed, setShowSnoozed] = useState(false);

  const grouped = useMemo(
    () =>
      BUCKETS.map((b) => ({ bucket: b, rows: activeShown.filter((c) => c.bucket === b.key) })).filter(
        (g) => g.rows.length > 0,
      ),
    [activeShown],
  );
  // The rows in the order they appear on screen — what ↑/↓ walk through.
  const order = useMemo(
    () => [...grouped.flatMap((g) => g.rows), ...(showSnoozed ? snoozed : [])].map((c) => c.id),
    [grouped, snoozed, showSnoozed],
  );

  const openCard = useMemo(() => (openId ? (cards.find((c) => c.id === openId) ?? null) : null), [cards, openId]);

  // Opening an unread thread reads it, as in Gmail.
  useEffect(() => {
    if (!openCard || !openCard.unread || readIds.has(openCard.id)) return;
    const id = openCard.id;
    setReadIds((prev) => new Set(prev).add(id));
    bulkThreadAction([id], "read").catch(() => {});
  }, [openCard, readIds]);

  const move = useCallback(
    (delta: 1 | -1) => {
      if (!order.length) return;
      const at = openId ? order.indexOf(openId) : -1;
      const next = at < 0 ? order[delta === 1 ? 0 : order.length - 1] : order[at + delta];
      if (next) openThread(next);
    },
    [order, openId, openThread],
  );

  // After Done, Snooze or Delete the thread leaves the list; the pane moves on to
  // the next one rather than going blank, the way Gmail does.
  const advanceFrom = useCallback(
    (id: string) => {
      const at = order.indexOf(id);
      const next = at < 0 ? null : (order[at + 1] ?? order[at - 1] ?? null);
      openThread(next);
    },
    [order, openThread],
  );

  // ↑/↓ (and j/k) move between threads, Esc closes the pane. Ignored while the
  // operator is typing, so the composer and the search box keep their keys.
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.defaultPrevented || e.altKey || e.ctrlKey || e.metaKey || isTypingTarget(e.target)) return;
      if (e.key === "ArrowDown" || e.key === "j") {
        e.preventDefault();
        move(1);
      } else if (e.key === "ArrowUp" || e.key === "k") {
        e.preventDefault();
        move(-1);
      } else if (e.key === "Escape" && openId) {
        openThread(null);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [move, openId, openThread]);

  // Run a bulk triage action over the current selection, then clear it.
  const runBulk = useCallback(
    (action: BulkAction) => {
      const ids = visible.filter((c) => selected.has(c.id)).map((c) => c.id);
      if (!ids.length) return;
      startBulkTransition(async () => {
        const r = await bulkThreadAction(ids, action);
        if (r.ok) {
          if (action === "read") setReadIds((prev) => new Set([...prev, ...ids]));
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

  const position = openId ? order.indexOf(openId) : -1;

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
          const on = filter === f.key;
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
                on
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

      {/* Split view: rows on the left, the open thread on the right. On a phone
          the open thread takes the whole screen and Back returns to the list. */}
      <div className="grid items-start gap-4 lg:grid-cols-[minmax(0,5fr)_minmax(0,7fr)]">
        <div className={openCard ? "hidden lg:block" : ""}>
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
            <div className="flex flex-col gap-3">
              {grouped.map(({ bucket, rows }) => (
                <section key={bucket.key}>
                  <h2 className="mb-1 flex items-center gap-2 px-1 font-mono text-[11px] uppercase tracking-widest">
                    <span className={bucket.tone}>{bucket.label}</span>
                    <span className="text-fg-muted">{rows.length}</span>
                  </h2>
                  <ul className="fx-card divide-y divide-line/60 overflow-hidden p-0">
                    {rows.map((c) => (
                      <ThreadRow
                        key={c.id}
                        card={c}
                        unread={c.unread && !readIds.has(c.id)}
                        selected={selected.has(c.id)}
                        open={c.id === openId}
                        onToggleSelect={toggleSelect}
                        onOpen={openThread}
                      />
                    ))}
                  </ul>
                </section>
              ))}
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
            </div>
          )}

          {/* Snoozed — collapsed by default; each returns to the list at its wake time. */}
          {snoozed.length > 0 ? (
            <section className="mt-4">
              <button
                type="button"
                onClick={() => setShowSnoozed((s) => !s)}
                className="mb-1 flex items-center gap-2 px-1 font-mono text-[11px] uppercase tracking-widest text-fg-muted transition hover:text-fg-primary"
                aria-expanded={showSnoozed}
              >
                <span className="text-[11px]">{showSnoozed ? "▾" : "▸"}</span>
                Snoozed
                <span>{snoozed.length}</span>
              </button>
              {showSnoozed ? (
                <ul className="fx-card divide-y divide-line/60 overflow-hidden p-0">
                  {snoozed.map((c) => (
                    <ThreadRow
                      key={c.id}
                      card={c}
                      unread={c.unread && !readIds.has(c.id)}
                      selected={selected.has(c.id)}
                      open={c.id === openId}
                      onToggleSelect={toggleSelect}
                      onOpen={openThread}
                    />
                  ))}
                </ul>
              ) : null}
            </section>
          ) : null}
        </div>

        {openCard ? (
          <ThreadPane
            key={openCard.id}
            card={openCard}
            teammates={teammates}
            onClose={() => openThread(null)}
            onPrev={position > 0 ? () => move(-1) : null}
            onNext={position >= 0 && position < order.length - 1 ? () => move(1) : null}
            onRemoved={advanceFrom}
          />
        ) : (
          <div className="fx-card hidden p-10 text-center text-sm text-fg-muted lg:sticky lg:top-4 lg:block">
            Select a conversation to read it here.
            <p className="mt-1 text-xs">↑ ↓ move between threads · Esc closes</p>
          </div>
        )}
      </div>
    </div>
  );
}

/**
 * One row of the list, Gmail-style: select, star, sender, subject and snippet,
 * time. Clicking it opens the thread in the reading pane.
 *
 * Memoized: the board holds the selection, the open thread and the filters, so
 * without this every keystroke of triage re-rendered every row. Its callbacks are
 * `useCallback`s with stable dependencies, and `selected`/`open`/`unread` flip
 * only for the rows they concern.
 */
const ThreadRow = memo(function ThreadRow({
  card,
  unread,
  selected,
  open,
  onToggleSelect,
  onOpen,
}: {
  card: InboxCardData;
  unread: boolean;
  selected: boolean;
  open: boolean;
  onToggleSelect: (id: string) => void;
  onOpen: (id: string) => void;
}) {
  const router = useRouter();
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

  // Keep the open row on screen as ↑/↓ walk the list.
  const ref = useRef<HTMLLIElement>(null);
  useEffect(() => {
    if (open) ref.current?.scrollIntoView?.({ block: "nearest" });
  }, [open]);

  const when =
    card.status === "snoozed" && card.snoozedUntil ? `💤 ${rowTime(card.snoozedUntil)}` : rowTime(card.lastMessageAt);

  return (
    <li
      ref={ref}
      className={`flex items-center gap-2 px-2.5 py-2 text-sm transition ${
        open ? "bg-gold-500/10" : selected ? "bg-gold-500/5" : unread ? "bg-surface-1" : "hover:bg-surface-2/60"
      }`}
    >
      <input
        type="checkbox"
        checked={selected}
        onChange={() => onToggleSelect(card.id)}
        aria-label={`Select thread: ${card.subject}`}
        className="h-3.5 w-3.5 shrink-0 cursor-pointer accent-gold-500"
      />
      <button
        type="button"
        onClick={toggleStar}
        disabled={starPending}
        aria-pressed={starred}
        aria-label={starred ? "Unstar thread" : "Star thread"}
        title={starred ? "Starred — click to unstar" : "Star this thread"}
        className={`shrink-0 text-sm leading-none transition disabled:opacity-50 ${
          starred ? "text-gold-300" : "text-fg-muted hover:text-gold-300"
        }`}
      >
        {starred ? "★" : "☆"}
      </button>
      <button
        type="button"
        onClick={() => onOpen(card.id)}
        aria-current={open ? "true" : undefined}
        aria-label={`Open thread: ${card.subject} from ${card.counterparty}`}
        className="flex min-w-0 flex-1 flex-col gap-0.5 text-left sm:flex-row sm:items-center sm:gap-3"
      >
        <span className="flex min-w-0 items-center gap-1.5 sm:w-40 sm:shrink-0">
          <span aria-hidden className="shrink-0 font-mono text-xs text-gold-300" title={card.channelLabel}>
            {card.channelIcon}
          </span>
          <span className={`truncate ${unread ? "font-semibold text-fg-primary" : "text-fg-secondary"}`}>
            {card.counterparty}
          </span>
        </span>
        <span className="min-w-0 flex-1 truncate">
          {card.draft ? <span className="mr-1.5 text-status-danger">Draft</span> : null}
          <span className={unread ? "font-semibold text-fg-primary" : "text-fg-primary"}>{card.subject}</span>
          {card.snippet ? <span className="text-fg-muted"> — {card.snippet}</span> : null}
        </span>
        <span
          className={`shrink-0 font-mono text-[11px] sm:text-right ${unread ? "font-semibold text-fg-primary" : "text-fg-muted"}`}
        >
          {when}
        </span>
      </button>
    </li>
  );
});

/**
 * The reading pane: the open thread in full — Earn's summary, its links, owner
 * and next moves — above the conversation and the composer.
 *
 * Keyed by thread id by the board, so moving to another thread starts clean.
 */
function ThreadPane({
  card,
  teammates,
  onClose,
  onPrev,
  onNext,
  onRemoved,
}: {
  card: InboxCardData;
  teammates: Teammate[];
  onClose: () => void;
  onPrev: (() => void) | null;
  onNext: (() => void) | null;
  /** The thread left the list (done, snoozed, deleted); move the pane on. */
  onRemoved: (id: string) => void;
}) {
  const router = useRouter();
  const [result, setResult] = useState<ThreadActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<string | null>(null);
  const [deleting, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);
  const [assigning, startAssignTransition] = useTransition();

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

  // The conversation reports its draft/send outcome back up so results show in
  // one place, under the action row.
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
      onRemoved(card.id);
      router.refresh();
    });
  }, [card.id, router, onRemoved]);

  function run(key: string, fn: () => Promise<ThreadActionResult>, leaves = false) {
    setResult(null);
    startTransition(async () => {
      setActive(key);
      const r = await fn();
      setResult(r);
      // Refresh server components so the nav badge and thread list reflect the
      // change immediately rather than waiting for the 30-second poll.
      if (r.ok) {
        if (leaves) onRemoved(card.id);
        router.refresh();
      }
    });
  }

  function fd(extra: Record<string, string>): FormData {
    const f = new FormData();
    f.set("thread_id", card.id);
    for (const [k, v] of Object.entries(extra)) f.set(k, v);
    return f;
  }

  return (
    <article
      aria-label={`Thread: ${card.subject}`}
      className="fx-card fixed inset-0 z-40 overflow-y-auto rounded-none p-4 lg:sticky lg:inset-auto lg:top-4 lg:z-auto lg:max-h-[calc(100vh-2rem)] lg:rounded-xl"
    >
      <div className="mb-3 flex items-center gap-2">
        <button
          type="button"
          onClick={onClose}
          aria-label="Close thread"
          title="Close (Esc)"
          className="rounded-md px-2 py-1 text-xs text-fg-secondary transition hover:text-fg-primary"
        >
          <span className="lg:hidden">← Back</span>
          <span className="hidden lg:inline">✕ Close</span>
        </button>
        <div className="ml-auto flex items-center gap-1">
          <button
            type="button"
            disabled={!onPrev}
            onClick={() => onPrev?.()}
            aria-label="Previous thread"
            title="Previous thread (↑ or k)"
            className="rounded-md border border-line px-2 py-0.5 text-xs text-fg-secondary transition hover:border-gold-500 disabled:opacity-40"
          >
            ↑
          </button>
          <button
            type="button"
            disabled={!onNext}
            onClick={() => onNext?.()}
            aria-label="Next thread"
            title="Next thread (↓ or j)"
            className="rounded-md border border-line px-2 py-0.5 text-xs text-fg-secondary transition hover:border-gold-500 disabled:opacity-40"
          >
            ↓
          </button>
        </div>
      </div>

      <h2 className="text-lg font-semibold leading-snug text-fg-primary">{card.subject}</h2>
      <p className="mt-0.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
        <span aria-hidden>{card.channelIcon}</span> {card.counterparty} · {card.channelLabel}
        {card.intent ? ` · ${card.intent}` : ""}
      </p>

      {card.summary ? (
        <div className="mt-3 rounded-lg border border-gold-500/25 bg-gold-500/5 px-3 py-2">
          <p className="font-mono text-[11px] uppercase tracking-wider text-gold-300/80">✦ Earn summary</p>
          <p className="mt-0.5 text-sm text-fg-secondary">{card.summary}</p>
        </div>
      ) : null}

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
        {card.meeting ? (
          <Link href={card.meeting.href} className="text-gold-300 hover:underline">
            Follow-up of {card.meeting.title} →
          </Link>
        ) : null}
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
          onClick={() =>
            run(
              "done",
              async () => {
                const r = await setThreadStatus(fd({ status: "done", unread: "false" }));
                return r.ok ? { ok: true, message: "Marked done." } : { ok: false, error: "Failed to mark as done. Try again." };
              },
              true,
            )
          }
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
              run(
                "snooze",
                async () => {
                  const r = await snoozeThread(card.id, iso);
                  return r.ok ? { ok: true, message: `Snoozed until ${preset.label.toLowerCase()}.` } : { ok: false, error: "Failed to snooze. Try again." };
                },
                true,
              );
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
          {!result.ok && result.needsMailbox ? (
            <>
              {" "}
              <Link href="/settings/integrations" className="underline underline-offset-2">
                Connect Gmail to send →
              </Link>
            </>
          ) : null}
        </p>
      ) : null}
      {deleteError ? (
        <p className="mt-2 text-xs text-status-danger">{deleteError}</p>
      ) : null}

      <ThreadConversation card={card} onResult={onPanelResult} />
    </article>
  );
}
