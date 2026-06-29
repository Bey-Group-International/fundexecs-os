"use client";

import { ThemeToggle } from "@/components/ThemeToggle";

const SHORTCUTS = [
  { keys: ["⌘", "K"], label: "Open Earn command bar" },
  { keys: ["⌘", "B"], label: "Toggle sidebar" },
  { keys: ["⌘", "/"], label: "New session" },
  { keys: ["⌘", "Enter"], label: "Send / confirm" },
  { keys: ["Esc"], label: "Close panel / dismiss" },
  { keys: ["⌘", "Shift", "S"], label: "Source Hub" },
  { keys: ["⌘", "Shift", "R"], label: "Run Hub" },
  { keys: ["⌘", "Shift", "E"], label: "Execute / Portfolio" },
  { keys: ["?"], label: "Toggle floating shortcut guide" },
];

export function ShortcutsAndCustomization() {
  return (
    <div className="flex flex-col gap-4">
      {/* Theme */}
      <div className="fx-card p-4">
        <div className="flex items-center justify-between gap-4">
          <div className="min-w-0">
            <p className="text-sm font-medium text-fg-primary">Appearance</p>
            <p className="mt-0.5 text-xs text-fg-muted">
              Switch between day and night mode. Saved locally to this device.
            </p>
          </div>
          <ThemeToggle />
        </div>
      </div>

      {/* Keyboard shortcuts */}
      <div className="fx-card p-4">
        <p className="mb-3 text-sm font-medium text-fg-primary">Keyboard shortcuts</p>
        <ul className="space-y-1">
          {SHORTCUTS.map((s) => (
            <li
              key={s.label}
              className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition hover:bg-surface-2"
            >
              <span className="text-xs text-fg-secondary">{s.label}</span>
              <span className="flex shrink-0 items-center gap-1">
                {s.keys.map((k) => (
                  <kbd
                    key={k}
                    className="rounded border border-line bg-surface-2 px-1.5 py-0.5 font-mono text-[10px] text-fg-muted"
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
