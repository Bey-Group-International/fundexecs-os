"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { dashboardWorkspaces } from "@/lib/dashboard/config";

const BASE_COMMANDS = [
  { label: "Command Center", href: "/dashboard", hint: "Main HUD" },
  { label: "Interactive Office", href: "/dashboard/office", hint: "Closer visual look" },
  { label: "Earn Workspace", href: "/workspace", hint: "Create a workflow" },
  { label: "Automated Sessions", href: "/automations", hint: "Workflow automation" },
];

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const commands = useMemo(
    () => [
      ...BASE_COMMANDS,
      ...dashboardWorkspaces.map((workspace) => ({
        label: workspace.title,
        href: workspace.href,
        hint: workspace.eyebrow,
      })),
    ],
    [],
  );
  const filtered = commands.filter((command) =>
    `${command.label} ${command.hint}`.toLowerCase().includes(query.toLowerCase()),
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.shiftKey && event.key.toLowerCase() === "k") {
        event.preventDefault();
        setOpen((value) => !value);
      } else if (event.key === "Escape") {
        setOpen(false);
      }
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  return (
    <>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="rounded-lg border border-line px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
        aria-label="Open dashboard command palette"
      >
        Commands <kbd className="ml-1 text-fg-muted">⇧⌘K</kbd>
      </button>
      {open ? (
        <div className="fixed inset-0 z-50 bg-black/55 p-4 backdrop-blur-sm" role="presentation">
          <div
            role="dialog"
            aria-label="Dashboard command palette"
            className="mx-auto mt-24 max-w-lg overflow-hidden rounded-2xl border border-gold-500/30 bg-surface-0 shadow-[0_30px_100px_-45px_rgba(251,191,36,0.85)]"
          >
            <div className="border-b border-line p-3">
              <input
                autoFocus
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Jump to workspace or action..."
                className="w-full rounded-lg border border-line bg-surface-1 px-3 py-2 text-sm text-fg-primary outline-none focus:border-gold-400"
              />
            </div>
            <div className="max-h-80 overflow-y-auto p-2">
              {filtered.map((command) => (
                <Link
                  key={command.href}
                  href={command.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm text-fg-primary transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                >
                  <span>{command.label}</span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    {command.hint}
                  </span>
                </Link>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
