"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";

// Client-side side rail. Modeled on Claude Code's sidebar: a minimal top level
// (Logo · New Session · Workflows · More), the operational hubs whose modules
// expand on click, and a bottom account button whose menu pops out on click
// with Sign out pinned to the very bottom. All reveal-on-click — no hover.

interface NavItem {
  href: string;
  label: string;
}

interface HubItem {
  key: string;
  label: string;
  modules: NavItem[];
}

// Secondary destinations folded under "More".
const MORE_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Command Center" },
  { href: "/capital-map", label: "Capital Map" },
  { href: "/graph", label: "Graphs" },
  { href: "/marketplace", label: "Marketplace" },
];

// Account menu, in display order. Items with a real destination are links;
// Walkthrough has no href and instead re-opens the guided tour overlay.
const ACCOUNT_ITEMS: { label: string; href?: string }[] = [
  { label: "Settings", href: "/settings" },
  { label: "Get help", href: "/settings#help" },
  { label: "Walkthrough" },
  { label: "View plans", href: "/wallet" },
  { label: "Integrations", href: "/settings#integrations" },
  { label: "Gift Earn", href: "/wallet" },
  { label: "Learn more", href: "/" },
  { label: "Brains", href: "/earn" },
];

function useDismiss<T extends HTMLElement>(onDismiss: () => void) {
  const ref = useRef<T>(null);
  useEffect(() => {
    function handle(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) onDismiss();
    }
    document.addEventListener("mousedown", handle);
    return () => document.removeEventListener("mousedown", handle);
  }, [onDismiss]);
  return ref;
}

export function AppSidebar({
  name,
  planName,
  hubs,
  startSessionAction,
  signOutAction,
}: {
  name: string;
  planName: string;
  hubs: HubItem[];
  startSessionAction: () => void;
  signOutAction: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const [openHub, setOpenHub] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);

  const accountRef = useDismiss<HTMLDivElement>(() => setAccountOpen(false));

  const linkClass =
    "flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary";

  return (
    <aside className="flex w-[224px] shrink-0 flex-col border-r border-line bg-surface-1">
      {/* Logo — Earn coin mark + wordmark */}
      <div className="flex h-12 items-center gap-2 border-b border-line px-4">
        <Link href="/workspace" className="flex items-center gap-2">
          <Image
            src="/earn-coin.png"
            alt="Earn"
            width={24}
            height={24}
            className="h-6 w-6 rounded-md object-contain"
            priority
          />
          <span className="font-mono text-xs uppercase tracking-[0.22em] text-gold-400">
            FundExecs OS
          </span>
        </Link>
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 text-sm">
        <form action={startSessionAction}>
          <button className="flex w-full items-center justify-center gap-2 rounded-md bg-gold-400 px-2 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300">
            <span className="text-base leading-none">+</span>
            New Session
          </button>
        </form>

        <div className="mt-3 flex flex-col gap-0.5">
          <Link href="/automations" className={linkClass}>
            <span className="font-mono text-base leading-none text-gold-400">↻</span>
            Workflows
          </Link>

          {/* More — secondary destinations expand on click */}
          <button
            type="button"
            onClick={() => setMoreOpen((v) => !v)}
            aria-expanded={moreOpen}
            className={`${linkClass} w-full justify-between`}
          >
            <span className="flex items-center gap-2">
              <span className="font-mono text-base leading-none text-gold-400">⋯</span>
              More
            </span>
            <span className="font-mono text-[10px] text-fg-muted">
              {moreOpen ? "▾" : "▸"}
            </span>
          </button>
          {moreOpen ? (
            <div className="flex flex-col">
              {MORE_ITEMS.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className="rounded-md px-2 py-1 pl-9 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        <p className="mb-1 mt-5 px-2 font-mono text-[10px] uppercase tracking-widest text-fg-muted">
          Hubs
        </p>
        {hubs.map((hub) => {
          const isOpen = openHub === hub.key;
          return (
            <div key={hub.key}>
              <button
                type="button"
                onClick={() => setOpenHub(isOpen ? null : hub.key)}
                aria-expanded={isOpen}
                className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
              >
                {hub.label}
                <span className="font-mono text-[10px] text-fg-muted">
                  {isOpen ? "▾" : "▸"}
                </span>
              </button>
              {/* Modules reveal on click. */}
              {isOpen ? (
                <div className="flex flex-col">
                  {hub.modules.map((mod) => (
                    <Link
                      key={mod.href}
                      href={mod.href}
                      className="rounded-md px-2 py-1 pl-7 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                    >
                      {mod.label}
                    </Link>
                  ))}
                </div>
              ) : null}
            </div>
          );
        })}
      </nav>

      {/* Account — name + plan; menu pops out on click, Sign out pinned below */}
      <div className="border-t border-line p-3" ref={accountRef}>
        <div className="relative">
          <button
            type="button"
            onClick={() => setAccountOpen((v) => !v)}
            aria-expanded={accountOpen}
            className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition hover:bg-surface-2"
          >
            <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gold-400 font-display text-xs font-bold text-surface-0">
              {name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-medium text-fg-primary">
                {name}
              </span>
              <span className="block truncate text-[10px] text-fg-muted">
                {planName} plan
              </span>
            </span>
            <span className="font-mono text-[10px] text-fg-muted">
              {accountOpen ? "▾" : "▸"}
            </span>
          </button>

          {accountOpen ? (
            <div className="absolute bottom-full left-0 right-0 mb-2 flex flex-col gap-0.5 rounded-lg border border-line bg-surface-1 p-1.5 shadow-2xl">
              {ACCOUNT_ITEMS.map((item) =>
                item.href ? (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setAccountOpen(false)}
                    className="rounded-md px-2 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                  >
                    {item.label}
                  </Link>
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setAccountOpen(false);
                      window.dispatchEvent(new Event("fx:open-tour"));
                    }}
                    className="rounded-md px-2 py-1.5 text-left text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                  >
                    {item.label}
                  </button>
                ),
              )}
            </div>
          ) : null}
        </div>

        {/* Sign out — at the very bottom */}
        <form action={signOutAction} className="mt-2">
          <button className="w-full rounded-md border border-line px-2 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary">
            Sign out
          </button>
        </form>
      </div>
    </aside>
  );
}
