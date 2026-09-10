"use client";

import { useEffect, useRef, useState } from "react";

// The export control for a meeting report: five file formats, an opt-in for
// the verbatim transcript, and a send to the meeting's attendees.
//
// Downloads are plain anchors rather than fetch-and-blob. The route already
// sets Content-Disposition, so the browser does the saving — which means the
// download survives a slow render, shows in the download shelf, and needs no
// object URL to leak. Only the email is a fetch, because only it is a POST.

const FORMATS = [
  { format: "pdf", label: "PDF" },
  { format: "docx", label: "Word" },
  { format: "md", label: "Markdown" },
  { format: "html", label: "HTML" },
  { format: "rtf", label: "Rich text" },
] as const;

type EmailState =
  | { status: "idle" }
  | { status: "sending" }
  | { status: "done"; message: string }
  | { status: "error"; message: string };

export function ExportMenu({ roomId }: { roomId: string }) {
  const [open, setOpen] = useState(false);
  const [withTranscript, setWithTranscript] = useState(false);
  const [email, setEmail] = useState<EmailState>({ status: "idle" });
  const wrapRef = useRef<HTMLDivElement>(null);

  // Close on an outside click or Escape — a menu that traps the page is worse
  // than no menu.
  useEffect(() => {
    if (!open) return;
    function onDown(e: MouseEvent) {
      if (!wrapRef.current?.contains(e.target as Node)) setOpen(false);
    }
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") setOpen(false);
    }
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  const href = (format: string) =>
    `/api/meetings/rooms/${encodeURIComponent(roomId)}/report/export?format=${format}` +
    (withTranscript ? "&transcript=1" : "");

  async function sendToAttendees() {
    setEmail({ status: "sending" });
    try {
      const res = await fetch(`/api/meetings/rooms/${encodeURIComponent(roomId)}/report/email`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ includeTranscript: withTranscript }),
      });
      const body = await res.json().catch(() => ({}));
      if (!res.ok) {
        setEmail({ status: "error", message: body?.error ?? "Could not send the summary." });
        return;
      }
      const { sent = 0, total = 0 } = body as { sent?: number; total?: number };
      setEmail({
        status: sent === 0 ? "error" : "done",
        message:
          sent === 0
            ? "The summary reached nobody. Check the connected mailbox and try again."
            : sent === total
              ? `Sent to ${total} ${total === 1 ? "attendee" : "attendees"}.`
              : `Sent to ${sent} of ${total} attendees.`,
      });
    } catch {
      setEmail({ status: "error", message: "Could not reach the server." });
    }
  }

  return (
    <div className="relative" ref={wrapRef}>
      <button
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        className="rounded-lg border border-[var(--line)] bg-[var(--surface-1)] px-3 py-1.5 text-xs font-medium text-[var(--fg-secondary)] hover:text-[var(--fg-primary)] hover:border-gold-400/40 transition-colors"
      >
        Export
      </button>

      {open && (
        <div
          role="menu"
          className="absolute right-0 z-20 mt-2 w-64 rounded-xl border border-[var(--line)] bg-[var(--surface-1)] p-2 shadow-lg"
        >
          <p className="px-2 pt-1 pb-2 text-[11px] font-medium uppercase tracking-wide text-[var(--fg-muted)]">
            Download
          </p>
          <div className="flex flex-col">
            {FORMATS.map(({ format, label }) => (
              <a
                key={format}
                role="menuitem"
                href={href(format)}
                onClick={() => setOpen(false)}
                className="rounded-lg px-2 py-1.5 text-sm text-[var(--fg-primary)] hover:bg-[var(--surface-2)] transition-colors"
              >
                {label}
              </a>
            ))}
          </div>

          {/* A transcript is verbatim speech, and long. Sending one should be a
              decision somebody made, not a surprise inside the file. */}
          <label className="mt-2 flex items-start gap-2 rounded-lg px-2 py-2 text-sm text-[var(--fg-secondary)] hover:bg-[var(--surface-2)] cursor-pointer transition-colors">
            <input
              type="checkbox"
              checked={withTranscript}
              onChange={(e) => setWithTranscript(e.target.checked)}
              className="mt-0.5 accent-[var(--gold-400)]"
            />
            <span>
              Include full transcript
              <span className="block text-[11px] text-[var(--fg-muted)]">
                Everything that was said, word for word.
              </span>
            </span>
          </label>

          <div className="my-2 border-t border-[var(--line)]" />

          <button
            role="menuitem"
            onClick={sendToAttendees}
            disabled={email.status === "sending"}
            className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-[var(--fg-primary)] hover:bg-[var(--surface-2)] disabled:opacity-60 transition-colors"
          >
            {email.status === "sending" ? "Sending…" : "Email to attendees"}
          </button>

          {(email.status === "done" || email.status === "error") && (
            <p
              className={`px-2 pb-1 pt-1.5 text-[11px] ${
                email.status === "done" ? "text-[var(--status-success)]" : "text-[var(--status-danger)]"
              }`}
            >
              {email.message}
            </p>
          )}
        </div>
      )}
    </div>
  );
}
