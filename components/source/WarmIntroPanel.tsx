"use client";

import { useState, useTransition, useEffect, useCallback } from "react";
import type { NetworkSearchResult } from "@/lib/network-search";
import type { OutreachTone } from "@/lib/network-outreach";

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

interface OutreachProfile {
  introBlurb: string | null;
  fundName: string | null;
  fundStrategy: string | null;
  aumRange: string | null;
}

type MessageType = "direct" | "intro_request";

const TONE_LABELS: Record<OutreachTone, string> = {
  warm: "Warm",
  formal: "Formal",
  brief: "Brief",
};

export function WarmIntroPanel({ contact, senderName, senderTitle, onClose }: Props) {
  const [messageType, setMessageType] = useState<MessageType>(
    contact.introPath && contact.introPath.length > 2 ? "intro_request" : "direct",
  );
  const [tone, setTone] = useState<OutreachTone>("warm");
  const [context, setContext] = useState("");
  const [draft, setDraft] = useState<DraftedMessage | null>(null);
  const [copied, setCopied] = useState<"body" | "linkedin" | null>(null);
  const [isPending, startTransition] = useTransition();

  const [profile, setProfile] = useState<OutreachProfile | null>(null);
  const [blurb, setBlurb] = useState("");
  const [blurbEditing, setBlurbEditing] = useState(false);
  const [blurbSaving, setBlurbSaving] = useState(false);
  const [blurbGenerating, setBlurbGenerating] = useState(false);

  const introducer = contact.introPath?.[1];

  const loadProfile = useCallback(async () => {
    const res = await fetch("/api/network/profile");
    if (!res.ok) return;
    const p: OutreachProfile & { introBlurb: string | null } = await res.json();
    setProfile(p);
    setBlurb(p.introBlurb ?? "");
  }, []);

  useEffect(() => { loadProfile(); }, [loadProfile]);

  async function generateBlurb() {
    setBlurbGenerating(true);
    const res = await fetch("/api/network/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "generate" }),
    });
    if (res.ok) {
      const { blurb: generated } = await res.json();
      setBlurb(generated);
      setBlurbEditing(true);
    }
    setBlurbGenerating(false);
  }

  async function saveBlurb() {
    if (!blurb.trim()) return;
    setBlurbSaving(true);
    await fetch("/api/network/profile", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ action: "save", blurb }),
    });
    setBlurbSaving(false);
    setBlurbEditing(false);
    setProfile((p) => p ? { ...p, introBlurb: blurb } : p);
  }

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
          tone,
          introBlurb: blurb || null,
          fundName: profile?.fundName ?? null,
          fundStrategy: profile?.fundStrategy ?? null,
          aumRange: profile?.aumRange ?? null,
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
                    messageType === t ? "bg-accent text-white" : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {t === "direct" ? "Direct Outreach" : `Ask ${introducer ?? "Mutual"} for Intro`}
                </button>
              ))}
            </div>
          )}

          {/* Intro blurb */}
          <div className="rounded-lg border border-line bg-surface p-4 flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <p className="text-xs font-mono uppercase tracking-wider text-fg-muted">Your Intro Blurb</p>
              <div className="flex items-center gap-2">
                <button
                  onClick={generateBlurb}
                  disabled={blurbGenerating}
                  className="text-xs text-accent hover:text-accent/80 disabled:opacity-50 transition-colors flex items-center gap-1"
                >
                  {blurbGenerating ? (
                    <>
                      <svg className="h-3 w-3 animate-spin" fill="none" viewBox="0 0 24 24" stroke="currentColor" strokeWidth={2}>
                        <path d="M12 2v4M12 18v4M4.93 4.93l2.83 2.83M16.24 16.24l2.83 2.83M2 12h4M18 12h4M4.93 19.07l2.83-2.83M16.24 7.76l2.83-2.83" />
                      </svg>
                      Generating…
                    </>
                  ) : "✦ Generate with Earn"}
                </button>
                {!blurbEditing && blurb && (
                  <button onClick={() => setBlurbEditing(true)} className="text-xs text-fg-muted hover:text-fg transition-colors">Edit</button>
                )}
              </div>
            </div>
            {blurbEditing ? (
              <div className="flex flex-col gap-2">
                <textarea
                  value={blurb}
                  onChange={(e) => setBlurb(e.target.value)}
                  rows={3}
                  className="w-full rounded-lg border border-line bg-bg px-3 py-2 text-sm text-fg placeholder:text-fg-muted focus:outline-none focus:ring-1 focus:ring-accent resize-none"
                  placeholder="2–3 sentences about you and your fund for outreach emails…"
                />
                <div className="flex gap-2 justify-end">
                  <button onClick={() => { setBlurbEditing(false); setBlurb(profile?.introBlurb ?? ""); }} className="text-xs text-fg-muted hover:text-fg transition-colors">Discard</button>
                  <button onClick={saveBlurb} disabled={blurbSaving || !blurb.trim()} className="text-xs text-accent hover:text-accent/80 disabled:opacity-50 transition-colors">
                    {blurbSaving ? "Saving…" : "Save"}
                  </button>
                </div>
              </div>
            ) : (
              <p className="text-sm text-fg-muted italic">
                {blurb || "No blurb yet — click \"Generate with Earn\" to create one, or edit to write your own."}
              </p>
            )}
          </div>

          {/* Tone selector */}
          <div>
            <label className="text-xs text-fg-muted font-mono uppercase tracking-wider mb-1.5 block">Tone</label>
            <div className="flex rounded-lg border border-line bg-surface p-1 gap-1">
              {(["warm", "formal", "brief"] as OutreachTone[]).map((t) => (
                <button
                  key={t}
                  onClick={() => { setTone(t); setDraft(null); }}
                  className={`flex-1 rounded-md py-1.5 text-xs font-medium transition-colors ${
                    tone === t ? "bg-accent text-white" : "text-fg-muted hover:text-fg"
                  }`}
                >
                  {TONE_LABELS[t]}
                </button>
              ))}
            </div>
          </div>

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
