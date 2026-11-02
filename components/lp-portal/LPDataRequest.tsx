"use client";

// components/lp-portal/LPDataRequest.tsx
// "Your information": an LP asks, from their own link, for a copy of what is held
// about them or for it to be erased. It only sends a request to the fund manager,
// who answers directly; nothing is deleted or sent from here.
import { useState, useTransition } from "react";
import { requestPrivacyAction } from "@/app/lp/[token]/privacy-actions";
import type { PrivacyRequestKind } from "@/lib/lp-privacy-request";

const link = "text-xs text-fg-muted underline-offset-2 hover:text-fg-secondary hover:underline";
const primary =
  "rounded-lg border border-gold-500/40 bg-gold-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50";

const EXPLAIN: Record<PrivacyRequestKind, { title: string; body: string; send: string }> = {
  access: {
    title: "Ask for a copy of my information",
    body: "We'll tell your fund manager you'd like a copy of what they hold about you. They will contact you directly.",
    send: "Send request",
  },
  erasure: {
    title: "Ask for my information to be erased",
    body: "We'll tell your fund manager you'd like your information erased. Some records have to be kept by law (for example identity and sanctions checks), so they may not be able to erase everything. They will contact you directly and tell you what they can do.",
    send: "Send erasure request",
  },
};

export function LPDataRequest({ token }: { token: string }) {
  const [open, setOpen] = useState<PrivacyRequestKind | null>(null);
  const [result, setResult] = useState<{ ok: boolean; text: string } | null>(null);
  const [pending, startTransition] = useTransition();

  const send = (kind: PrivacyRequestKind) =>
    startTransition(async () => {
      const res = await requestPrivacyAction(token, kind).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
      setResult(res.ok ? { ok: true, text: res.message } : { ok: false, text: res.error });
      if (res.ok) setOpen(null);
    });

  return (
    <section aria-label="Your information" className="mt-8 rounded-xl border border-line bg-surface-1 p-4 text-left">
      <h2 className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">Your information</h2>
      {result?.ok ? (
        <p role="status" className="mt-2 text-sm text-emerald-300">
          {result.text}
        </p>
      ) : (
        <>
          <div className="mt-2 flex flex-wrap gap-x-4 gap-y-1">
            {(Object.keys(EXPLAIN) as PrivacyRequestKind[]).map((k) => (
              <button key={k} type="button" className={link} onClick={() => (setResult(null), setOpen(open === k ? null : k))}>
                {EXPLAIN[k].title}
              </button>
            ))}
          </div>
          {open && (
            <div className="mt-3 grid gap-3">
              <p className="text-sm text-fg-secondary">{EXPLAIN[open].body}</p>
              <div className="flex items-center gap-3">
                <button type="button" disabled={pending} onClick={() => send(open)} className={primary}>
                  {pending ? "Sending…" : EXPLAIN[open].send}
                </button>
                <button type="button" disabled={pending} onClick={() => setOpen(null)} className="text-xs text-fg-muted hover:text-fg-secondary">
                  Cancel
                </button>
              </div>
            </div>
          )}
          {result && !result.ok && (
            <p role="alert" className="mt-2 text-sm text-amber-400">
              {result.text}
            </p>
          )}
        </>
      )}
    </section>
  );
}
