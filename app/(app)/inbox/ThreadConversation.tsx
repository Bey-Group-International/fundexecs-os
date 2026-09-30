"use client";

import { useCallback, useEffect, useState, useTransition } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";
import type { InboxChannel } from "@/lib/supabase/database.types";
import { relativeMeeting } from "./format";
import {
  getThreadMessages,
  replyToThread,
  draftThreadReply,
  suggestSmartReplies,
  type ThreadActionResult,
  type ThreadMessageView,
} from "./actions";

// The only inbox channel whose dispatch adapter actually sends a live external
// reply once connected (lib/integrations/adapters/gmail.ts). Every other
// channel's connected branch reports an honest not-delivered result rather
// than calling out — so the composer hint below must not claim they behave
// the same as Gmail once "connected".
const LIVE_CAPABLE_CHANNELS = new Set<InboxChannel>(["gmail"]);

// Just the card fields the conversation panel reads. Declared here rather than
// imported from InboxBoard so nothing in this module's import graph points back
// at the board — the board loads this file lazily, and a static edge either way
// would defeat that.
export interface ThreadConversationCard {
  id: string;
  counterparty: string;
  channel: InboxChannel;
  channelLabel: string;
  connected: boolean;
  quickReplies: string[];
  /** An unsent draft waiting on this thread — a meeting report's follow-up. */
  draft: { body: string; origin: string } | null;
}

/**
 * The expanded half of a thread card: the conversation transcript and the
 * inline composer (smart replies, Draft with Earn, Send).
 *
 * Split out of InboxBoard and loaded on demand. Expanding a thread was already
 * an async step — it fetches the transcript with `getThreadMessages` — so the
 * chunk request rides along with a round trip the operator was waiting on
 * anyway, while the ~200 lines of composer code and five pieces of state stop
 * being paid for by every collapsed card on the board.
 *
 * Send results are reported up via `onResult` so the card keeps rendering them
 * in the same place it always has.
 */
