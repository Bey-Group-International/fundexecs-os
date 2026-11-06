"use client";

// "Copy all emails" on the report's participant list: every address on the
// meeting, attendees and invitees alike, ready to paste into a To: line.
import { useState } from "react";

export function CopyEmails({ emails }: { emails: readonly string[] }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");
  if (emails.length === 0) return null;
  const copy = async () => {
    try {
      // Comma-separated: what every mail client's To: field accepts pasted.
      await navigator.clipboard.writeText(emails.join(", "));
      setState("copied");
    } catch {
      setState("failed");
    }
    setTimeout(() => setState("idle"), 2000);
  };
  return (
    <button
      type="button"
      onClick={() => void copy()}
      title={emails.join(", ")}
      className="inline-flex min-h-8 items-center rounded-lg border border-[var(--line)] px-2.5 text-[11px] font-medium text-[var(--fg-secondary)] transition-colors hover:border-gold-400/40 hover:text-[var(--fg-primary)]"
    >
      <span aria-live="polite">
        {state === "copied" ? "Copied" : state === "failed" ? "Copy failed" : `Copy all emails (${emails.length})`}
      </span>
    </button>
  );
}
