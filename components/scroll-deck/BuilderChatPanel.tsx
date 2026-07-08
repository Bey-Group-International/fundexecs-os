"use client";

// The left chat panel — the "builder flow": a chat transcript, a streaming
// assistant reply, the Auto-Accept Edits control, and the What's-next
// suggestion chip. All mocked; sending a message advances the scripted build.
import { useEffect, useRef } from "react";
import {
  ArrowUpIcon,
  CircleCheckIcon,
  PaperclipIcon,
  PencilIcon,
  SparklesIcon,
  ChevronDownIcon,
} from "./icons";

export interface ChatMessage {
  id: number;
  role: "user" | "assistant";
  text: string;
  /** True while the assistant reply is still "streaming" in. */
  streaming?: boolean;
}

export function BuilderChatPanel({
  messages,
  input,
  onInputChange,
  onSend,
  autoAccept,
  onToggleAutoAccept,
  nextPrompt,
  busy,
}: {
  messages: ChatMessage[];
  input: string;
  onInputChange: (v: string) => void;
  onSend: (text: string) => void;
  autoAccept: boolean;
  onToggleAutoAccept: () => void;
  nextPrompt: string | null;
  busy: boolean;
}) {
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({
      top: scrollRef.current.scrollHeight,
      behavior: "smooth",
    });
  }, [messages]);

  const canSend = input.trim().length > 0 && !busy;

  return (
    <div className="flex h-full flex-col">
      {/* Panel header */}
      <div className="flex h-[52px] shrink-0 items-center gap-1.5 border-b border-line px-4">
        <span className="text-sm font-light text-fg-secondary">Funds</span>
        <span className="text-fg-muted">/</span>
        <button
          type="button"
          className="flex items-center gap-1 rounded-md px-1.5 py-1 text-sm text-fg-primary transition-colors hover:bg-surface-2"
        >
          {"Meridian Growth I"}
          <ChevronDownIcon className="h-2.5 w-2.5 text-fg-muted" />
        </button>
      </div>

      {/* Transcript */}
      <div ref={scrollRef} className="flex-1 overflow-y-auto px-4 py-4">
        {messages.length === 0 ? (
          <div className="mt-6 flex flex-col items-center gap-3 text-center">
            <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-surface-2 text-neural-300">
              <SparklesIcon className="h-5 w-5" />
            </span>
            <p className="max-w-xs text-sm text-fg-muted">
              Tell me about the fund you want to launch and I&apos;ll draft the
              deck as we chat.
            </p>
          </div>
        ) : (
          <div className="flex flex-col gap-4">
            {messages.map((m) => (
              <MessageBubble key={m.id} message={m} />
            ))}
          </div>
        )}
      </div>

      {/* Composer */}
      <div className="shrink-0 space-y-2 p-2 pt-0">
        {/* What's-next suggestion */}
        {nextPrompt && !busy ? (
          <button
            type="button"
            onClick={() => onSend(nextPrompt)}
            className="group flex w-full items-center gap-2 rounded-lg border border-line bg-surface-1 px-3 py-2 text-left text-xs text-fg-secondary transition-colors hover:border-neural-400/50 hover:bg-surface-2"
          >
            <SparklesIcon className="h-3.5 w-3.5 shrink-0 text-neural-300" />
            <span className="flex-1 truncate">{nextPrompt}</span>
            <span className="rounded-full border border-line px-2 py-0.5 text-[10px] text-fg-muted group-hover:text-fg-secondary">
              What&apos;s next?
            </span>
          </button>
        ) : null}

        <div className="rounded-xl border border-line bg-surface-1">
          <div className="flex flex-col gap-2 p-3">
            <textarea
              value={input}
              onChange={(e) => onInputChange(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  if (canSend) onSend(input);
                }
              }}
              rows={2}
              maxLength={5000}
              placeholder="Ask me anything about your fund…"
              className="w-full resize-none bg-transparent text-sm font-light text-fg-primary outline-none placeholder:text-fg-muted"
            />
            <div className="flex items-end gap-2">
              <button
                type="button"
                aria-label="Attach file"
                className="flex h-8 w-8 items-center justify-center rounded-full border border-line bg-surface-2 text-fg-muted transition-colors hover:text-fg-primary"
              >
                <PaperclipIcon className="h-4 w-4" />
              </button>

              {/* Auto-Accept Edits toggle — the source page's agent-mode control. */}
              <button
                type="button"
                onClick={onToggleAutoAccept}
                title="Controls whether the agent applies its edits automatically or proposes them for your review first."
                className={[
                  "flex h-8 items-center gap-1.5 rounded-full border px-3 text-xs font-light transition-colors",
                  autoAccept
                    ? "border-status-success/40 bg-status-success/10 text-status-success"
                    : "border-line bg-surface-2 text-fg-secondary hover:text-fg-primary",
                ].join(" ")}
              >
                {autoAccept ? (
                  <CircleCheckIcon className="h-4 w-4" />
                ) : (
                  <PencilIcon className="h-4 w-4" />
                )}
                <span>{autoAccept ? "Auto-Accept Edits" : "Review Edits"}</span>
              </button>

              <div className="flex-1" />

              <button
                type="button"
                aria-label="Send message"
                disabled={!canSend}
                onClick={() => canSend && onSend(input)}
                className="flex h-8 w-8 items-center justify-center rounded-full bg-neural-400 text-surface-0 transition-all hover:bg-neural-300 disabled:opacity-40"
              >
                <ArrowUpIcon className="h-4 w-4" />
              </button>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

function MessageBubble({ message }: { message: ChatMessage }) {
  if (message.role === "user") {
    return (
      <div className="flex justify-end">
        <div className="max-w-[85%] rounded-2xl rounded-br-sm bg-surface-3 px-3.5 py-2 text-sm text-fg-primary">
          {message.text}
        </div>
      </div>
    );
  }
  return (
    <div className="flex gap-2.5">
      <span className="mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-lg bg-surface-2 text-neural-300">
        <SparklesIcon className="h-3.5 w-3.5" />
      </span>
      <div className="max-w-[85%] text-sm leading-relaxed text-fg-secondary">
        {message.text}
        {message.streaming ? (
          <span className="ml-0.5 inline-block h-3.5 w-1.5 translate-y-0.5 animate-pulse bg-neural-300" />
        ) : null}
      </div>
    </div>
  );
}
