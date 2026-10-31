"use client";

// components/run/OnboardingLinkPanel.tsx
// For an LP who has not been decided yet: copy their unique link, email it from
// your mailbox, or generate a code to read to them if their email can't be reached.
import { useState, useTransition } from "react";
import { emailLpLinkAction, generateAccessCodeAction } from "@/app/(app)/[hub]/[module]/onboarding-link-actions";

const btn =
  "rounded-lg border border-line px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted transition hover:text-fg-secondary disabled:opacity-50";

export function OnboardingLinkPanel({ sessionId, token, expiresAt }: { sessionId: string; token: string; expiresAt: string }) {
  const [copied, setCopied] = useState(false);
  const [note, setNote] = useState<{ tone: "ok" | "error"; text: string } | null>(null);
  const [code, setCode] = useState<{ value: string; expiresAt: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const url = typeof window === "undefined" ? `/lp/${token}` : `${window.location.origin}/lp/${token}`;
  const expired = new Date(expiresAt).getTime() < Date.now();

  const copy = () => {
    navigator.clipboard?.writeText(url).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    });
  };

  const email = () =>
    startTransition(async () => {
      setNote(null);
      const res = await emailLpLinkAction(sessionId).catch(() => ({ ok: false as const, error: "Couldn't do that. Try again." }));
      if (!res.ok) return setNote({ tone: "error", text: res.error });
      setNote(
        res.sent
          ? { tone: "ok", text: "Link emailed to the LP." }
          : { tone: "error", text: "The email couldn't be sent. Connect your mailbox, or copy the link and send it yourself." },
      );
    });

  const makeCode = () =>
    startTransition(async () => {
      setNote(null);
      const res = await generateAccessCodeAction(sessionId).catch(() => ({ ok: false as const, error: "Couldn't do that. Try again." }));
      if (!res.ok) return setNote({ tone: "error", text: res.error });
      setCode({ value: res.code, expiresAt: res.expiresAt });
    });

  return (
    <div className="rounded-lg border border-line bg-surface-0 p-3">
      <p className="text-sm font-medium text-fg-primary">The LP&apos;s link</p>
      <p className="mt-1 break-all font-mono text-[11px] text-fg-muted">{url}</p>
      <p className="mt-1 text-xs text-fg-muted">
        {expired ? "This link has expired. Make a new one." : `Expires ${new Date(expiresAt).toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" })}. The LP enters a code emailed to them to open it.`}
      </p>
      <div className="mt-2 flex flex-wrap items-center gap-2">
        <button type="button" onClick={copy} className={btn}>
          {copied ? "Copied ✓" : "Copy link"}
        </button>
        <button type="button" disabled={pending || expired} onClick={email} className={btn}>
          Email the link
        </button>
        <button type="button" disabled={pending || expired} onClick={makeCode} className={btn}>
          Get a code to read out
        </button>
      </div>
      {code ? (
        <p role="status" className="mt-2 text-sm text-fg-primary">
          Give the LP this code: <span className="font-mono text-lg tracking-[0.3em] text-gold-300">{code.value}</span>{" "}
          <span className="text-xs text-fg-muted">It works for 15 minutes and isn&apos;t shown again.</span>
        </p>
      ) : null}
      {note ? (
        <p role={note.tone === "error" ? "alert" : "status"} className={`mt-2 text-xs ${note.tone === "error" ? "text-amber-400" : "text-emerald-300"}`}>
          {note.text}
        </p>
      ) : null}
    </div>
  );
}
