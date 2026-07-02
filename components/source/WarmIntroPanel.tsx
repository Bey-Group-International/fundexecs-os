"use client";

import { useState, useTransition } from "react";
import type { NetworkSearchResult } from "@/lib/network-search";

interface Props {
  contact: NetworkSearchResult;
  senderName: string;
  senderTitle?: string | null;
  onClose: () => void;
}

interface DraftedMessage {
  subject: string;
  body: string;
  linkedinNote?: string;
}

type MessageType = "direct" | "intro_request";

export function WarmIntroPanel({ contact, senderName, senderTitle, onClose }: Props) {
  const [messageType, setMessageType] = useState<MessageType>(
    contact.introPath && contact.introPath.length > 2 ? "intro_request" : "direct",
  );
  const [context, setContext] = useState("");
  const [draft, setDraft] = useState<DraftedMessage | null>(null);
  const [copied, setCopied] = useState<"body" | "linkedin" | null>(null);
  const [isPending, startTransition] = useTransition();

  const introducer = contact.introPath?.[1];

  async function generateDraft() {
    if (!context.trim()) return;
    startTransition(async () => {
      const res = await fetch("/api/network/draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          targetName: contact.fullName,
          targetTitle: contact.title,
          targetCompany: contact.company,
          context,
          senderName,
          senderTitle: senderTitle ?? null,
          messageType,
          introducerName: messageType === "intro_request" ? introducer : undefined,
        }),
      });
      if (res.ok) setDraft(await res.json());
    });
  }

  function copyText(text: string, type: "body" | "linkedin") {
    navigator.clipboard.writeText(text);
    setCopied(type);
    setTimeout(() => setCopied(null), 2000);
  }

  return (
    <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/60 backdrop-blur-sm p-4">
      <div className="w-full max-w-2xl rounded-2xl border border-line bg-bg shadow-2xl max-h-[90vh] flex flex-col">
        {/* Header */}
        <div className="flex items-start justify-between border-b border-line px-6 py-4 shrink-0">
          <div>
            <h2 className="font-semibold text-fg">
              {messageType === "direct" ? "Reach Out" : "Request Introduction"}
            </h2>
            <p className="text-xs text-fg-muted mt-0.5">
              to <span className="text-fg">{contact.fullName}</span>
              {contact.company ? ` · ${contact.company}` : ""}
            </p>
          </div>
          <button onClick={onClose} className="rounded-lg p-1.5 hover:bg-surface text-fg-muted hover:text-fg transition-colors">
            <svg className="h-4 w-4" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
              <path d="M18 6 6 18M6 6l12 12" />
            </svg>
          </button>
        </div>

        <div className="overflow-y-auto p-6 flex flex-col gap-5">
          {/* Intro path */}
          {contact.introPath && contact.introPath.length > 0 && (
            <div className="rounded-lg border border-line bg-surface p-3">
              <p className="text-xs text-fg-muted mb-2 font-mono uppercase tracking-wider">Warmest Path</p>
              <div className="flex items-center gap-1.5 flex-wrap">
                {contact.introPath.map((name, i) => (
                  <span key={i} className="flex items-center gap-1.5">
                    <span className={`text-sm font-medium ${i === 0 ? "text-accent" : i === contact.introPath!.length - 1 ? "text-fg" : "text-fg-muted"}`}>
                      {name}
                    </span>
                    {i < contact.introPath!.length - 1 && (
                      <svg className="h-3.5 w-3.5 text-fg-muted/40" fill="none" stroke="currentColor" strokeWidth={2} viewBox="0 0 24 24">
                        <path d="M5 12h14M12 5l7 7-7 7" />
                      </svg>
                    )}
                  </span>
                ))}
              </div>
            </div>
          )}

          {/* Message type toggle */}
          {contact.introPath && contact.introPath.length > 2 && (
            <div className="flex rounded-lg border border-line bg-surface p-1 gap-1">
              {(["direct", "intro_request"] as MessageType[]).map((t) => (
                <button
                  key={t}
                  onClick={() => { setMessageType(t); setDraft(null); }}
                  className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                    messageType === t
                      ? "bg-accent text-white"
                      : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {t === "direct" ? "Direct Outreach" : `Ask ${introducer ?? "Mutual"} for Intro`}
                </button>
              ))}
            </div>
          )}

          {/* Context input */}
          <div>
            <label className="text-xs text-fg-muted font-mono uppercase tracking-wider mb-1.5 block">
              What&apos;s the goal? (used to personalize the message)
            </label>
            <textarea
              value={context}
              onChange={(e) => { setContext(e.target.value); setDraft(null); }}
              placeholder={
                messageType === "direct"
                  ? "e.g. Exploring LP interest in our next fund focused on industrial real estate"
                  : `e.g. Seeking an intro to ${contact.fullName} to discuss co-investment opportunities`
              }
              rows={3}
              className="w-full rounded-lg border border-line bg-surface px-3 py-2.5 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-accent resize-none"
            />
          </div>

          <button
            onClick={generateDraft}
            disabled={isPending || !context.trim()}
            className="rounded-lg bg-accent py-2.5 text-sm font-medium text-white hover:bg-accent/90 disabled:opacity-40 transition-colors"
          >
            {isPending ? "Drafting…" : "Generate AI Draft"}
          </button>

          {/* Draft output */}
          {draft && (
            <div className="flex flex-col gap-4">
              <div className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <p className="text-xs font-mono uppercase tracking-wider text-fg-muted">Email Draft</p>
                  <button
                    onClick={() => copyText(`Subject: ${draft.subject}\n\n${draft.body}`, "body")}
                    className="text-xs text-accent hover:text-accent/80 transition-colors"
                  >
                    {copied === "body" ? "Copied!" : "Copy"}
                  </button>
                </div>
                <p className="text-xs text-fg-muted">
                  <span className="font-medium text-fg">Subject:</span> {draft.subject}
                </p>
                <p className="text-sm text-fg whitespace-pre-wrap leading-relaxed">{draft.body}</p>
              </div>

              {draft.linkedinNote && (
                <div className="rounded-xl border border-line bg-surface p-4 flex flex-col gap-2">
                  <div className="flex items-center justify-between">
                    <p className="text-xs font-mono uppercase tracking-wider text-fg-muted">LinkedIn Note</p>
                    <button
                      onClick={() => copyText(draft.linkedinNote!, "linkedin")}
                      className="text-xs text-accent hover:text-accent/80 transition-colors"
                    >
                      {copied === "linkedin" ? "Copied!" : "Copy"}
                    </button>
                  </div>
                  <p className="text-sm text-fg">{draft.linkedinNote}</p>
                  <p className="text-xs text-fg-muted">{draft.linkedinNote.length}/300 characters</p>
                </div>
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
