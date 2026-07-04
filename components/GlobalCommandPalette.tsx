"use client";

import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { CommandPalette, type Command } from "@/components/CommandPalette";
import { navCommands } from "@/lib/nav-commands";

// THE app-wide command palette — mounted once in app/(app)/layout.tsx, so
// every authed route shares one ⌘K with one catalog (previously the dashboard
// had its own palette on ⇧⌘K and ~60 other routes had none).
//
// Keybinding contract: ⌘K/Ctrl+K and ⇧⌘K both open it — EXCEPT on surfaces
// that own ⌘K for their own composer palette (the session Copilot), marked
// with [data-owns-cmdk]. There ⌘K stays with the composer and ⇧⌘K still
// reaches this one, so both palettes remain a keystroke away.

const OPEN_EVENT = "fx:open-command-palette";

/** Programmatic opener for buttons/menus ("Commands ⇧⌘K" in the dashboard shell). */
export function openCommandPalette(): void {
  window.dispatchEvent(new Event(OPEN_EVENT));
}

/** The shell-visible trigger button, shared wherever a visible affordance is wanted. */
export function CommandPaletteTrigger({ className }: { className?: string }) {
  return (
    <button
      type="button"
      onClick={openCommandPalette}
      className={
        className ??
        "rounded-lg border border-line px-3 py-2 font-mono text-[10px] uppercase tracking-wider text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
      }
      aria-label="Open command palette"
    >
      Commands <kbd className="ml-1 text-fg-muted">⌘K</kbd>
    </button>
  );
}

export function GlobalCommandPalette() {
  const [open, setOpen] = useState(false);
  const router = useRouter();

  const commands = useMemo<Command[]>(
    () =>
      navCommands().map((c) => ({
        id: c.href,
        label: c.label,
        group: c.group,
        hint: c.hint,
        run: () => router.push(c.href),
      })),
    [router],
  );

  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      if (!(event.metaKey || event.ctrlKey) || event.key.toLowerCase() !== "k") return;
      // A mounted composer (session Copilot) owns plain ⌘K; ⇧⌘K is always ours.
      if (!event.shiftKey && document.querySelector("[data-owns-cmdk]")) return;
      event.preventDefault();
      setOpen((value) => !value);
    }
    function onOpenEvent() {
      setOpen(true);
    }
    window.addEventListener("keydown", onKey);
    window.addEventListener(OPEN_EVENT, onOpenEvent);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener(OPEN_EVENT, onOpenEvent);
    };
  }, []);

  return (
    <CommandPalette
      open={open}
      onClose={() => setOpen(false)}
      commands={commands}
      // Free-text passthrough: anything that reads as a question/task fires
      // the Earn dock with the query as its prompt.
      queryAction={{
        label: "ask earn",
        run: (query) => {
          window.dispatchEvent(
            new CustomEvent("earn:open-with-context", { detail: { prompt: query } }),
          );
        },
      }}
    />
  );
}
