"use client";

// Chat controller for the Scroll-Deck builder. Owns the message list, the input
// box, and the request lifecycle: it POSTs the manager's message to
// /api/scroll-deck/chat, then plays a cosmetic word-by-word typewriter effect on
// the assistant reply before handing any produced section to the deck store.
//
// React purity: message ids come from a useRef counter, and EVERY value used
// inside a setState updater is computed OUTSIDE it. We never increment the ref
// inside an updater and never nest one setState in another's updater — React
// Strict Mode double-invokes updaters in dev, so an impure updater would
// double-apply.
import { useCallback, useRef, useState } from "react";
import type { ChatMessage, ChatProposal, DeckSection } from "./types";

const WORD_INTERVAL_MS = 45;

export function useBuilderChat(opts: {
  getSections: () => DeckSection[];
  onSection: (section: DeckSection, reply: string) => void;
}): {
  messages: ChatMessage[];
  input: string;
  setInput: (v: string) => void;
  send: (text: string) => void;
  busy: boolean;
} {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [busy, setBusy] = useState(false);

  // Monotonic id source. Read + increment OUTSIDE any setState updater.
  const idCounter = useRef(0);
  const nextId = () => {
    idCounter.current += 1;
    return idCounter.current;
  };

  // Keep the latest callbacks in refs so `send` stays stable without going stale.
  const optsRef = useRef(opts);
  optsRef.current = opts;

  // Replace an assistant message's text (and optionally its streaming flag). The
  // updater is pure — it only maps over prior state.
  const setAssistantText = useCallback(
    (id: number, text: string, streaming: boolean) => {
      setMessages((prev) =>
        prev.map((m) => (m.id === id ? { ...m, text, streaming } : m)),
      );
    },
    [],
  );

  const send = useCallback(
    (text: string) => {
      const trimmed = text.trim();
      if (!trimmed || busy) return;

      // Compute ids up front, outside every updater.
      const userId = nextId();
      const assistantId = nextId();

      const userMsg: ChatMessage = { id: userId, role: "user", text: trimmed };
      const assistantMsg: ChatMessage = {
        id: assistantId,
        role: "assistant",
        text: "",
        streaming: true,
      };

      setBusy(true);
      setInput("");
      setMessages((prev) => [...prev, userMsg, assistantMsg]);

      const sections = optsRef.current.getSections();

      void (async () => {
        try {
          const res = await fetch("/api/scroll-deck/chat", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              prompt: trimmed,
              sections,
              stepIndex: sections.length,
            }),
          });
          if (!res.ok) throw new Error(`Request failed: ${res.status}`);
          const proposal = (await res.json()) as ChatProposal;
          const reply = typeof proposal.reply === "string" ? proposal.reply : "";

          // Cosmetic typewriter: fill the reply word-by-word.
          const words = reply.split(/(\s+)/); // keep whitespace tokens
          await new Promise<void>((resolve) => {
            let shown = "";
            let i = 0;
            const tick = () => {
              if (i >= words.length) {
                resolve();
                return;
              }
              shown += words[i];
              i += 1;
              setAssistantText(assistantId, shown, true);
              // Only whitespace tokens count as word boundaries for pacing; the
              // last content token resolves promptly.
              window.setTimeout(tick, WORD_INTERVAL_MS);
            };
            tick();
          });

          setAssistantText(assistantId, reply, false);
          if (proposal.section) {
            optsRef.current.onSection(proposal.section, reply);
          }
        } catch (err) {
          console.error("[useBuilderChat] send error:", err);
          setAssistantText(
            assistantId,
            "Sorry — I couldn't build that section just now. Please try again in a moment.",
            false,
          );
        } finally {
          setBusy(false);
        }
      })();
    },
    [busy, setAssistantText],
  );

  return { messages, input, setInput, send, busy };
}
