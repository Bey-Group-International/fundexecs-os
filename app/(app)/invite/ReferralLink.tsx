"use client";

import { useEffect, useState } from "react";

// Shows the org's referral code and a copyable join link, plus the two ways
// operators actually send it: an email they can edit before sending, and a
// LinkedIn post. The absolute URL is resolved on the client so it matches
// whatever origin the operator is on.
export function ReferralLink({ code, orgName }: { code: string; orgName?: string | null }) {
  const [origin, setOrigin] = useState("");
  const [copied, setCopied] = useState<"link" | "code" | null>(null);

  useEffect(() => setOrigin(window.location.origin), []);
  const link = origin ? `${origin}/join/${code}` : `/join/${code}`;

  // Only flip to the "Copied!" label once the write actually resolves — a
  // rejected clipboard (blocked permission, insecure origin) must not claim
  // success.
  async function copy(value: string, which: "link" | "code") {
    try {
      await navigator.clipboard.writeText(value);
    } catch {
      // clipboard unavailable — leave the label unchanged
      return;
    }
    setCopied(which);
    setTimeout(() => setCopied(null), 1600);
  }

  // A draft, not a send: mailto opens the operator's own client with the
  // subject and body filled in, and they edit and address it themselves.
  const from = orgName ? `${orgName} uses` : "We use";
  const subject = encodeURIComponent("An invite to FundExecs");
  const body = encodeURIComponent(
    `Hi,\n\n${from} FundExecs to run deal sourcing, diligence, LP relations and reporting in one place. ` +
      `It's invite-only, and this link puts your request in front of their team with the invitation attached:\n\n` +
      `${link}\n\nYou'll start with credits in your wallet.\n`,
  );
  const mailto = `mailto:?subject=${subject}&body=${body}`;
  const linkedIn = `https://www.linkedin.com/sharing/share-offsite/?url=${encodeURIComponent(link)}`;

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
          onClick={() => void copy(link, "link")}
          className="shrink-0 rounded-md bg-gold-400 px-3 py-2 text-xs font-medium text-on-gold transition hover:bg-gold-300"
        >
          {copied === "link" ? "Copied!" : "Copy link"}
        </button>
      </div>

      {/* Send it, rather than leaving the operator to paste it somewhere. */}
      <div className="flex items-center gap-2">
        <a
          href={mailto}
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-line px-3 py-2 text-xs font-medium text-fg-secondary transition hover:border-gold-400/40 hover:text-fg-primary"
        >
          <span aria-hidden="true">✉</span> Email an invite
        </a>
        <a
          href={linkedIn}
          target="_blank"
          rel="noreferrer noopener"
          className="inline-flex flex-1 items-center justify-center gap-1.5 rounded-md border border-line px-3 py-2 text-xs font-medium text-fg-secondary transition hover:border-gold-400/40 hover:text-fg-primary"
        >
          <span aria-hidden="true">in</span> Share on LinkedIn
        </a>
      </div>

      <div className="flex items-center gap-2 text-xs text-fg-muted">
        <span>Or share your code</span>
        <button
          type="button"
          onClick={() => void copy(code, "code")}
          title="Copy code"
          className="rounded-md border border-line px-2 py-1 font-mono text-xs tracking-widest text-gold-300 transition hover:bg-surface-2"
        >
          {copied === "code" ? "Copied!" : code}
        </button>
      </div>
    </div>
  );
}
