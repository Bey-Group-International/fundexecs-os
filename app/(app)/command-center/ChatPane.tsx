"use client";

// Left pane of the split view: the Cursor-style Earn composer. Shows the
// running conversation, the recommendation block with approve/automate
// affordances, and the flow launcher. Mirrors the right-hand world in real time
// (chat scrolls as Earn delegates and executives execute).

import { useEffect, useRef, useState } from "react";
import { EarnOrb } from "@/components/copilot/EarnOrb";
import type { ChatMessage, WorldStatus } from "@/lib/command-center/types";
import type { FlowDescriptor } from "@/lib/command-center/flows";

export interface ChatPaneProps {
  chat: ChatMessage[];
  status: WorldStatus;
  flows: FlowDescriptor[];
  onLaunch: (flow: FlowDescriptor) => void;
  onApprove: () => void;
  onReset: () => void;
  onPrompt: (text: string) => void;
}

export function ChatPane({
  chat,
  status,
  flows,
  onLaunch,
  onApprove,
  onReset,
  onPrompt,
}: ChatPaneProps) {
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const el = scrollRef.current;
    if (el) el.scrollTop = el.scrollHeight;
  }, [chat.length, status.phase]);

  return (
    <div className="flex h-full flex-col border-r border-line bg-surface-0">
      {/* Header */}
      <div className="flex items-center gap-2.5 border-b border-line px-4 py-3">
        <EarnOrb size={26} pulse={status.running} />
        <div className="min-w-0">
          <p className="font-display text-sm font-semibold leading-none text-fg-primary">Earn</p>
          <p className="truncate font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            COO · {status.phase}
          </p>
        </div>
        <button
          onClick={onReset}
          className="ml-auto rounded-md border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted transition hover:border-gold-500/45 hover:text-fg-secondary"
        >
          Reset
        </button>
      </div>

      {/* Conversation */}
      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {chat.length === 0 && (
          <div className="space-y-3">
            <p className="text-sm leading-relaxed text-fg-secondary">
              This is the Command Center. Pick a flow and watch Earn orchestrate the executive team
              across the floor — or type a directive.
            </p>
            <div className="space-y-2">
              {flows.map((f) => (
                <button
                  key={f.kind}
                  onClick={() => onLaunch(f)}
                  className="fx-card fx-card-hover block w-full p-3 text-left"
                >
                  <p className="font-display text-sm font-semibold text-fg-primary">{f.title}</p>
                  <p className="mt-0.5 text-xs text-fg-muted">{f.blurb}</p>
                </button>
              ))}
            </div>
          </div>
        )}

        {chat.map((m) => (
          <Bubble key={m.id} m={m} onApprove={onApprove} />
        ))}
      </div>

      {/* Composer */}
      <form
        className="border-t border-line p-3"
        onSubmit={(e) => {
          e.preventDefault();
          const t = draft.trim();
          if (!t) return;
          onPrompt(t);
          setDraft("");
        }}
      >
        <div className="flex items-end gap-2 rounded-xl border border-line bg-surface-1 px-3 py-2 focus-within:border-gold-500/45">
          <textarea
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                const t = draft.trim();
                if (!t) return;
                onPrompt(t);
                setDraft("");
              }
            }}
            rows={1}
            placeholder="Direct Earn… e.g. 'open an outbound capital raise'"
            className="max-h-24 flex-1 resize-none bg-transparent text-sm text-fg-primary placeholder:text-fg-muted focus:outline-none"
          />
          <button
            type="submit"
            className="shrink-0 rounded-lg bg-gold-500/90 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-surface-0 transition hover:bg-gold-400"
          >
            Send
          </button>
        </div>
      </form>
    </div>
  );
}

function Bubble({ m, onApprove }: { m: ChatMessage; onApprove: () => void }) {
  const isEarn = m.role === "earn";
  return (
    <div className={`flex ${isEarn ? "justify-start" : "justify-end"}`}>
      <div
        className={`max-w-[88%] rounded-2xl px-3.5 py-2.5 text-sm leading-relaxed ${
          isEarn
            ? "border border-line bg-surface-1 text-fg-secondary"
            : "bg-gold-500/15 text-fg-primary"
        }`}
      >
        {isEarn && (
          <div className="mb-1 flex items-center gap-1.5">
            <EarnOrb size={14} />
            <span className="font-mono text-[9px] uppercase tracking-wider text-fg-muted">Earn</span>
          </div>
        )}
        <p>{m.text}</p>
        {m.detail && m.detail.length > 0 && (
          <ul className="mt-2 space-y-1 border-l border-gold-500/40 pl-3">
            {m.detail.map((d, i) => (
              <li key={i} className="text-xs text-fg-muted">
                {d}
              </li>
            ))}
          </ul>
        )}
        {m.awaitsApproval && (
          <div className="mt-2.5 flex gap-2">
            <button
              onClick={onApprove}
              className="rounded-lg bg-gold-500/90 px-3 py-1.5 font-mono text-[11px] font-semibold uppercase tracking-wider text-surface-0 transition hover:bg-gold-400"
            >
              Approve &amp; automate
            </button>
          </div>
        )}
      </div>
    </div>
  );
}
