"use client";

import { useEffect, useMemo, useRef, useState } from "react";

export interface Command {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  run: () => void;
}

// ⌘K command palette — fuzzy-filtered, keyboard-navigable list of composer
// actions (models, modes, slash commands, jump-to-workflow, …).
export function CommandPalette({
  open,
  onClose,
  commands,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);

  useEffect(() => {
    if (open) {
      setQ("");
      setActive(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    if (!s) return commands;
    return commands.filter(
      (c) => c.label.toLowerCase().includes(s) || (c.group?.toLowerCase().includes(s) ?? false),
    );
  }, [q, commands]);

  useEffect(() => setActive(0), [q]);

  if (!open) return null;

  const run = (c: Command) => {
    onClose();
    c.run();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-line/85 bg-surface-1/98 shadow-[0_30px_80px_-30px_rgb(0_0_0/0.8)] backdrop-blur-xl"
        onMouseDown={(e) => e.stopPropagation()}
      >
        <input
          ref={inputRef}
          value={q}
          onChange={(e) => setQ(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "ArrowDown") {
              e.preventDefault();
              setActive((a) => Math.min(a + 1, filtered.length - 1));
            } else if (e.key === "ArrowUp") {
              e.preventDefault();
              setActive((a) => Math.max(a - 1, 0));
            } else if (e.key === "Enter") {
              e.preventDefault();
              const c = filtered[active];
              if (c) run(c);
            } else if (e.key === "Escape") {
              e.preventDefault();
              onClose();
            }
          }}
          placeholder="Search commands…"
          className="w-full border-b border-line/70 bg-transparent px-4 py-3 text-sm text-fg-primary outline-none placeholder:text-fg-muted"
        />
        <ul className="max-h-80 overflow-y-auto p-1">
          {filtered.length ? (
            filtered.map((c, i) => (
              <li key={c.id}>
                <button
                  type="button"
                  onMouseEnter={() => setActive(i)}
                  onClick={() => run(c)}
                  className={`flex w-full items-center justify-between gap-3 rounded-lg px-3 py-2 text-left text-sm transition ${
                    i === active ? "bg-surface-2 text-fg-primary" : "text-fg-secondary"
                  }`}
                >
                  <span className="flex min-w-0 items-center gap-2">
                    {c.group ? (
                      <span className="shrink-0 rounded border border-line/70 bg-surface-0/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                        {c.group}
                      </span>
                    ) : null}
                    <span className="truncate">{c.label}</span>
                  </span>
                  {c.hint ? <span className="shrink-0 font-mono text-[10px] text-fg-muted">{c.hint}</span> : null}
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-6 text-center text-sm text-fg-muted">No commands</li>
          )}
        </ul>
        <div className="flex items-center justify-end gap-3 border-t border-line/70 px-3 py-1.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
