// The three steps of a signature, with the current one marked. Shown on the maker's
// page, the reader's page and the data-room template page, so everyone sees the same path.
import { WIZARD_STEPS, type WizardStep } from "@/lib/signing/wizard";

/** `viewer` decides what "You" means: the maker (default) or the reader, who sees the maker as "Sender". */
export function SigningProgress({ current, readerName, note, viewer = "maker" }: { current: WizardStep; readerName?: string; note?: string; viewer?: "maker" | "reader" }) {
  return (
    <nav aria-label="Signing steps" className="mb-5">
      <ol className="flex items-stretch gap-2">
        {WIZARD_STEPS.map((s) => {
          const done = current > s.n;
          const active = current === s.n;
          return (
            <li
              key={s.n}
              aria-current={active ? "step" : undefined}
              className={`flex min-w-0 flex-1 items-center gap-2 rounded-xl border px-3 py-2 text-sm ${
                active ? "border-gold-500/60 bg-gold-500/10 text-fg-primary" : done ? "border-emerald-500/30 bg-emerald-500/5 text-fg-secondary" : "border-line text-fg-muted"
              }`}
            >
              <span
                className={`flex h-6 w-6 shrink-0 items-center justify-center rounded-full border font-mono text-[11px] ${
                  done ? "border-emerald-500/50 text-emerald-400" : active ? "border-gold-500 text-gold-300" : "border-line"
                }`}
              >
                {done ? "✓" : s.n}
              </span>
              <span className="min-w-0">
                <span className="block truncate font-medium">{s.label}</span>
                <span className="block truncate text-[11px] text-fg-muted">{viewer === "reader" ? (s.n === 2 ? "You" : "Sender") : s.n === 2 && readerName ? readerName : s.who}</span>
              </span>
            </li>
          );
        })}
      </ol>
      {note ? <p className="mt-2 text-xs text-fg-muted">{note}</p> : null}
    </nav>
  );
}
