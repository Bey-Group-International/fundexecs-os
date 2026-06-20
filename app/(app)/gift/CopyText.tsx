"use client";

import { useState } from "react";

// A tiny copy-to-clipboard button used for gift codes in the "sent" list.
export function CopyText({ value, label = "Copy code" }: { value: string; label?: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      onClick={() => {
        try {
          void navigator.clipboard.writeText(value);
          setCopied(true);
          setTimeout(() => setCopied(false), 1600);
        } catch {
          // clipboard unavailable — no-op
        }
      }}
      className="shrink-0 rounded-md border border-line px-2 py-1 font-mono text-[10px] uppercase tracking-wider text-gold-300 transition hover:bg-surface-2"
    >
      {copied ? "Copied!" : label}
    </button>
  );
}
