"use client";

import { useTransition } from "react";
import { generateAiDocument } from "./builder-actions";

export function GenerateAiButton({
  sectionKey,
  docName,
  label,
}: {
  sectionKey: string;
  docName?: string;
  /** What this button drafts, for its accessible name. Supply it wherever more
   * than one of these sits together: the visible label is always "✦ AI Draft",
   * so without it a screen reader hears the same thing several times over and
   * a neighbouring text label does nothing to help. */
  label?: string;
}) {
  const [pending, startTransition] = useTransition();

  return (
    <form
      action={(fd) => startTransition(async () => { await generateAiDocument(fd); })}
      className="shrink-0"
    >
      <input type="hidden" name="section" value={sectionKey} />
      {docName && <input type="hidden" name="doc_name" value={docName} />}
      <button
        type="submit"
        disabled={pending}
        aria-label={label ? `AI draft: ${label}` : undefined}
        title={
          label
            ? `Let Earn draft ${label} from your Build foundation`
            : "Let Earn draft this document from your Build foundation"
        }
        className="rounded-lg border border-sky-500/40 bg-sky-500/10 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-sky-300 transition hover:bg-sky-500/20 disabled:opacity-50"
      >
        {pending ? "Generating…" : "✦ AI Draft"}
      </button>
    </form>
  );
}
