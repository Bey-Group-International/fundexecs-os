"use client";

import { useEffect, useState } from "react";

// Shows the org's referral code and a copyable join link. The absolute URL is
// resolved on the client so it matches whatever origin the operator is on.
export function ReferralLink({ code }: { code: string }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);
  const link = origin ? `${origin}/join?ref=${code}` : `/join?ref=${code}`;

  function copy(value: string, which: "link" | "code") {
    try {
      void navigator.clipboard.writeText(value);
      setCopied(which);
      setTimeout(() => setCopied(null), 1600);
    } catch {
      // clipboard unavailable — no-op
    }
  }

  return (
    <div className="flex flex-col gap-3">
      <div className="flex items-center gap-2">
        <input
          readOnly
          value={link}
          onFocus={(e) => e.currentTarget.select()}
          className="min-w-0 flex-1 truncate rounded-md border border-line bg-surface-0 px-3 py-2 font-mono text-xs text-fg-secondary focus:border-gold-500/60 focus:outline-none"
        />
        <button
          type="button"
          onClick={() => copy(link, "link")}
          className="shrink-0 rounded-md bg-gold-400 px-3 py-2 text-xs font-medium text-surface-0 transition hover:bg-gold-300"
        >
          {copied === "link" ? "Copied!" : "Copy link"}
        </button>
      </div>
      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <span>Or share your code</span>
        <button
          type="button"
          onClick={() => copy(code, "code")}
          title="Copy code"
          className="rounded-md border border-line px-2 py-1 font-mono text-xs tracking-widest text-gold-300 transition hover:bg-surface-2"
        >
          {copied === "code" ? "Copied!" : code}
        </button>
      </div>
    </div>
  );
}
