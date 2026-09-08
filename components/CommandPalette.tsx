"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { useFocusTrap } from "@/hooks/useFocusTrap";

export interface Command {
  id: string;
  label: string;
  group?: string;
  hint?: string;
  run: () => void;
}

// ⌘K command palette — fuzzy-filtered, keyboard-navigable list of commands
// (navigation, composer actions, models, modes, slash commands, …).
//
// `queryAction`, when provided, adds a free-text escape hatch: once the query
// is long enough to read as a question/task rather than a filter, a pinned
// first row offers to hand the raw query to the action (e.g. "Ask Earn").
export function CommandPalette({
  open,
  onClose,
  commands,
  queryAction,
}: {
  open: boolean;
  onClose: () => void;
  commands: Command[];
  queryAction?: { label: string; run: (query: string) => void };
}) {
  const [q, setQ] = useState("");
  const [active, setActive] = useState(0);
  const inputRef = useRef<HTMLInputElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    setQ("");
    setActive(0);
    // The search field, not the dialog: a command palette exists to be typed
    // into, so landing anywhere else costs a keystroke. This runs after the
    // trap's own focus call and wins, which is the intent.
    requestAnimationFrame(() => inputRef.current?.focus());
  }, [open]);

  // Focus containment now comes from the shared hook rather than a handler on
  // the panel. Two things that fixes: this only ran on keydown INSIDE the
  // panel, so once focus escaped there was nothing to pull it back; and its
  // `offsetParent` visibility check reports every element hidden wherever
  // there is no layout engine.
  useFocusTrap(dialogRef, open);

  const filtered = useMemo(() => {
    const s = q.trim().toLowerCase();
    const matches = !s
      ? commands
      : commands.filter(
          (c) =>
            c.label.toLowerCase().includes(s) ||
            (c.group?.toLowerCase().includes(s) ?? false) ||
            // Hints are searchable too — "HUD" finds "Main HUD", "e-sign"
            // finds Envelopes — matching the retired dashboard palette.
            (c.hint?.toLowerCase().includes(s) ?? false),
        );
    // Free-text handoff appears only when no command matches. This prevents
    // Enter from accidentally opening the Earn dock when the operator is clearly
    // searching for a registered navigation target.
    if (queryAction && q.trim().length > 3 && matches.length === 0) {
      const query = q.trim();
      return [
        {
          id: "__query-action",
          label: query,
          group: queryAction.label,
          hint: "↵",
          run: () => queryAction.run(query),
        },
        ...matches,
      ];
    }
    return matches;
  }, [q, commands, queryAction]);

  useEffect(() => setActive(0), [q]);

  if (!open) return null;

  const run = (c: Command) => {
    onClose();
    c.run();
  };

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-slate-900/40 p-4 pt-[12vh]"
      onMouseDown={onClose}
      role="dialog"
      aria-modal="true"
      aria-label="Command palette"
    >
      <div
        ref={dialogRef}
        tabIndex={-1}
        className="w-full max-w-lg overflow-hidden rounded-2xl border border-line/85 bg-surface-1/98 shadow-[0_30px_80px_-30px_rgb(15_23_42/0.18)] backdrop-blur-xl"
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
          className="w-full border-b border-line/70 bg-surface-0 px-4 py-3 text-sm font-medium text-fg-primary outline-none placeholder:text-fg-muted focus:bg-surface-0"
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
                      <span className="shrink-0 rounded border border-line/70 bg-surface-0/70 px-1.5 py-0.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
                        {c.group}
                      </span>
                    ) : null}
                    <span className="truncate">{c.label}</span>
                  </span>
                  {c.hint ? <span className="shrink-0 font-mono text-[11px] text-fg-muted">{c.hint}</span> : null}
                </button>
              </li>
            ))
          ) : (
            <li className="px-3 py-6 text-center text-sm text-fg-muted">No commands</li>
          )}
        </ul>
        <div className="flex items-center justify-end gap-3 border-t border-line/70 px-3 py-1.5 font-mono text-[11px] uppercase tracking-wider text-fg-muted">
          <span>↑↓ navigate</span>
          <span>↵ run</span>
          <span>esc close</span>
        </div>
      </div>
    </div>
  );
}
