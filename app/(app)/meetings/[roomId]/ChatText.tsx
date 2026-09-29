"use client";

import { memo } from "react";
import { chatParts } from "@/lib/meetings/chat";

/**
 * One chat message, with its links made clickable.
 *
 * Rendered as React nodes from `chatParts`, never as markup: this is other
 * people's text on everybody's screen. That is also why it took until now —
 * the previous version showed a shared URL as flat, unfollowable prose, which
 * is the commonest thing anyone puts in a meeting chat.
 *
 * Shared by the room and the report, so a link that was followable during the
 * call is still followable in the record of it.
 */
export const ChatText = memo(ChatTextImpl);

// Memoised on the text: the room re-renders several times a second while
// people talk, and without it every message in a long chat was re-scanned for
// links on each of those renders.
function ChatTextImpl({ text }: { text: string }) {
  return (
    <>
      {chatParts(text).map((part, i) =>
        part.kind === "link" ? (
          <a
            key={i}
            href={part.href}
            target="_blank"
            rel="noopener noreferrer nofollow"
            className="text-[var(--gold-400)] underline underline-offset-2 hover:text-[var(--gold-500)]"
          >
            {part.value}
          </a>
        ) : (
          <span key={i}>{part.value}</span>
        ),
      )}
    </>
  );
}
