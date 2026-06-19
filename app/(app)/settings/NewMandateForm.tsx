"use client";

import { useRef, useState, useTransition } from "react";
import type { ActionKind } from "@/lib/gates";
import { createMandate } from "./actions";

// The create-mandate form. Lives client-side so we can surface validation inline
// and reset on success without a full reload. Only Tier-2 actions are offered as
// checkboxes — Tier 1 is already free and Tier 3 is never delegable.
export function NewMandateForm({
  tier2Actions,
}: {
  tier2Actions: { kind: ActionKind; label: string }[];
}) {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          const res = await createMandate(formData);
          if (res?.error) setError(res.error);
          else formRef.current?.reset();
        })
      }
      className="rounded-xl border border-line bg-surface-1 p-4"
    >
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-gold-400">
        New mandate
      </p>

      <div className="flex flex-col gap-3">
        <input
          name="name"
          placeholder="Name — e.g. Fund III outreach mandate"
          className="rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
        />
        <textarea
          name="goal"
          rows={2}
          placeholder="Goal in plain English — e.g. 'Run LP outreach for the Fund III raise without me in the loop.'"
          className="resize-none rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
        />

        <fieldset className="flex flex-col gap-2">
          <legend className="mb-1 font-mono text-[10px] uppercase tracking-wider text-fg-muted">
            Pre-authorize (Tier 2 — runs unattended)
          </legend>
          {tier2Actions.map((a) => (
            <label key={a.kind} className="flex items-center gap-2 text-xs text-fg-secondary">
              <input
                type="checkbox"
                name="auto_approve"
                value={a.kind}
                className="h-3.5 w-3.5 accent-gold-500"
              />
              {a.label}
            </label>
          ))}
        </fieldset>

        <button
          type="submit"
          disabled={pending}
          className="ml-auto rounded-md bg-gold-500 px-4 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-400 disabled:opacity-60"
        >
          {pending ? "Saving…" : "Activate mandate"}
        </button>

        {error ? <p className="text-xs text-status-danger">{error}</p> : null}
        <p className="text-[11px] leading-snug text-fg-muted">
          Checked actions run on their own under this mandate. Everything else still waits for
          your approval in Earn. Tier 3 — capital- or compliance-binding — is never delegable.
        </p>
      </div>
    </form>
  );
}
