"use client";

import { useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { confirmTotpEnrollment, createRecoveryCodes, startTotpEnrollment } from "./actions";
import { RecoveryCodes } from "./RecoveryCodes";

type Pending = { factorId: string; qrCode: string; secret: string };

export function EnrollTotp({ next }: { next: string }) {
  const router = useRouter();
  const [pending, setPending] = useState<Pending | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [codes, setCodes] = useState<string[] | null>(null);
  const [busy, startTransition] = useTransition();

  function begin() {
    setError(null);
    startTransition(async () => {
      const res = await startTotpEnrollment();
      if (res.ok) setPending(res);
      else setError(res.error);
    });
  }

  function confirm(form: FormData) {
    if (!pending) return;
    setError(null);
    startTransition(async () => {
      const res = await confirmTotpEnrollment(pending.factorId, String(form.get("code") ?? ""));
      if (!res.ok) return setError(res.error);
      // Enrolment succeeded and the session is now aal2: issue recovery codes before moving on.
      const rc = await createRecoveryCodes();
      if (rc.ok) setCodes(rc.codes);
      else router.replace(next);
    });
  }

  if (codes) return <RecoveryCodes initial={codes} onDone={() => router.replace(next)} />;

  if (!pending) {
    return (
      <div>
        <button
          type="button"
          onClick={begin}
          disabled={busy}
          className="w-full rounded-md bg-gold-400 py-2.5 text-sm font-semibold text-surface-0 disabled:opacity-60"
        >
          {busy ? "Starting…" : "Set up authenticator app"}
        </button>
        {error && <p className="mt-3 text-sm text-red-400">{error}</p>}
      </div>
    );
  }

  return (
    <form action={confirm} className="space-y-4">
      <p className="text-sm text-fg-secondary">
        Scan this QR code with an authenticator app (1Password, Authy, Google Authenticator),
        then enter the 6-digit code it shows.
      </p>
      {/* data: URI from the auth provider; next/image adds nothing for an inline SVG */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={pending.qrCode} alt="Authenticator QR code" className="mx-auto h-44 w-44 rounded bg-white p-2" />
      <p className="text-center text-xs text-fg-muted">
        Can&apos;t scan? Enter this key manually:
        <br />
        <code className="select-all break-all font-mono text-fg-secondary">{pending.secret}</code>
      </p>
      <input
        name="code"
        inputMode="numeric"
        autoComplete="one-time-code"
        pattern="[0-9 ]*"
        maxLength={7}
        required
        autoFocus
        placeholder="123456"
        aria-label="6-digit code"
        className="w-full rounded-md border border-line bg-surface-2 px-3 py-2.5 text-center font-mono text-lg tracking-widest text-fg-primary"
      />
      <button
        type="submit"
        disabled={busy}
        className="w-full rounded-md bg-gold-400 py-2.5 text-sm font-semibold text-surface-0 disabled:opacity-60"
      >
        {busy ? "Checking…" : "Verify and turn on"}
      </button>
      {error && <p className="text-sm text-red-400">{error}</p>}
    </form>
  );
}
