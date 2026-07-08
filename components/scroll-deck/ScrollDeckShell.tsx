"use client";

// Orchestrator for the Scroll-Deck builder. Holds all UI-only state: the chat
// transcript, the assembled deck, the Auto-Accept mode, and the drag-resizable
// split between the chat panel and the canvas. No network, no persistence —
// the "build" is the scripted sequence in mock-data.ts.
import { useCallback, useRef, useState } from "react";
import { NavRail } from "./NavRail";
import { BuilderChatPanel, type ChatMessage } from "./BuilderChatPanel";
import {
  BuilderCanvas,
  type AppliedSection,
  type PendingSection,
} from "./BuilderCanvas";
import { BUILD_STEPS } from "./mock-data";

const MIN_PCT = 24;
const MAX_PCT = 55;

export function ScrollDeckShell() {
  const [activeNav, setActiveNav] = useState("scroll-deck");
  const [splitPct, setSplitPct] = useState(34);

  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState("");
  const [autoAccept, setAutoAccept] = useState(true);
  const [busy, setBusy] = useState(false);

  const [applied, setApplied] = useState<AppliedSection[]>([]);
  const [pending, setPending] = useState<PendingSection | null>(null);

  // Which scripted step comes next. Sending anything advances this pointer so
  // the demo always makes forward progress regardless of what's typed.
  const stepRef = useRef(0);
  const msgId = useRef(0);
  const nextId = () => ++msgId.current;
  // Monotonic id for canvas section instances — kept distinct from message ids
  // so React keys stay unique even when the same section is placed twice.
  const sectionKey = useRef(0);
  const nextSectionKey = () => ++sectionKey.current;

  const nextStep = stepRef.current < BUILD_STEPS.length ? BUILD_STEPS[stepRef.current] : null;

  const runStep = useCallback(
    (userText: string) => {
      const step = stepRef.current < BUILD_STEPS.length ? BUILD_STEPS[stepRef.current] : null;
      if (!step) {
        // Deck complete — acknowledge without changing the canvas.
        setMessages((m) => [
          ...m,
          { id: nextId(), role: "user", text: userText },
          {
            id: nextId(),
            role: "assistant",
            text: "Your deck already has all six sections. You can export it, or head to Legal and the Data Room to keep going.",
          },
        ]);
        setInput("");
        return;
      }

      stepRef.current += 1;
      setBusy(true);
      setInput("");

      const assistantId = nextId();
      setMessages((m) => [
        ...m,
        { id: nextId(), role: "user", text: userText },
        { id: assistantId, role: "assistant", text: "", streaming: true },
      ]);

      // "Stream" the reply a few words at a time — purely cosmetic.
      const words = step.reply.split(" ");
      let i = 0;
      const tick = () => {
        i += 1;
        setMessages((m) =>
          m.map((msg) =>
            msg.id === assistantId
              ? { ...msg, text: words.slice(0, i).join(" ") }
              : msg,
          ),
        );
        if (i < words.length) {
          window.setTimeout(tick, 45);
        } else {
          setMessages((m) =>
            m.map((msg) =>
              msg.id === assistantId ? { ...msg, streaming: false } : msg,
            ),
          );
          // Apply or propose the section, honoring the Auto-Accept mode. The
          // instance key is computed here (not inside the setState updater) so
          // the updater stays pure under React Strict Mode's double-invoke.
          const instance = { key: nextSectionKey(), section: step.section };
          if (autoAccept) {
            setApplied((a) => [...a, instance]);
          } else {
            setPending(instance);
          }
          setBusy(false);
        }
      };
      window.setTimeout(tick, 250);
    },
    [autoAccept],
  );

  const acceptPending = useCallback(() => {
    if (!pending) return;
    // Two independent, pure updaters — never nest one setState inside another.
    setApplied((a) => [...a, pending]);
    setPending(null);
  }, [pending]);

  const rejectPending = useCallback(() => {
    // Rolling back a rejected edit re-arms that scripted step.
    setPending(null);
    stepRef.current = Math.max(0, stepRef.current - 1);
  }, []);

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
            messages={messages}
            input={input}
            onInputChange={setInput}
            onSend={runStep}
            autoAccept={autoAccept}
            onToggleAutoAccept={() => setAutoAccept((v) => !v)}
            nextPrompt={nextStep ? nextStep.prompt : null}
            busy={busy}
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
            applied={applied}
            pending={pending}
            onAccept={acceptPending}
            onReject={rejectPending}
          />
        </div>
      </div>
    </div>
  );
}
