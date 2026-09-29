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
 *
 * MEMOIZED, because `chatParts` scans the text with a regex and the room around
 * it re-renders several times a second: the voice meter samples every 120ms and
 * `speaking` changes at every pause in conversation. Measured before the memo,
 * a fifty-message chat re-parsed all fifty messages on each of those — for the
 * length of the call, to produce identical output. The prop is a string, so
 * there is nothing for the comparison to get wrong.
 */
export const ChatText = memo(function ChatText({ text }: { text: string }) {
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
});
