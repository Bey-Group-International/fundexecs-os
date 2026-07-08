"use client";

// Orchestrator for the Scroll-Deck builder. Composes two hooks:
//   • useDeckStore   — the deck: applied sections (persisted to localStorage),
//                      the pending/review section, inline field edits.
//   • useBuilderChat — the chat: posts to /api/scroll-deck/chat, which calls
//                      Claude (or the deterministic fallback when no API key).
// The shell owns only the presentational glue: nav selection, the Auto-Accept
// vs Review mode, the What's-next suggestion, and the drag-resizable split.
import { useCallback, useMemo, useRef, useState } from "react";
import { NavRail } from "./NavRail";
import { BuilderChatPanel } from "./BuilderChatPanel";
import { BuilderCanvas } from "./BuilderCanvas";
import { useDeckStore } from "./useDeckStore";
import { useBuilderChat } from "./useBuilderChat";
import { suggestNextPrompt } from "./mock-data";
import type { DeckSection } from "./types";

const MIN_PCT = 24;
const MAX_PCT = 55;

export function ScrollDeckShell() {
  const [activeNav, setActiveNav] = useState("scroll-deck");
  const [splitPct, setSplitPct] = useState(34);
  const [autoAccept, setAutoAccept] = useState(true);

  const deck = useDeckStore();

  // Keep the newest deck + mode in refs so the chat callbacks read live values
  // without re-creating the chat controller on every applied-section change.
  const deckRef = useRef(deck);
  deckRef.current = deck;
  const autoAcceptRef = useRef(autoAccept);
  autoAcceptRef.current = autoAccept;

  const getSections = useCallback(
    () => deckRef.current.applied.map((a) => a.section),
    [],
  );

  const onSection = useCallback((section: DeckSection) => {
    // Auto-Accept applies straight to the deck; Review mode stages it as a
    // pending proposal the user can Accept/Reject on the canvas.
    if (autoAcceptRef.current) {
      deckRef.current.applyDirect(section);
    } else {
      deckRef.current.propose(section);
    }
  }, []);

  const chat = useBuilderChat({ getSections, onSection });

  const nextPrompt = useMemo(
    () => suggestNextPrompt(deck.applied.map((a) => a.section)),
    [deck.applied],
  );

  // Drag-to-resize between chat panel and canvas.
  const dragging = useRef(false);
  const shellRef = useRef<HTMLDivElement>(null);

  const onDragStart = useCallback((e: React.MouseEvent) => {
    e.preventDefault();
    dragging.current = true;
    const onMove = (ev: MouseEvent) => {
      if (!dragging.current || !shellRef.current) return;
      const rect = shellRef.current.getBoundingClientRect();
      const pct = ((ev.clientX - rect.left) / rect.width) * 100;
      setSplitPct(Math.min(MAX_PCT, Math.max(MIN_PCT, pct)));
    };
    const onUp = () => {
      dragging.current = false;
      window.removeEventListener("mousemove", onMove);
      window.removeEventListener("mouseup", onUp);
    };
    window.addEventListener("mousemove", onMove);
    window.addEventListener("mouseup", onUp);
  }, []);

  return (
    <div className="flex h-dvh overflow-hidden bg-surface-0 text-fg-primary">
      <NavRail active={activeNav} onSelect={setActiveNav} />

      <div ref={shellRef} className="relative flex min-w-0 flex-1">
        {/* Chat panel */}
        <div
          className="min-w-0 border-r border-line bg-surface-0"
          style={{ width: `${splitPct}%` }}
        >
          <BuilderChatPanel
            messages={chat.messages}
            input={chat.input}
            onInputChange={chat.setInput}
            onSend={chat.send}
            autoAccept={autoAccept}
            onToggleAutoAccept={() => setAutoAccept((v) => !v)}
            nextPrompt={nextPrompt}
            busy={chat.busy}
          />
        </div>

        {/* Resize handle */}
        <div
          role="separator"
          aria-orientation="vertical"
          aria-label="Resize panel"
          onMouseDown={onDragStart}
          className="group relative z-30 w-1 cursor-col-resize bg-transparent"
        >
          <span className="absolute inset-y-0 left-1/2 w-px -translate-x-1/2 bg-line transition-colors group-hover:bg-neural-400" />
        </div>

        {/* Canvas */}
        <div className="min-w-0 flex-1 bg-surface-0">
          <BuilderCanvas
            applied={deck.applied}
            pending={deck.pending}
            onAccept={deck.accept}
            onReject={deck.reject}
            onEditField={deck.editField}
          />
        </div>
      </div>
    </div>
  );
}