export function ThreadConversation({
  card,
  onResult,
}: {
  card: ThreadConversationCard;
  onResult: (result: ThreadActionResult | null, active: string | null) => void;
}) {
  const router = useRouter();
  const [messages, setMessages] = useState<ThreadMessageView[] | null>(null);
  const [msgLoading, startMsgTransition] = useTransition();
  // Seeded from the draft, so opening a thread the report drafted onto puts the
  // words in the composer rather than somewhere the operator has to go and find
  // them. Editable from that moment: it is a draft, and the send is still theirs.
  const [replyText, setReplyText] = useState(card.draft?.body ?? "");
  // Cleared the moment a reply goes out. Kept in state rather than read off the
  // prop, because a sent draft must stop being offered immediately — waiting for
  // the server round trip would leave "Nothing has been sent" under a message that
  // just went.
  const [draftNote, setDraftNote] = useState<string | null>(card.draft?.origin ?? null);
  const [sending, startSendTransition] = useTransition();
  const [drafting, startDraftTransition] = useTransition();
  // AI-personalized reply openers, fetched once when the thread is opened. Null
  // until they arrive; the template chips (card.quickReplies) show meanwhile, so
  // the row is never empty and the upgrade is a silent swap.
  const [aiReplies, setAiReplies] = useState<string[] | null>(null);

  const loadMessages = useCallback(() => {
    startMsgTransition(async () => {
      setMessages(await getThreadMessages(card.id));
    });
  }, [card.id]);

  // Mounting *is* the open, now that the card renders this only while expanded:
  // fetch the transcript, and kick off the AI openers alongside it. Progressive
  // enhancement — on any failure or the deterministic fallback we simply keep
  // showing the instant category templates.
  useEffect(() => {
    loadMessages();
    let alive = true;
    suggestSmartReplies(card.id)
      .then((r) => {
        if (alive && r.ok && r.live && r.replies?.length) setAiReplies(r.replies);
      })
      .catch(() => {});
    return () => {
      alive = false;
    };
    // loadMessages is stable for a given card.id.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [card.id]);

  // Draft a reply with Earn and drop it into the composer for review/edit. This
  // never sends — the operator still hits Send (the gated move) themselves.
  const draftWithEarn = useCallback(() => {
    onResult(null, null);
    startDraftTransition(async () => {
      const r = await draftThreadReply(card.id);
      if (r.ok && r.draft) {
        setReplyText(r.draft);
      } else {
        onResult({ ok: false, error: r.error ?? "Couldn't draft a reply. Try again." }, "reply");
      }
    });
  }, [card.id, onResult]);

  const sendReply = useCallback(() => {
    const body = replyText.trim();
    if (!body) return;
    onResult(null, null);
    startSendTransition(async () => {
      const f = new FormData();
      f.set("thread_id", card.id);
      f.set("body", body);
      const r = await replyToThread(f);
      onResult(r, "reply");
      if (r.ok) {
        setReplyText("");
        // The reply has gone (or been queued for approval), so the draft of it is
        // no longer a draft. `replyToThread` deletes the row; this is the same
        // fact in the open panel, which would otherwise keep saying an unsent
        // draft is waiting until the refresh landed.
        setDraftNote(null);
        loadMessages();
        router.refresh();
      }
    });
  }, [replyText, card.id, loadMessages, router, onResult]);

  const chips = aiReplies ?? card.quickReplies;
  const showChips = chips.length > 0 && !replyText.trim();

  return (
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
              <div className="mb-0.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
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
        {/* Where the text in the composer came from, and — the part that matters —
            that it has not gone anywhere. A composer pre-filled with a paragraph
            somebody else wrote, with no explanation, reads as a message that was
            already sent. */}
        {draftNote ? (
          <p className="mb-2 inline-flex items-center gap-1 rounded-md border border-gold-500/40 bg-gold-500/5 px-2 py-1 font-mono text-[11px] uppercase tracking-wider text-gold-300">
            <span aria-hidden>✎</span> {draftNote}
          </p>
        ) : null}
        {/* One-tap smart replies — populate the composer for review; the
            send is still the operator's gated move. Hidden once they type.
            Category templates show instantly; context-aware AI openers swap
            in once suggestSmartReplies returns. */}
        {showChips ? (
          <div className="mb-2">
            {aiReplies ? (
              <p className="mb-1 font-mono text-[11px] uppercase tracking-wider text-gold-300/80">
                ✦ Suggested for this thread
              </p>
            ) : null}
            <div className="flex flex-wrap gap-1.5">
              {chips.map((qr) => (
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
            <span className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
              Routes through connected {card.channelLabel} · approvals if required
            </span>
          ) : card.connected ? (
            <span className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
              {card.channelLabel} sending isn&apos;t live yet — this will be recorded on the thread but not delivered.
            </span>
          ) : (
            <span className="font-mono text-[11px] uppercase tracking-wider text-fg-muted">
              {card.channelLabel} not connected — sends save as drafts.{" "}
              <Link href="/settings/integrations" className="text-gold-300 hover:underline">
                Connect →
              </Link>
            </span>
          )}
          <div className="flex items-center gap-2">
            <button
              type="button"
              disabled={drafting || sending}
              onClick={draftWithEarn}
              title="Draft a reply with Earn — you review and edit before sending"
              className="inline-flex items-center gap-1 rounded-md border border-gold-500/40 bg-gold-500/5 px-3 py-1.5 text-sm text-gold-300 transition hover:-translate-y-px hover:border-gold-500 disabled:opacity-50"
            >
              {drafting ? "Drafting…" : "✦ Draft with Earn"}
            </button>
            <button
              type="button"
              disabled={sending || drafting || !replyText.trim()}
              onClick={sendReply}
              className="rounded-md border border-line bg-surface-0/80 px-3 py-1.5 text-sm text-fg-primary transition hover:-translate-y-px hover:border-gold-500 disabled:opacity-50"
            >
              {sending ? "Sending…" : "Send reply"}
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
