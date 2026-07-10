"use client";

import { useMemo, useState, useTransition, useCallback } from "react";
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
  getThreadMessages,
  replyToThread,
  draftThreadReply,
  assignThread,
  setThreadStar,
  bulkThreadAction,
  snoozeThread,
  type ThreadActionResult,
  type ThreadMessageView,
  type Teammate,
  type BulkAction,
} from "./actions";

// Snooze presets, resolved to an absolute wake time when chosen (client-side so
// it's the operator's local clock). "Tomorrow" is 9am the next day.
// The only inbox channel whose dispatch adapter actually sends a live external
// reply once connected (lib/integrations/adapters/gmail.ts). Every other
// channel's connected branch reports an honest not-delivered result rather
// than calling out — so the composer hint below must not claim they behave
// the same as Gmail once "connected".
const LIVE_CAPABLE_CHANNELS = new Set<InboxChannel>(["gmail"]);

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

const BUCKETS = [
  { key: "now", label: "Needs you now", tone: "text-status-success" },
  { key: "soon", label: "Soon", tone: "text-gold-400" },
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
              <span className="ml-1.5 font-mono text-[10px] text-fg-muted">{tabCounts[t.key]}</span>
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
              onClick={() => setFilter(f.key)}
              className={`rounded-full border px-3 py-1 text-xs transition ${
                active
                  ? "border-gold-500 bg-gold-500/10 text-gold-300"
                  : "border-line text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
              }`}
            >
              {f.label}
              <span className="ml-1.5 font-mono text-[10px] text-fg-muted">{n}</span>
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
                className="text-gold-400 transition hover:underline"
              >
                See {tabCounts.other} in Other →
              </button>
            </>
          ) : (
            "Nothing here — inbox clear for this filter."
          )}
        </p>
      ) : (
        BUCKETS.map((bucket) => {
          const inBucket = active.filter((c) => c.bucket === bucket.key);
          if (inBucket.length === 0) return null;
          return (
            <section key={bucket.key}>
              <h2 className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
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
        })
      )}

      {/* Snoozed — collapsed by default; each returns to the board at its wake time. */}
      {snoozed.length > 0 ? (
        <section>
          <button
            type="button"
            onClick={() => setShowSnoozed((s) => !s)}
            className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest text-fg-muted transition hover:text-fg-primary"
            aria-expanded={showSnoozed}
          >
            <span className="text-[9px]">{showSnoozed ? "▾" : "▸"}</span>
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

// Compact absolute time, e.g. "Jul 3, 9:00 AM" — used for meeting and snooze-wake labels.
function relativeMeeting(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ThreadCard({
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

  // Expandable conversation view + inline composer.
  const [expanded, setExpanded] = useState(false);
  const [messages, setMessages] = useState<ThreadMessageView[] | null>(null);
  const [msgLoading, startMsgTransition] = useTransition();
  const [replyText, setReplyText] = useState("");
  const [drafting, startDraftTransition] = useTransition();

  const loadMessages = useCallback(() => {
    startMsgTransition(async () => {
      setMessages(await getThreadMessages(card.id));
    });
  }, [card.id]);

  // Draft a reply with Earn and drop it into the composer for review/edit. This
  // never sends — the operator still hits Send (the gated move) themselves.
  const draftWithEarn = useCallback(() => {
    setResult(null);
    startDraftTransition(async () => {
      const r = await draftThreadReply(card.id);
      if (r.ok && r.draft) {
        setReplyText(r.draft);
      } else {
        setResult({ ok: false, error: r.error ?? "Couldn't draft a reply. Try again." });
      }
    });
  }, [card.id]);

  const toggleThread = useCallback(() => {
    setExpanded((open) => {
      const next = !open;
      if (next && messages === null) loadMessages();
      return next;
    });
  }, [messages, loadMessages]);

  const sendReply = useCallback(() => {
    const body = replyText.trim();
    if (!body) return;
    setResult(null);
    startTransition(async () => {
      setActive("reply");
      const f = new FormData();
      f.set("thread_id", card.id);
      f.set("body", body);
      const r = await replyToThread(f);
      setResult(r);
      if (r.ok) {
        setReplyText("");
        loadMessages();
        router.refresh();
      }
    });
    // startTransition / setActive are stable; card.id, replyText, loadMessages, router captured.
  }, [replyText, card.id, loadMessages, router, startTransition]);

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
            <span className="font-mono text-base leading-none text-gold-400" title={card.channelLabel}>
              {card.channelIcon}
            </span>
            <h3 className={`truncate text-sm ${card.unread ? "font-semibold text-fg-primary" : "text-fg-primary"}`}>
              {card.subject}
            </h3>
            {card.unread ? <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold-400" title="Unread" /> : null}
          </div>
          <p className="mt-0.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
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
              starred ? "text-gold-400" : "text-fg-muted hover:text-gold-400"
            }`}
          >
            {starred ? "★" : "☆"}
          </button>
          <span className="font-mono text-[10px] text-fg-muted" title="Triage priority">
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
          <Link href={card.context.href} className="text-gold-400 hover:underline">
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
          <a href={card.meetingUrl} target="_blank" rel="noreferrer" className="text-gold-400 hover:underline">
            Meeting link →
          </a>
        ) : null}
        {/* Assignee picker — route the thread to a teammate. */}
        <label className="ml-auto inline-flex items-center gap-1 text-fg-muted">
          <span className="font-mono text-[9px] uppercase tracking-wider">Owner</span>
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
        <span className="font-mono text-[9px]">{expanded ? "▾" : "▸"}</span>
        {expanded ? "Hide thread" : "View thread"}
      </button>

      {expanded ? (
        <div className="mt-2 rounded-lg border border-line/70 bg-surface-0/40 p-3">
          {msgLoading && messages === null ? (
            <p className="text-xs text-fg-muted">Loading conversation…</p>
          ) : messages && messages.length > 0 ? (
            <div className="flex flex-col gap-2">
              {messages.map((m) => (
                <div
                  key={m.id}
                  className={`max-w-[85%] rounded-lg px-3 py-2 text-sm ${
                    m.direction === "outbound"
                      ? "self-end border border-gold-500/30 bg-gold-500/10 text-fg-primary"
                      : "self-start border border-line/60 bg-surface-1 text-fg-secondary"
                  }`}
                >
                  <div className="mb-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                    {m.author ?? (m.direction === "outbound" ? "You" : card.counterparty)} · {relativeMeeting(m.occurredAt)}
                  </div>
                  <div className="whitespace-pre-wrap break-words">{m.body}</div>
                </div>
              ))}
            </div>
          ) : (
            <p className="text-xs text-fg-muted">No messages on this thread yet.</p>
          )}

          {/* Inline composer — routes through the same gate as every outward move. */}
          <div className="mt-3 border-t border-line/60 pt-3">
            {/* One-tap smart replies — populate the composer for review; the
                send is still the operator's gated move. Hidden once they type. */}
            {card.quickReplies.length > 0 && !replyText.trim() ? (
              <div className="mb-2 flex flex-wrap gap-1.5">
                {card.quickReplies.map((qr) => (
                  <button
                    key={qr}
                    type="button"
                    onClick={() => setReplyText(qr)}
                    className="rounded-full border border-line bg-surface-1 px-2.5 py-1 text-xs text-fg-secondary transition hover:-translate-y-px hover:border-gold-500 hover:text-fg-primary"
                  >
                    {qr}
                  </button>
                ))}
              </div>
            ) : null}
            <textarea
              value={replyText}
              onChange={(e) => setReplyText(e.target.value)}
              rows={2}
              placeholder={`Reply to ${card.counterparty}…`}
              className="w-full resize-none rounded-md border border-line bg-surface-2 px-2.5 py-2 text-sm text-fg-primary outline-none placeholder:text-fg-muted focus:border-gold-500"
            />
            <div className="mt-1.5 flex flex-wrap items-center justify-between gap-2">
              {card.connected && LIVE_CAPABLE_CHANNELS.has(card.channel) ? (
                <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  Routes through connected {card.channelLabel} · approvals if required
                </span>
              ) : card.connected ? (
                <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  {card.channelLabel} sending isn&apos;t live yet — this will be recorded on the thread but not delivered.
                </span>
              ) : (
                <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                  {card.channelLabel} not connected — sends save as drafts.{" "}
                  <Link href="/settings/integrations" className="text-gold-400 hover:underline">
                    Connect →
                  </Link>
                </span>
              )}
              <div className="flex items-center gap-2">
                <button
                  type="button"
                  disabled={drafting || pending}
                  onClick={draftWithEarn}
                  title="Draft a reply with Earn — you review and edit before sending"
                  className="inline-flex items-center gap-1 rounded-md border border-gold-500/40 bg-gold-500/5 px-3 py-1.5 text-sm text-gold-300 transition hover:-translate-y-px hover:border-gold-500 disabled:opacity-50"
                >
                  {drafting ? "Drafting…" : "✦ Draft with Earn"}
                </button>
                <button
                  type="button"
                  disabled={pending || drafting || !replyText.trim()}
                  onClick={sendReply}
                  className="rounded-md border border-line bg-surface-0/80 px-3 py-1.5 text-sm text-fg-primary transition hover:-translate-y-px hover:border-gold-500 disabled:opacity-50"
                >
                  {pending && active === "reply" ? "Sending…" : "Send reply"}
                </button>
              </div>
            </div>
          </div>
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
            <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${TIER_STYLE[card.suggested.tier]}`}>
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
            <span className={`rounded-full border px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider ${TIER_STYLE[card.shareTier]}`}>
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
}
