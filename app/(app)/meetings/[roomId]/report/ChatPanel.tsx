"use client";

// The chat, kept.
//
// Everything said in the chat during a meeting used to end with the meeting:
// it was a broadcast into a React array, so the links people shared, the
// numbers they pasted and the questions nobody got to out loud were gone the
// moment the call did. The report carried the transcript of what was *said*
// and nothing of what was *typed*, which for most calls is where the documents
// were.
//
// Now the rows survive, so the record can show them — read through the
// viewer's own client, under the same attendees-only rule the report obeys.

import { memo, useMemo, useState } from "react";
import { chatClock, groupChat, type ChatMessage } from "@/lib/meetings/chat";
import { speakerColorIndex } from "@/lib/meetings/speaker-attribution";
import { speakerInitials } from "@/lib/meetings/transcript-view";
import { ChatText } from "../ChatText";

/** The same palette the call and the transcript use, so a person keeps theirs. */
const SPEAKER_COLORS = [
  "var(--gold-400)",
  "#7dd3fc",
  "#c4b5fd",
  "#86efac",
  "#fda4af",
  "#fdba74",
];

/**
 * Memoised because the report page holds the recording's playhead in its own
 * state, and only the transcript reads it. Without this, every second of
 * playback re-rendered this component for nothing.
 *
 * It is handed its messages rather than reading them. It used to fetch on mount,
 * which made the chat a browser round trip that could not even START until the
 * page's JavaScript had booted and the report had rendered — for content that
 * was finished before anybody opened the page. The read moved to the server
 * load; the identity rule that shaped these rows went to storedChatMessages,
 * where it can be tested without rendering anything.
 *
 * Still a client component: the panel collapses, and that is what it is for.
 */
export const ChatPanel = memo(function ChatPanel({ messages }: { messages: readonly ChatMessage[] }) {
  const [open, setOpen] = useState(false);

  const turns = useMemo(() => groupChat(messages), [messages]);
  const people = useMemo(
    () => [...new Map(messages.map((m) => [m.from, m.displayName])).values()],
    [messages],
  );

  // Most meetings type nothing. An empty "Chat" heading on every report would
  // be noise on the majority of pages to serve the minority.
  if (messages.length === 0) return null;

  const colorFor = (name: string) => SPEAKER_COLORS[speakerColorIndex(name, SPEAKER_COLORS.length)];

  return (
    <div className="rounded-xl border border-[var(--line)] bg-[var(--surface-1)]">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className="flex w-full items-center gap-3 px-4 py-3 text-left"
      >
        <span className={`shrink-0 text-[var(--fg-muted)] transition-transform ${open ? "rotate-90" : ""}`}>
          <ChevronIcon />
        </span>
        <span className="min-w-0 flex-1">
          <span className="block text-xs font-medium uppercase tracking-wide text-[var(--fg-secondary)]">
            Chat
          </span>
          <span className="mt-0.5 block text-xs text-[var(--fg-muted)]">
            {messages.length} message{messages.length === 1 ? "" : "s"}
            {people.length > 0 && ` · ${people.length} ${people.length === 1 ? "person" : "people"}`}
          </span>
        </span>
      </button>

      {open && (
        <ol className="max-h-[32rem] divide-y divide-[var(--line)] overflow-y-auto border-t border-[var(--line)]">
          {turns.map((turn) => (
            <li key={turn.id} className="flex gap-3 px-4 py-3 sm:gap-4">
              <div className="flex w-24 shrink-0 flex-col items-start gap-1 sm:w-32">
                <span
                  className="flex h-6 w-6 items-center justify-center rounded-full text-[10px] font-semibold text-[var(--surface-0)]"
                  style={{ background: colorFor(turn.displayName) }}
                >
                  {speakerInitials(turn.displayName)}
                </span>
                <span
                  className="w-full truncate text-xs font-medium text-[var(--fg-secondary)]"
                  title={turn.displayName}
                >
                  {turn.displayName}
                </span>
                <span className="font-mono text-[11px] tabular-nums text-[var(--fg-muted)]">
                  {chatClock(turn.ts)}
                </span>
              </div>
              <div className="min-w-0 flex-1 space-y-1.5">
                {turn.messages.map((msg) => (
                  <p
                    key={msg.id}
                    className="whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--fg-primary)]"
                  >
                    <ChatText text={msg.text} />
                  </p>
                ))}
              </div>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
});

function ChevronIcon() {
  return (
    <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
      <polyline points="9 18 15 12 9 6" />
    </svg>
  );
}
