"use client";

import { useState, useTransition } from "react";
import { SignaturePad } from "@/components/signing/SignaturePad";
import { countersignRoomDocumentAction } from "@/components/build/countersign-room-actions";

/** Counter-sign one signed file on behalf of the fund. Closes the open item. */
export function CountersignForm({ signatureId, fileName }: { signatureId: string; fileName: string }) {
  const [open, setOpen] = useState(false);
  const [name, setName] = useState("");
  const [png, setPng] = useState<string | null>(null);
  const [agreed, setAgreed] = useState(false);
  const [error, setError] = useState("");
  const [pending, startTransition] = useTransition();

  if (!open) {
    return (
      <button
        type="button"
        onClick={() => setOpen(true)}
        aria-label={`Counter-sign ${fileName}`}
        className="rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20"
      >
        Counter-sign
      </button>
    );
  }

  return (
    <div className="space-y-2 rounded-lg border border-line bg-surface-0 p-3">
      <input
        value={name}
        onChange={(e) => setName(e.target.value)}
        placeholder="Your full name"
        autoComplete="name"
        aria-label="Your full name"
        className="w-full rounded-md border border-line bg-surface-1 px-2.5 py-1.5 text-xs text-fg-primary placeholder:text-fg-muted focus:border-gold-400 focus:outline-none"
      />
      <SignaturePad signerName={name} onChange={setPng} label="Fund signature" />
      <label className="flex items-start gap-2 text-[11px] text-fg-secondary">
        <input type="checkbox" checked={agreed} onChange={(e) => setAgreed(e.target.checked)} className="mt-0.5" />
        <span>I counter-sign this document on behalf of the fund.</span>
      </label>
      {error ? <p role="alert" className="text-[11px] text-red-400">{error}</p> : null}
      <div className="flex gap-2">
        <button
          type="button"
          disabled={pending || !agreed || !name.trim() || !png}
          onClick={() =>
            startTransition(async () => {
              setError("");
              const r = await countersignRoomDocumentAction(signatureId, name.trim(), png!, agreed);
              if (!r.ok) setError(r.error);
            })
          }
          className="rounded-md border border-gold-500/40 bg-gold-500/10 px-2.5 py-1 font-mono text-[11px] uppercase tracking-wider text-gold-300 transition hover:bg-gold-500/20 disabled:opacity-40"
        >
          {pending ? "Signing…" : "Counter-sign"}
        </button>
        <button
          type="button"
          disabled={pending}
          onClick={() => setOpen(false)}
          className="px-2 font-mono text-[11px] uppercase tracking-wider text-fg-muted hover:text-fg-primary"
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
