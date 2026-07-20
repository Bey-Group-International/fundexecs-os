"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { createClient } from "@/lib/supabase/client";
import {
  isMessageVisible,
  sanitizeChatText,
  type ChatMessage,
} from "@/lib/office/chat";

// In-office chat. Opens its OWN Supabase broadcast channel (`office-chat:<org>`),
// SEPARATE from the presence/voice channels, so chat traffic never rides on —
// or contends with — the movement/heartbeat stream. Messages are broadcast with
// a scope: "office" reaches the whole org; "proximity" is stamped with the
// sender's tile-space position and only rendered by viewers standing within the
// proximity radius (filtered locally via `isMessageVisible`). A collapsed panel
// shows an unread badge for messages that would be visible to the viewer.

// Broadcast event carrying a single ChatMessage payload over the office channel.
const CHAT_EVENT = "message";
// Cap the retained backlog so a long-lived office tab can't grow unbounded.
const MAX_MESSAGES = 200;

type Scope = ChatMessage["scope"];

interface OfficeChatProps {
  orgId: string;
  userId: string;
  displayName: string;
  color: string;
  /** Live self position in tile space, read at send + filter time. */
  getSelfPos: () => { x: number; y: number };
  enabled: boolean;
}

export function OfficeChat({
  orgId,
  userId,
  displayName,
  color,
  getSelfPos,
  enabled,
}: OfficeChatProps) {
  const [open, setOpen] = useState(false);
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [unread, setUnread] = useState(0);
  const [draft, setDraft] = useState("");
  const [scope, setScope] = useState<Scope>("office");
  // Bumped on a timer while the panel is open so the proximity filter re-runs as
  // the viewer walks around (positions come from `getSelfPos`, not React state).
  const [, setTick] = useState(0);

  const channelRef = useRef<ReturnType<
    ReturnType<typeof createClient>["channel"]
  > | null>(null);
  const bottomRef = useRef<HTMLDivElement>(null);
  // Read live inside the broadcast handler without re-subscribing the channel.
  const openRef = useRef(open);
  const getSelfPosRef = useRef(getSelfPos);
  useEffect(() => {
    openRef.current = open;
  }, [open]);
  useEffect(() => {
    getSelfPosRef.current = getSelfPos;
  }, [getSelfPos]);

  // Subscribe to the dedicated office-chat channel. Guarded on `enabled` so the
  // disabled state opens no realtime connection at all.
  useEffect(() => {
    if (!enabled || typeof window === "undefined") return;
    const supabase = createClient();
    const channel = supabase.channel(`office-chat:${orgId}`, {
      config: { broadcast: { self: true } },
    });
    channelRef.current = channel;

    channel
      .on("broadcast", { event: CHAT_EVENT }, ({ payload }) => {
        const msg = payload as ChatMessage;
        if (!msg || typeof msg.text !== "string") return;
        setMessages((prev) => {
          const next = [...prev, msg];
          return next.length > MAX_MESSAGES
            ? next.slice(next.length - MAX_MESSAGES)
            : next;
        });
        // Badge only messages the viewer can actually see, are from someone
        // else, and that land while the panel is collapsed.
        if (
          !openRef.current &&
          msg.authorId !== userId &&
          isMessageVisible(msg, getSelfPosRef.current())
        ) {
          setUnread((n) => n + 1);
        }
      })
      .subscribe();

    return () => {
      channelRef.current = null;
      supabase.removeChannel(channel);
    };
  }, [enabled, orgId, userId]);

  // Keep the proximity filter fresh while open, and pin the transcript to the
  // newest message.
  useEffect(() => {
    if (!open) return;
    setUnread(0);
    const id = setInterval(() => setTick((t) => t + 1), 800);
    return () => clearInterval(id);
  }, [open]);

  // Recomputed every render — cheap over the bounded backlog — so the tick timer
  // and self-movement keep proximity-scoped messages in/out of view live.
  const selfPos = getSelfPos();
  const visible = messages.filter((m) => isMessageVisible(m, selfPos));

  useEffect(() => {
    if (open) bottomRef.current?.scrollIntoView({ block: "end" });
  }, [visible, open]);

  const send = useCallback(() => {
    const text = sanitizeChatText(draft);
    if (!text) return;
    const channel = channelRef.current;
    if (!channel) return;
    const pos = getSelfPos();
    const msg: ChatMessage = {
      id: crypto.randomUUID(),
      authorId: userId,
      authorName: displayName,
      color,
      text,
      scope,
      x: pos.x,
      y: pos.y,
      ts: Date.now(),
    };
    void channel.send({ type: "broadcast", event: CHAT_EVENT, payload: msg });
    setDraft("");
  }, [draft, getSelfPos, userId, displayName, color, scope]);

  if (!enabled) return null;

  if (!open) {
    return (
      <button
        onClick={() => setOpen(true)}
        className="relative flex h-11 items-center gap-2 rounded-full border border-[var(--line)] bg-[var(--surface-1)] px-4 text-sm font-medium text-[var(--fg-secondary)] shadow-xl transition-colors hover:bg-[var(--surface-2)] hover:text-[var(--fg-primary)]"
        title="Open office chat"
      >
        <ChatIcon />
        <span>Chat</span>
        {unread > 0 && (
          <span className="absolute -right-1 -top-1 flex h-5 min-w-[1.25rem] items-center justify-center rounded-full bg-[var(--gold-400)] px-1 text-[10px] font-bold text-black">
            {unread > 99 ? "99+" : unread}
          </span>
        )}
      </button>
    );
  }

  return (
    <div className="flex h-[26rem] w-80 flex-col overflow-hidden rounded-2xl border border-[var(--line)] bg-[var(--surface-1)] shadow-xl">
      {/* Header */}
      <div className="flex items-center justify-between border-b border-[var(--line)] px-4 py-3">
        <div className="flex items-center gap-2">
          <ChatIcon />
          <span className="text-sm font-semibold text-[var(--fg-primary)]">
            Office Chat
          </span>
        </div>
        <button
          onClick={() => setOpen(false)}
          className="text-[var(--fg-muted)] transition-colors hover:text-[var(--fg-primary)]"
          title="Collapse chat"
        >
          ✕
        </button>
      </div>

      {/* Messages */}
      <div className="flex flex-1 flex-col gap-2 overflow-y-auto p-3">
        {visible.length === 0 ? (
          <div className="flex flex-1 items-center justify-center px-4">
            <p className="text-center text-xs text-[var(--fg-muted)]">
              No messages yet. Say hello to the office, or switch to Nearby to
              talk to people around you.
            </p>
          </div>
        ) : (
          visible.map((m) => (
            <div key={m.id} className="flex flex-col gap-0.5">
              <div className="flex items-center gap-1.5">
                <span
                  className="text-xs font-semibold"
                  style={{ color: m.color }}
                >
                  {m.authorId === userId ? "You" : m.authorName}
                </span>
                {m.scope === "proximity" && (
                  <span className="rounded-full border border-[var(--line)] px-1.5 py-px text-[9px] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
                    Nearby
                  </span>
                )}
              </div>
              <div className="rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-1.5 text-sm text-[var(--fg-primary)] break-words">
                {m.text}
              </div>
            </div>
          ))
        )}
        <div ref={bottomRef} />
      </div>

      {/* Scope toggle */}
      <div className="flex gap-1 border-t border-[var(--line)] px-3 pt-2">
        {(["office", "proximity"] as const).map((s) => (
          <button
            key={s}
            onClick={() => setScope(s)}
            className={`rounded-full px-2.5 py-1 text-[11px] font-medium transition-colors ${
              scope === s
                ? "bg-[var(--gold-400)]/15 text-[var(--gold-400)]"
                : "text-[var(--fg-muted)] hover:text-[var(--fg-secondary)]"
            }`}
          >
            {s === "office" ? "Office" : "Nearby"}
          </button>
        ))}
      </div>

      {/* Composer */}
      <div className="flex gap-2 p-3">
        <input
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              send();
            }
          }}
          maxLength={500}
          placeholder={
            scope === "office" ? "Message the office…" : "Message people nearby…"
          }
          className="flex-1 rounded-lg border border-[var(--line)] bg-[var(--surface-2)] px-3 py-2 text-sm text-[var(--fg-primary)] placeholder:text-[var(--fg-muted)] focus:outline-none focus:ring-2 focus:ring-[var(--gold-400)]"
        />
        <button
          onClick={send}
          disabled={!draft.trim()}
          className="rounded-lg bg-[var(--gold-400)] px-3 py-2 text-xs font-semibold text-black transition-colors hover:bg-[var(--gold-500)] disabled:opacity-40"
        >
          Send
        </button>
      </div>
    </div>
  );
}

function ChatIcon() {
  return (
    <svg
      width="16"
      height="16"
      viewBox="0 0 16 16"
      fill="none"
      aria-hidden="true"
    >
      <path
        d="M2 3.5A1.5 1.5 0 0 1 3.5 2h9A1.5 1.5 0 0 1 14 3.5v6a1.5 1.5 0 0 1-1.5 1.5H6l-3 3v-3H3.5A1.5 1.5 0 0 1 2 9.5v-6Z"
        stroke="currentColor"
        strokeWidth="1.3"
        strokeLinejoin="round"
      />
    </svg>
  );
}
