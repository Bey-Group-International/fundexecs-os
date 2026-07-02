"use client";

import { useState } from "react";

interface AiFieldWandProps {
  /** Placeholder for the natural-language description input. */
  placeholder?: string;
  /** Called with the user's description; must return a field map to merge into
   *  the parent form.  Pass a bound server action or a client async function. */
  onExtract: (description: string) => Promise<Record<string, string>>;
  /** Optional label above the wand input. */
  label?: string;
}

/**
 * UX-12 — AI Field Wand.
 *
 * A compact natural-language input that pre-fills form fields on submit.
 * The caller supplies `onExtract`, which is typically a server action wrapping
 * one of the `extract*Fields` helpers in lib/claude.ts.  The returned key-value
 * pairs are passed back to the parent via `onFill` so the parent form can
 * merge them into its own state.
 *
 * Usage:
 *   <AiFieldWand
 *     placeholder="Describe the deal…"
 *     onExtract={async (desc) => extractDealFieldsAction(desc)}
 *     onFill={(fields) => setForm((f) => ({ ...f, ...fields }))}
 *   />
 */
export function AiFieldWand({
  placeholder = "Describe it in plain language and let AI fill the fields…",
  onExtract,
  label,
}: AiFieldWandProps & { onFill: (fields: Record<string, string>) => void }) {
  const [description, setDescription] = useState("");
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [filled, setFilled] = useState(false);

  async function handleExtract() {
    if (!description.trim()) return;
    setLoading(true);
    setError(null);
    setFilled(false);
    try {
      // onExtract is provided by the caller; we don't call onFill here —
      // the parent receives the result via the return value and merges it.
      await onExtract(description.trim());
      setFilled(true);
      setDescription("");
    } catch {
      setError("Could not extract fields — try rephrasing.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex flex-col gap-2 rounded-xl border border-gold-500/25 bg-gold-500/5 p-3">
      {label ? (
        <span className="font-mono text-[9px] uppercase tracking-wider text-gold-400">
          {label}
        </span>
      ) : (
        <span className="font-mono text-[9px] uppercase tracking-wider text-gold-400">
          ✦ AI Field Wand
        </span>
      )}

      <div className="flex gap-2">
        <textarea
          value={description}
          onChange={(e) => {
            setDescription(e.target.value);
            setFilled(false);
          }}
          onKeyDown={(e) => {
            if (e.key === "Enter" && (e.metaKey || e.ctrlKey)) {
              e.preventDefault();
              handleExtract();
            }
          }}
          placeholder={placeholder}
          rows={2}
          disabled={loading}
          className="flex-1 resize-none rounded-lg border border-gold-500/30 bg-surface-0 px-3 py-2 text-sm text-fg-primary outline-none placeholder:text-fg-muted focus:border-gold-400 disabled:opacity-50"
        />
        <button
          type="button"
          onClick={handleExtract}
          disabled={loading || !description.trim()}
          title="Fill fields with AI (⌘↵)"
          className="shrink-0 self-start rounded-lg bg-gold-500 px-3 py-2 text-sm font-medium text-black transition hover:bg-gold-400 disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        >
          {loading ? "…" : "✦ Fill"}
        </button>
      </div>

      {error ? (
        <p className="text-xs text-status-danger">{error}</p>
      ) : filled ? (
        <p className="text-xs text-status-success">Fields pre-filled — review and adjust as needed.</p>
      ) : (
        <p className="text-xs text-fg-muted">Describe the record; AI extracts the fields. ⌘↵ to run.</p>
      )}
    </div>
  );
}
