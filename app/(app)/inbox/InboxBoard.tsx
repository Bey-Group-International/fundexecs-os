"use client";

import { useMemo, useState, useTransition, useCallback } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { ActionKind, GateTier } from "@/lib/gates";
import type { InboxCategory, InboxChannel } from "@/lib/supabase/database.types";
import { actOnThread, shareCommandCenter, setThreadStatus, deleteThreadAction, clearInbox, type ThreadActionResult } from "./actions";

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
  unread: boolean;
  status: "open" | "snoozed" | "done";
  meetingAt: string | null;
  meetingUrl: string | null;
  context: { kind: "deal" | "investor"; id: string; name: string; href: string } | null;
  suggested: { action: ActionKind; label: string; tier: GateTier } | null;
  canShare: boolean;
  shareTier: GateTier;
}

// Tier → badge color. Mirrors the gate semantics used across the app: green =
// free, gold = sign-off, red = never delegable.
const TIER_STYLE: Record<GateTier, string> = {
  1: "border-status-success/40 text-status-success",
  2: "border-gold-500/50 text-gold-400",
  3: "border-status-danger/50 text-status-danger",
};

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
];

export function InboxBoard({ cards }: { cards: InboxCardData[] }) {
  const router = useRouter();
  const [filter, setFilter] = useState<"all" | InboxCategory>("all");
  const [clearing, startClearTransition] = useTransition();
  const [clearError, setClearError] = useState<string | null>(null);

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
    () => cards.filter((c) => c.status !== "done" && (filter === "all" || c.category === filter)),
    [cards, filter],
  );

  const counts = useMemo(() => {
    const m = new Map<string, number>();
    for (const c of cards) {
      if (c.status === "done") continue;
      m.set("all", (m.get("all") ?? 0) + 1);
      m.set(c.category, (m.get(c.category) ?? 0) + 1);
    }
    return m;
  }, [cards]);

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

      {visible.length === 0 ? (
        <p className="px-1 py-6 text-sm text-fg-muted">Nothing here — inbox clear for this filter.</p>
      ) : (
        BUCKETS.map((bucket) => {
          const inBucket = visible.filter((c) => c.bucket === bucket.key);
          if (inBucket.length === 0) return null;
          return (
            <section key={bucket.key}>
              <h2 className="mb-2 flex items-center gap-2 font-mono text-[10px] uppercase tracking-widest">
                <span className={bucket.tone}>{bucket.label}</span>
                <span className="text-fg-muted">{inBucket.length}</span>
              </h2>
              <div className="flex flex-col gap-2">
                {inBucket.map((c) => (
                  <ThreadCard key={c.id} card={c} />
                ))}
              </div>
            </section>
          );
        })
      )}
    </div>
  );
}

function relativeMeeting(iso: string): string {
  const d = new Date(iso);
  return d.toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
}

function ThreadCard({ card }: { card: InboxCardData }) {
  const router = useRouter();
  const [result, setResult] = useState<ThreadActionResult | null>(null);
  const [pending, startTransition] = useTransition();
  const [active, setActive] = useState<string | null>(null);
  const [deleting, startDeleteTransition] = useTransition();
  const [deleteError, setDeleteError] = useState<string | null>(null);

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
    <div className="fx-card fx-card-hover relative overflow-hidden p-4">
      <span
        aria-hidden
        className="absolute inset-y-0 left-0 w-1 bg-gradient-to-b from-gold-500/60 to-transparent"
        style={{ opacity: card.priority / 100 }}
      />

      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
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
        <span className="shrink-0 font-mono text-[10px] text-fg-muted" title="Triage priority">
          {card.priority}
        </span>
      </div>

      {card.summary ? <p className="mt-2 line-clamp-2 text-sm text-fg-secondary">{card.summary}</p> : null}

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
        {card.meetingUrl ? (
          <a href={card.meetingUrl} target="_blank" rel="noreferrer" className="text-gold-400 hover:underline">
            Meeting link →
          </a>
        ) : null}
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
        <button
          type="button"
          disabled={pending || deleting}
          onClick={() => run("snooze", async () => {
            const r = await setThreadStatus(fd({ status: "snoozed", unread: "false" }));
            return r.ok ? { ok: true, message: "Snoozed." } : { ok: false, error: "Failed to snooze. Try again." };
          })}
          className="rounded-md px-2 py-1 text-xs text-fg-muted transition hover:text-fg-primary disabled:opacity-50"
        >
          Snooze
        </button>
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
