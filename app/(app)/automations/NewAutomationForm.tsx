"use client";

import { useRef, useState, useTransition } from "react";
import { SCHEDULE_PRESETS } from "@/lib/cron";
import { createAutomation } from "./actions";

// The create-automation form. Lives client-side so we can surface validation
// inline and reset on success without a full reload — it should feel instant.
export function NewAutomationForm() {
  const [error, setError] = useState<string | null>(null);
  const [pending, startTransition] = useTransition();
  const formRef = useRef<HTMLFormElement>(null);

  return (
    <form
      ref={formRef}
      action={(formData) =>
        startTransition(async () => {
          setError(null);
          const res = await createAutomation(formData);
          if (res?.error) setError(res.error);
          else formRef.current?.reset();
        })
      }
      className="rounded-xl border border-line bg-surface-1 p-4"
    >
      <p className="mb-3 font-mono text-[10px] uppercase tracking-widest text-gold-400">
        New automation
      </p>

      <div className="flex flex-col gap-3">
        <input
          name="name"
          placeholder="Name — e.g. Weekly pipeline digest"
          className="rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
        />
        <textarea
          name="prompt"
          rows={3}
          placeholder="Instruction in plain English — e.g. 'Scan our deal pipeline and draft a one-page summary of what moved this week.'"
          className="resize-none rounded-md border border-line bg-surface-0 px-3 py-2 text-sm text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
        />
        <input type="hidden" name="trigger_type" value="schedule" />
        <div className="flex flex-wrap items-center gap-3">
          <label className="flex items-center gap-2 text-xs text-fg-secondary">
            <span className="font-mono uppercase tracking-wider text-fg-muted">Runs</span>
            <select
              name="schedule"
              defaultValue={SCHEDULE_PRESETS[2].value}
              className="rounded-md border border-line bg-surface-0 px-2 py-1.5 text-sm text-fg-primary focus:border-gold-500/60 focus:outline-none"
            >
              {SCHEDULE_PRESETS.map((p) => (
                <option key={p.value} value={p.value}>
                  {p.label}
                </option>
              ))}
            </select>
          </label>

          <label className="flex items-center gap-2 text-xs text-fg-secondary">
            <input
              type="checkbox"
              name="auto_approve"
              className="h-3.5 w-3.5 accent-gold-500"
            />
            Auto-approve (run unattended)
          </label>

          <button
            type="submit"
            disabled={pending}
            className="ml-auto rounded-md bg-gold-500 px-4 py-1.5 text-sm font-medium text-surface-0 transition hover:bg-gold-400 disabled:opacity-60"
          >
            {pending ? "Saving…" : "Create automation"}
          </button>
        </div>

        {error ? <p className="text-xs text-red-400">{error}</p> : null}
        <p className="text-[11px] leading-snug text-fg-muted">
          Leave <span className="text-fg-secondary">Auto-approve</span> off and each run waits for
          your approval in the Copilot — exactly like a prompt. Turn it on only for automations you
          trust to run on their own.
        </p>
      </div>
    </form>
  );
}
