"use client";

import { useEffect, useState } from "react";

const SHORTCUTS = [
  { keys: ["⌘", "K"], label: "Open Earn command bar" },
  { keys: ["⌘", "B"], label: "Toggle sidebar" },
  { keys: ["⌘", "/"], label: "New session" },
  { keys: ["⌘", "Enter"], label: "Send / confirm" },
  { keys: ["Esc"], label: "Close panel / dismiss" },
  { keys: ["⌘", "Shift", "S"], label: "Source Hub" },
  { keys: ["⌘", "Shift", "R"], label: "Run Hub" },
  { keys: ["⌘", "Shift", "E"], label: "Execute / Portfolio" },
  { keys: ["?"], label: "Toggle this shortcut guide" },
];

export function KeyboardShortcuts() {
  const [open, setOpen] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      const tag = (e.target as HTMLElement)?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || (e.target as HTMLElement)?.isContentEditable) return;
      if (e.key === "?") {
        e.preventDefault();
        setOpen((v) => !v);
      }
      if (e.key === "Escape") setOpen(false);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      {/* Floating ? pill — bottom-left so it doesn't clash with the setup guide */}
      <button
        onClick={() => setOpen((v) => !v)}
        aria-label="Keyboard shortcuts"
        title="Keyboard shortcuts (?)"
        className="fixed bottom-6 left-4 z-40 flex items-center gap-1.5 rounded-full border border-line bg-surface-1 px-3 py-1.5 font-mono text-[10px] uppercase tracking-wider text-fg-muted shadow-md transition hover:border-gold-500/40 hover:text-gold-300"
      >
        <span>?</span>
        <span className="hidden sm:inline">Shortcuts</span>
      </button>

      {open ? (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-50 bg-surface-0/60 backdrop-blur-sm"
            onClick={() => setOpen(false)}
          />
          {/* Card */}
          <div className="fixed bottom-16 left-4 z-50 w-72 rounded-xl border border-line bg-surface-1 shadow-2xl">
            <div className="flex items-center justify-between border-b border-line px-4 py-2.5">
              <span className="font-mono text-[10px] uppercase tracking-widest text-gold-400">
                Keyboard shortcuts
              </span>
              <button
                onClick={() => setOpen(false)}
                className="text-fg-muted transition hover:text-fg-primary"
                aria-label="Close"
              >
                ✕
              </button>
            </div>
            <ul className="p-3 space-y-1">
              {SHORTCUTS.map((s) => (
                <li key={s.label} className="flex items-center justify-between gap-3 rounded-lg px-2 py-1.5 transition hover:bg-surface-2">
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
        </>
      ) : null}
    </>
  );
}
