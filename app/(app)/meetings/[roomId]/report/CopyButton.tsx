"use client";

import { useState } from "react";

export function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      onClick={() => {
        void navigator.clipboard.writeText(text).then(() => {
          setCopied(true);
          setTimeout(() => setCopied(false), 1500);
        });
      }}
      className="text-xs text-[var(--gold-400)] hover:text-[var(--gold-500)] transition-colors"
    >
      {copied ? "Copied!" : "Copy"}
    </button>
  );
}
