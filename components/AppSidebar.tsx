"use client";

import { useEffect, useRef, useState } from "react";
import Image from "next/image";
import Link from "next/link";
import { usePathname } from "next/navigation";

// Client-side side rail, Claude Code style. Minimal top level (Logo · New
// Session · Workflows · More), the operational hubs whose modules expand on
// click, then a "Recent" conversation list below the hubs — sessions filed
// under group names with an Ungrouped bucket — and a bottom account button
// whose menu pops out on click with Sign out pinned to the very bottom.

interface NavItem {
  href: string;
  label: string;
}

interface HubItem {
  key: string;
  label: string;
  modules: NavItem[];
}

interface SessionItem {
  id: string;
  name: string;
  color: string | null;
  groupId: string | null;
}

interface GroupItem {
  id: string;
  name: string;
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
  sessions,
  groups,
  signOutAction,
  createGroupAction,
  moveSessionAction,
  deleteSessionAction,
}: {
  name: string;
  planName: string;
  hubs: HubItem[];
  sessions: SessionItem[];
  groups: GroupItem[];
  signOutAction: () => void;
  createGroupAction: (formData: FormData) => void;
  moveSessionAction: (formData: FormData) => void;
  deleteSessionAction: (formData: FormData) => void;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [openHub, setOpenHub] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  const [movingId, setMovingId] = useState<string | null>(null);

  const accountRef = useDismiss<HTMLDivElement>(() => setAccountOpen(false));
  const recentRef = useDismiss<HTMLDivElement>(() => setMovingId(null));

  // Group the recent sessions: named groups (in catalog order) that actually
  // hold a session, then the ungrouped bucket last.
  const byGroup = new Map<string, SessionItem[]>();
  for (const s of sessions) {
    const k = s.groupId ?? "";
    const list = byGroup.get(k) ?? [];
    list.push(s);
    byGroup.set(k, list);
  }
  const recentSections: { key: string; label: string; sessions: SessionItem[] }[] = [
    ...groups
      .filter((g) => byGroup.has(g.id))
      .map((g) => ({ key: g.id, label: g.name, sessions: byGroup.get(g.id) ?? [] })),
    ...(byGroup.has("")
      ? [{ key: "", label: "Ungrouped", sessions: byGroup.get("") ?? [] }]
      : []),
  ];

  const linkClass =
    "flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary";

  // A single conversation row, Claude Code style: color dot, active highlight,
  // and a "⋯" menu to file it under a group.
  function SessionRow({ s }: { s: SessionItem }) {
    const active = pathname === `/session/${s.id}`;
    return (
      <div className="relative flex items-center">
        <Link
          href={`/session/${s.id}`}
          title={s.name}
          className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 pl-4 transition ${
            active
              ? "bg-surface-2 text-fg-primary"
              : "text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
          }`}
        >
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: s.color ?? "#a1a1aa" }}
          />
          <span className="min-w-0 flex-1 truncate text-[13px]">{s.name}</span>
        </Link>
        <button
          type="button"
          onClick={() => setMovingId(movingId === s.id ? null : s.id)}
          aria-label="Session actions"
          title="Session actions"
          className="shrink-0 rounded-md px-1.5 py-1 text-xs text-fg-muted transition hover:text-fg-primary"
        >
          ⋯
        </button>

        {movingId === s.id ? (
          <div className="absolute right-1 top-full z-10 mt-0.5 flex w-40 flex-col gap-0.5 rounded-lg border border-line bg-surface-1 p-1.5 shadow-2xl">
            <p className="px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-widest text-fg-muted">
              Move to
            </p>
            {[{ id: "", name: "Ungrouped" }, ...groups].map((g) => {
              const current = (s.groupId ?? "") === g.id;
              return (
                <form
                  key={g.id || "ungrouped"}
                  action={moveSessionAction}
                  onSubmit={() => setMovingId(null)}
                >
                  <input type="hidden" name="id" value={s.id} />
                  <input type="hidden" name="group_id" value={g.id} />
                  <button
                    disabled={current}
                    className={`w-full truncate rounded-md px-2 py-1 text-left text-xs transition ${
                      current
                        ? "text-gold-300"
                        : "text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
                    }`}
                  >
                    {current ? "✓ " : ""}
                    {g.name}
                  </button>
                </form>
              );
            })}

            <div className="my-0.5 border-t border-line" />
            <form
              action={deleteSessionAction}
              onSubmit={(e) => {
                if (!window.confirm(`Delete “${s.name}”? This can't be undone.`)) {
                  e.preventDefault();
                  return;
                }
                setMovingId(null);
              }}
            >
              <input type="hidden" name="id" value={s.id} />
              <button className="w-full truncate rounded-md px-2 py-1 text-left text-xs text-red-400 transition hover:bg-red-500/10 hover:text-red-300">
                Delete
              </button>
            </form>
          </div>
        ) : null}
      </div>
    );
  }

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
        {/* New Session opens a blank conversation. The session row is created
            lazily on the first prompt, so clicking this never leaves empties. */}
        <Link
          href="/workspace"
          className="flex w-full items-center justify-center gap-2 rounded-md bg-gold-400 px-2 py-2 text-sm font-medium text-surface-0 transition hover:bg-gold-300"
        >
          <span className="text-base leading-none">+</span>
          New Session
        </Link>

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

        {/* Conversation list below the hubs, filed under group names with an
            Ungrouped bucket. */}
        <div ref={recentRef} className="mt-5 border-t border-line pt-3">
          <div className="mb-1 flex items-center justify-end px-2">
            <button
              type="button"
              onClick={() => setNewGroupOpen((v) => !v)}
              aria-label="New group"
              title="New group"
              className="font-mono text-xs leading-none text-fg-muted transition hover:text-gold-400"
            >
              +
            </button>
          </div>

          {newGroupOpen ? (
            <form
              action={createGroupAction}
              onSubmit={() => setNewGroupOpen(false)}
              className="mb-1.5 flex items-center gap-1 px-2"
            >
              <input
                name="name"
                autoFocus
                placeholder="Group name…"
                className="min-w-0 flex-1 rounded-md border border-line bg-surface-0 px-2 py-1 text-xs text-fg-primary placeholder:text-fg-muted focus:border-gold-500/60 focus:outline-none"
              />
              <button className="rounded-md border border-line px-1.5 py-1 text-[10px] text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary">
                Add
              </button>
            </form>
          ) : null}

          {recentSections.length === 0 ? (
            <p className="px-2 py-1 text-xs text-fg-muted">No sessions yet.</p>
          ) : (
            recentSections.map((sec) => {
              const isGroupCollapsed = collapsedGroups[sec.key];
              return (
                <div key={sec.key || "ungrouped"} className="mb-1">
                  <button
                    type="button"
                    onClick={() =>
                      setCollapsedGroups((prev) => ({
                        ...prev,
                        [sec.key]: !prev[sec.key],
                      }))
                    }
                    aria-expanded={!isGroupCollapsed}
                    className="flex w-full items-center justify-between rounded-md px-2 py-1 font-mono text-[10px] uppercase tracking-widest text-gold-400 transition hover:bg-surface-2"
                  >
                    <span className="truncate">{sec.label}</span>
                    <span className="text-fg-muted">{isGroupCollapsed ? "▸" : "▾"}</span>
                  </button>

                  {!isGroupCollapsed ? (
                    <div className="flex flex-col gap-0.5">
                      {sec.sessions.map((s) => (
                        <SessionRow key={s.id} s={s} />
                      ))}
                    </div>
                  ) : null}
                </div>
              );
            })
          )}
        </div>
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
