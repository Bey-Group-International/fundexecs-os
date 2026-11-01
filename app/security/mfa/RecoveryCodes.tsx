"use client";

import { useState, useTransition } from "react";
import { createRecoveryCodes } from "./actions";

/** Shows a fresh set of recovery codes once. `onDone` runs when the person confirms they saved them. */
export function RecoveryCodes({ initial, onDone, label = "Get recovery codes" }: { initial?: string[]; onDone?: () => void; label?: string }) {
  const [codes, setCodes] = useState<string[] | null>(initial ?? null);
  const [error, setError] = useState<string | null>(null);
  const [busy, start] = useTransition();

  function make() {
    setError(null);
    start(async () => {
      const res = await createRecoveryCodes();
      if (res.ok) setCodes(res.codes);
      else setError(res.error);
    });
  }

  if (!codes) {
    return (
      <div>
        <button type="button" onClick={make} disabled={busy} className="w-full rounded-md border border-line py-2 text-sm text-fg-primary disabled:opacity-60">
          {busy ? "Working…" : label}
        </button>
        {error && <p className="mt-2 text-sm text-red-400">{error}</p>}
      </div>
    );
  }
  return (
    <div className="space-y-3">
      <p className="text-sm text-fg-secondary">
        Save these ten codes somewhere safe (a password manager). Each works once if you lose your
        authenticator app. They will not be shown again.
      </p>
      <ul className="grid grid-cols-2 gap-1 rounded-md border border-line bg-surface-2 p-3 font-mono text-sm text-fg-primary">
        {codes.map((c) => (
          <li key={c} className="select-all">{c}</li>
        ))}
      </ul>
      <button type="button" onClick={() => navigator.clipboard?.writeText(codes.join("\n"))} className="text-xs text-gold-300 hover:underline">
        Copy all
      </button>
      {onDone && (
        <button type="button" onClick={onDone} className="w-full rounded-md bg-gold-400 py-2.5 text-sm font-semibold text-surface-0">
          I&apos;ve saved them
        </button>
      )}
    </div>
  );
}
