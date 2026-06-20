"use client";

import { useState } from "react";

// Builds the absolute portal URL client-side (from the current origin) and
// copies it. Keeps the share link out of server-rendered markup.
export default function CopyLink({ path }: { path: string }) {
  const [copied, setCopied] = useState(false);

  async function copy() {
    const url = `${window.location.origin}${path}`;
    try {
      await navigator.clipboard.writeText(url);
    } catch {
      window.prompt("Copy this link", url);
    }
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  }

  return (
    <button
      type="button"
      onClick={copy}
      className="inline-flex items-center gap-1.5 rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 font-mono text-[10px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
    >
      {copied ? "✓ Copied" : "⧉ Copy link"}
    </button>
  );
}
