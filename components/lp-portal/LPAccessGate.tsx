"use client";

// components/lp-portal/LPAccessGate.tsx
// The first thing an LP sees on their link: prove it is them by entering the
// code sent to their email. Until they do, nothing about their onboarding is shown.
import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { requestAccessCodeAction, verifyAccessCodeAction } from "@/app/lp/[token]/wizard-actions";

const input =
  "w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none";
const primary =
  "rounded-lg border border-gold-500/40 bg-gold-500/10 px-4 py-2 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-50";

export function LPAccessGate({ token, maskedEmail }: { token: string; maskedEmail: string }) {
  const router = useRouter();
  const [sent, setSent] = useState<null | { ok: boolean; masked: string }>(null);
  const [code, setCode] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();

  const request = () =>
    startTransition(async () => {
      setError(null);
      const res = await requestAccessCodeAction(token).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
      if (!res.ok) return setError(res.error);
      setSent({ ok: res.sent, masked: res.maskedEmail });
    });

  const verify = () =>
    startTransition(async () => {
      setError(null);
      const res = await verifyAccessCodeAction(token, code).catch(() => ({ ok: false as const, error: "Something went wrong. Try again." }));
      if (!res.ok) return setError(res.error);
      router.refresh();
    });

  return (
    <section className="rounded-xl border border-line bg-surface-1 p-6">
      <h2 className="font-display text-lg font-semibold text-fg-primary">Confirm it&apos;s you</h2>
      <p className="mt-1 text-sm text-fg-secondary">
        We&apos;ll send a 6-digit code to <span className="text-fg-primary">{maskedEmail}</span>. Enter it here to begin.
      </p>

      {!sent ? (
        <div className="mt-4">
          <button type="button" disabled={pending} onClick={request} className={primary}>
            {pending ? "Sending…" : "Email me a code"}
          </button>
        </div>
      ) : (
        <div className="mt-4 grid gap-3">
          {sent.ok ? (
            <p role="status" className="text-sm text-emerald-300">
              Code sent to {sent.masked}. It works for 15 minutes.
            </p>
          ) : (
            <p role="status" className="text-sm text-amber-400">
              We couldn&apos;t send the email. Ask your fund manager to give you a code directly, then enter it below.
            </p>
          )}
          <label className="block">
            <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">6-digit code</span>
            <input
              inputMode="numeric"
              autoComplete="one-time-code"
              maxLength={9}
              value={code}
              onChange={(e) => setCode(e.target.value)}
              placeholder="123456"
              aria-label="6-digit code"
              className={`${input} mt-1 max-w-[12rem] tracking-[0.3em]`}
            />
          </label>
          <div className="flex flex-wrap items-center gap-3">
            <button type="button" disabled={pending || code.replace(/\D/g, "").length !== 6} onClick={verify} className={primary}>
              {pending ? "Checking…" : "Continue"}
            </button>
            <button type="button" disabled={pending} onClick={request} className="text-xs text-fg-muted hover:text-fg-secondary">
              Send a new code
            </button>
          </div>
        </div>
      )}

      {error ? (
        <p role="alert" className="mt-3 text-sm text-amber-400">
          {error}
        </p>
      ) : null}
    </section>
  );
}
