"use client";

import { useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { dashboardWorkspaces } from "@/lib/dashboard/config";
import { HUBS } from "@/lib/hubs";

// Navigation and settings destinations — every href is a real route. Hub
// module commands are NOT listed here: they are generated from lib/hubs.ts
// below, so the palette can never drift from the routes that actually exist
// (the previous hardcoded catalog shipped six destinations that 404'd).
const BASE_COMMANDS = [
  { label: "Command Center", href: "/dashboard", hint: "Main HUD", group: "nav" },
  { label: "Interactive Office", href: "/dashboard/office", hint: "Visual workspace", group: "nav" },
  { label: "Earn Workspace", href: "/workspace", hint: "Create a workflow", group: "nav" },
  { label: "Automated Sessions", href: "/automations", hint: "Workflow automation", group: "nav" },
  { label: "Inbox", href: "/inbox", hint: "Unified messages", group: "nav" },
  { label: "Search", href: "/search", hint: "Full-text search", group: "nav" },
  { label: "Capital Map", href: "/capital-map", hint: "Relationship intelligence", group: "nav" },
  { label: "Portfolio", href: "/portfolio", hint: "Portfolio health", group: "nav" },
  { label: "Deals", href: "/deals", hint: "Deal war rooms", group: "nav" },
  { label: "Settings", href: "/settings", hint: "Account & org", group: "settings" },
  { label: "Integrations", href: "/settings#integrations", hint: "Connect tools", group: "settings" },
];

// Every hub module, straight from the routing source of truth: /{hub}/{module}
// is exactly what app/(app)/[hub]/[module] serves.
const HUB_COMMANDS = HUBS.flatMap((hub) =>
  hub.modules.map((m) => ({
    label: `${hub.label}: ${m.label}`,
    href: `/${hub.key}/${m.key}`,
    hint: hub.label,
    group: hub.key as string,
  })),
);

export function CommandPalette() {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState("");
  const commands = useMemo(
    () => [
      ...BASE_COMMANDS,
      ...HUB_COMMANDS,
      ...dashboardWorkspaces.map((workspace) => ({
        label: workspace.title,
        href: workspace.href,
        hint: workspace.eyebrow,
        group: "workspace" as const,
      })),
    ],
    [],
  );

  // "Ask Earn" passthrough: anything that looks like a question/task fires the dock.
  const showAskEarn = query.trim().length > 3;

  const filtered = commands.filter((command) =>
    `${command.label} ${command.hint} ${command.group ?? ""}`.toLowerCase().includes(query.toLowerCase()),
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
              {showAskEarn ? (
                <button
                  type="button"
                  onClick={() => {
                    setOpen(false);
                    window.dispatchEvent(
                      new CustomEvent("earn:open-with-context", {
                        detail: { prompt: query },
                      }),
                    );
                  }}
                  className="flex w-full items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm text-fg-primary transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                >
                  <span className="flex items-center gap-2">
                    <span className="shrink-0 rounded border border-gold-500/40 bg-gold-500/10 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-gold-400">
                      ask earn
                    </span>
                    <span className="truncate">{query}</span>
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    ↵
                  </span>
                </button>
              ) : null}
              {filtered.map((command) => (
                <Link
                  key={command.href}
                  href={command.href}
                  onClick={() => setOpen(false)}
                  className="flex items-center justify-between gap-3 rounded-xl px-3 py-2.5 text-sm text-fg-primary transition hover:bg-surface-2 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
                >
                  <span className="flex items-center gap-2">
                    {command.group ? (
                      <span className="shrink-0 rounded border border-line/70 bg-surface-0/70 px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider text-fg-muted">
                        {command.group}
                      </span>
                    ) : null}
                    <span>{command.label}</span>
                  </span>
                  <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
                    {command.hint}
                  </span>
                </Link>
              ))}
              {!showAskEarn && filtered.length === 0 ? (
                <p className="px-3 py-6 text-center text-sm text-fg-muted">
                  No results. Type a question to ask Earn.
                </p>
              ) : null}
            </div>
          </div>
        </div>
      ) : null}
    </>
  );
}
