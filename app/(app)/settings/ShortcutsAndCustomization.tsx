"use client";

import { APP_SHORTCUTS } from "@/lib/shortcuts";

export function ShortcutsAndCustomization() {
  return (
    <div className="flex flex-col gap-4">
      {/* Appearance — one scheme, no switch. The platform ships a single
          high-contrast palette so every label reads the same on every device. */}
      <div className="fx-card p-4">
        <p className="text-sm font-medium text-fg-primary">Appearance</p>
        <p className="mt-1 text-sm text-fg-secondary">
          FundExecs OS renders in one bold, high-contrast scheme on every device — no dimmed
          mode to switch into, so wording stays legible wherever you are working.
        </p>
      </div>

      {/* Keyboard shortcuts */}
      <div className="fx-card p-4">
        <h3 className="mb-3 text-sm font-medium text-fg-primary">Keyboard shortcuts</h3>
        <ul role="list" aria-label="Keyboard shortcuts" className="space-y-1">
          {APP_SHORTCUTS.map((s) => (
            <li
              key={`${s.keys.join("+")}+${s.label}`}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition hover:bg-surface-2"
            >
              <span className="text-xs text-fg-secondary">{s.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {s.keys.map((k, i) => (
                  <kbd
                    key={i}
                    className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[11px] text-fg-muted"
                  >
                    {k}
                  </kbd>
                ))}
              </span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
