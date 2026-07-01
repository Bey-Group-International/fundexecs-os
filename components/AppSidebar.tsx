"use client";

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";

// Client-side side rail, Claude Code style. Minimal top level (Logo · New
// Session · Workflows · More), the operational hubs whose modules expand on
// click, then a "Recent" conversation list below the hubs — sessions filed
// under group names with an Ungrouped bucket — and a bottom account button
// whose menu pops out on click with Sign out pinned to the very bottom.

interface NavItem {
  href: string;
  label: string;
  /** Foundation progress for Build modules — drives the rail status dot. */
  status?: "empty" | "started" | "complete";
}

interface HubItem {
  key: string;
  label: string;
  modules: NavItem[];
  // Hubs that act outside the firm run behind an approval gate — flagged in the
  // rail with a small "Approval gate" badge (per the product mockups).
  approvalGated?: boolean;
}

interface SessionItem {
  id: string;
  name: string;
  color: string | null;
  groupId: string | null;
  pinned: boolean;
  unread: boolean;
}

interface GroupItem {
  id: string;
  name: string;
}

// Secondary destinations folded under "More".
const MORE_ITEMS: NavItem[] = [
  { href: "/dashboard", label: "Command Center" },
  { href: "/grid", label: "Execution Grid" },
  { href: "/grid/review", label: "Routing Review" },
  { href: "/portfolio", label: "Portfolio" },
  { href: "/agenda", label: "Agenda" },
  { href: "/reports", label: "LP Report" },
  { href: "/search", label: "Search" },
  { href: "/activity", label: "Activity" },
  { href: "/capital-map", label: "Capital Map" },
  { href: "/graph", label: "Graphs" },
  { href: "/marketplace", label: "Marketplace" },
  { href: "/meetings", label: "Meeting Copilot" },
  { href: "/envelopes", label: "Documents & Signatures" },
];

// Account menu, in display order. Items with a real destination are links;
// Walkthrough has no href and instead re-opens the guided tour overlay. Each
// carries a glyph so the popout reads at a glance.
const ACCOUNT_ITEMS: { label: string; href?: string; icon: string }[] = [
  { label: "Settings", href: "/settings", icon: "⚙" },
  { label: "Integrations", href: "/settings#integrations", icon: "⇆" },
  { label: "Get help", href: "/settings#help", icon: "?" },
  { label: "Walkthrough", icon: "✷" },
  { label: "Learn more", href: "/settings#about", icon: "ℹ" },
  { label: "View plans", href: "/wallet", icon: "◆" },
  { label: "Gift Earn", href: "/gift", icon: "✦" },
  { label: "Earn guide", href: "/earn", icon: "✧" },
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

// A row in the session "⋯" menu. With an onClick it acts as a plain button;
// without one it submits its enclosing server-action form.
function MenuButton({ children, onClick }: { children: ReactNode; onClick?: () => void }) {
  return (
    <button
      type={onClick ? "button" : "submit"}
      onClick={onClick}
      className="w-full truncate rounded-md px-2 py-1 text-left text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
    >
      {children}
    </button>
  );
}

interface SessionRowProps {
  s: SessionItem;
  isActive: boolean;
  isRenaming: boolean;
  setRenamingId: (id: string | null) => void;
  isMenuOpen: boolean;
  setMenuId: (id: string | null) => void;
  moveOpen: boolean;
  setMoveOpen: React.Dispatch<React.SetStateAction<boolean>>;
  groups: GroupItem[];
  closeMenu: () => void;
  renameSessionAction: (formData: FormData) => void;
  pinSessionAction: (formData: FormData) => void;
  unreadSessionAction: (formData: FormData) => void;
  shareSessionAction: (formData: FormData) => void;
  archiveSessionAction: (formData: FormData) => void;
  deleteSessionAction: (formData: FormData) => void;
  moveSessionAction: (formData: FormData) => void;
}

const SessionRow = memo(function SessionRow({
  s,
  isActive,
  isRenaming,
  setRenamingId,
  isMenuOpen,
  setMenuId,
  moveOpen,
  setMoveOpen,
  groups,
  closeMenu,
  renameSessionAction,
  pinSessionAction,
  unreadSessionAction,
  shareSessionAction,
  archiveSessionAction,
  deleteSessionAction,
  moveSessionAction,
}: SessionRowProps) {
  function copyLink(id: string) {
    try {
      void navigator.clipboard.writeText(`${window.location.origin}/session/${id}`);
    } catch {
      // clipboard unavailable — no-op
    }
  }

  if (isRenaming) {
    return (
      <form
        action={renameSessionAction}
        onSubmit={() => setRenamingId(null)}
        className="flex items-center gap-1 px-2 py-0.5 pl-4"
      >
        <input type="hidden" name="id" value={s.id} />
        <input
          name="name"
          defaultValue={s.name}
          autoFocus
          onBlur={() => setRenamingId(null)}
          onKeyDown={(e) => {
            if (e.key === "Escape") setRenamingId(null);
          }}
          className="min-w-0 flex-1 rounded-md border border-line bg-surface-0 px-1.5 py-1 text-[13px] text-fg-primary focus:border-gold-500/60 focus:outline-none"
        />
      </form>
    );
  }

  const menuItems = (
    <>
      <form action={pinSessionAction} onSubmit={closeMenu}>
        <input type="hidden" name="id" value={s.id} />
        <input type="hidden" name="pinned" value={s.pinned ? "false" : "true"} />
        <MenuButton>{s.pinned ? "Unpin" : "Pin"}</MenuButton>
      </form>
      <form action={unreadSessionAction} onSubmit={closeMenu}>
        <input type="hidden" name="id" value={s.id} />
        <input type="hidden" name="unread" value={s.unread ? "false" : "true"} />
        <MenuButton>{s.unread ? "Mark as read" : "Mark as unread"}</MenuButton>
      </form>
      <MenuButton
        onClick={() => {
          setRenamingId(s.id);
          closeMenu();
        }}
      >
        Rename
      </MenuButton>
      <form action={shareSessionAction} onSubmit={closeMenu}>
        <input type="hidden" name="id" value={s.id} />
        <input type="hidden" name="scope" value="org" />
        <MenuButton>Share</MenuButton>
      </form>
      <MenuButton
        onClick={() => {
          copyLink(s.id);
          closeMenu();
        }}
      >
        Copy link
      </MenuButton>

      <button
        type="button"
        onClick={() => setMoveOpen((v) => !v)}
        aria-expanded={moveOpen}
        className="flex w-full items-center justify-between rounded-md px-2 py-1 text-left text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
      >
        Move to group
        <span className="text-fg-muted">{moveOpen ? "▾" : "▸"}</span>
      </button>
      {moveOpen ? (
        <div className="flex flex-col gap-0.5 pl-2">
          {[{ id: "", name: "Ungrouped" }, ...groups].map((g) => {
            const current = (s.groupId ?? "") === g.id;
            return (
              <form key={g.id || "ungrouped"} action={moveSessionAction} onSubmit={closeMenu}>
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
        </div>
      ) : null}

      <form action={archiveSessionAction} onSubmit={closeMenu}>
        <input type="hidden" name="id" value={s.id} />
        <input type="hidden" name="archived" value="true" />
        <MenuButton>Archive</MenuButton>
      </form>

      <div className="my-0.5 border-t border-line" />
      <form
        action={deleteSessionAction}
        onSubmit={(e) => {
          if (!window.confirm(`Delete "${s.name}"? This can't be undone.`)) {
            e.preventDefault();
            return;
          }
          closeMenu();
        }}
      >
        <input type="hidden" name="id" value={s.id} />
        <button className="w-full truncate rounded-md px-2 py-1 text-left text-xs text-status-danger transition hover:bg-status-danger/10 hover:text-status-danger">
          Delete
        </button>
      </form>
    </>
  );

  return (
    <div className="relative flex items-center">
      <Link
        href={`/session/${s.id}`}
        title={s.name}
        className={`flex min-w-0 flex-1 items-center gap-2 rounded-md px-2 py-1.5 pl-4 transition ${
          isActive
            ? "bg-surface-2 text-fg-primary"
            : "text-fg-secondary hover:bg-surface-2 hover:text-fg-primary"
        }`}
      >
        {s.pinned ? (
          <span className="shrink-0 text-[10px] leading-none text-gold-400" title="Pinned">
            📌
          </span>
        ) : (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full"
            style={{ backgroundColor: s.color ?? "#a1a1aa" }}
          />
        )}
        <span
          className={`min-w-0 flex-1 truncate text-[13px] ${
            s.unread ? "font-semibold text-fg-primary" : ""
          }`}
        >
          {s.name}
        </span>
        {s.unread ? (
          <span
            className="h-1.5 w-1.5 shrink-0 rounded-full bg-gold-400"
            title="Unread"
          />
        ) : null}
      </Link>
      <button
        type="button"
        onClick={() => {
          setMoveOpen(false);
          setMenuId(isMenuOpen ? null : s.id);
        }}
        aria-label="Session actions"
        title="Session actions"
        className="shrink-0 rounded-md px-1.5 py-1 text-xs text-fg-muted transition hover:text-fg-primary"
      >
        ⋯
      </button>

      {isMenuOpen ? (
        <div className="absolute right-1 top-full z-10 mt-0.5 flex w-44 flex-col gap-0.5 rounded-lg border border-line bg-surface-1 p-1.5 shadow-2xl">
          {menuItems}
        </div>
      ) : null}
    </div>
  );
});

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
  renameSessionAction,
  shareSessionAction,
  archiveSessionAction,
  pinSessionAction,
  unreadSessionAction,
  inboxUnread = 0,
}: {
  name: string;
  planName: string;
  hubs: HubItem[];
  sessions: SessionItem[];
  groups: GroupItem[];
  inboxUnread?: number;
  signOutAction: () => void;
  createGroupAction: (formData: FormData) => void;
  moveSessionAction: (formData: FormData) => void;
  deleteSessionAction: (formData: FormData) => void;
  renameSessionAction: (formData: FormData) => void;
  shareSessionAction: (formData: FormData) => void;
  archiveSessionAction: (formData: FormData) => void;
  pinSessionAction: (formData: FormData) => void;
  unreadSessionAction: (formData: FormData) => void;
}) {
  const pathname = usePathname();
  const [moreOpen, setMoreOpen] = useState(false);
  const [openHub, setOpenHub] = useState<string | null>(null);
  const [accountOpen, setAccountOpen] = useState(false);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>({});
  const [newGroupOpen, setNewGroupOpen] = useState(false);
  // The session whose "⋯" menu is open, whether its move-to submenu is showing,
  // and the session currently being renamed inline.
  const [menuId, setMenuId] = useState<string | null>(null);
  const [moveOpen, setMoveOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);

  const closeMenu = useCallback(() => {
    setMenuId(null);
    setMoveOpen(false);
  }, []);

  const accountRef = useDismiss<HTMLDivElement>(() => setAccountOpen(false));
  const recentRef = useDismiss<HTMLDivElement>(closeMenu);

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

  return (
    <aside className="hidden w-[224px] shrink-0 flex-col border-r border-line bg-surface-1/95 backdrop-blur-xl md:flex">
      {/* Logo — centralized coin mark + wordmark */}
      <div className="flex h-12 items-center gap-2 border-b border-line px-4">
        <Logo href="/workspace" variant="coin-wordmark" />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 text-sm">
        {/* Top-level destinations, in mockup order: Sessions · Workflows ·
            Inbox · More. "Sessions" opens a fresh Earn conversation (the
            launcher); a session row is created lazily on the first prompt, so
            this never leaves empties. */}
        <div className="flex flex-col gap-0.5">
          <Link
            href="/workspace"
            className={`${linkClass} ${pathname === "/workspace" ? "bg-surface-2 text-fg-primary" : ""}`}
          >
            Sessions
          </Link>
          <Link href="/automations" className={linkClass}>
            Automations
          </Link>
          <Link href="/inbox" className={`${linkClass} justify-between`}>
            <span className="flex items-center gap-2">
              Inbox
            </span>
            {inboxUnread > 0 ? (
              <span className="rounded-full bg-gold-400 px-1.5 py-0.5 font-mono text-[10px] font-medium leading-none text-surface-0">
                {inboxUnread > 99 ? "99+" : inboxUnread}
              </span>
            ) : null}
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
                <span className="flex items-center gap-1.5">
                  {hub.label}
                  {hub.approvalGated ? (
                    <span
                      title="Approval gate — actions in this hub run behind your explicit sign-off before any outward-facing work executes"
                      className="rounded border border-gold-500/40 bg-gold-500/10 px-1 py-px font-mono text-[8px] font-medium uppercase leading-none tracking-wider text-gold-300"
                    >
                      Approval gate
                    </span>
                  ) : null}
                </span>
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
                      className="flex items-center gap-1.5 rounded-md px-2 py-1 pl-7 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary"
                    >
                      {mod.status ? (
                        <span
                          aria-hidden
                          title={
                            mod.status === "complete"
                              ? "Complete"
                              : mod.status === "started"
                                ? "In progress"
                                : "Not started"
                          }
                          className={`h-1.5 w-1.5 shrink-0 rounded-full ${
                            mod.status === "complete"
                              ? "bg-emerald-400"
                              : mod.status === "started"
                                ? "bg-gold-400"
                                : "bg-line"
                          }`}
                        />
                      ) : null}
                      <span className="truncate">{mod.label}</span>
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
                        <SessionRow
                          key={s.id}
                          s={s}
                          isActive={pathname === `/session/${s.id}`}
                          isRenaming={renamingId === s.id}
                          setRenamingId={setRenamingId}
                          isMenuOpen={menuId === s.id}
                          setMenuId={setMenuId}
                          moveOpen={menuId === s.id && moveOpen}
                          setMoveOpen={setMoveOpen}
                          groups={groups}
                          closeMenu={closeMenu}
                          renameSessionAction={renameSessionAction}
                          pinSessionAction={pinSessionAction}
                          unreadSessionAction={unreadSessionAction}
                          shareSessionAction={shareSessionAction}
                          archiveSessionAction={archiveSessionAction}
                          deleteSessionAction={deleteSessionAction}
                          moveSessionAction={moveSessionAction}
                        />
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
            <div className="absolute bottom-full left-0 right-0 mb-2 flex flex-col gap-0.5 rounded-xl border border-line/80 bg-surface-1/95 p-1.5 shadow-2xl backdrop-blur-xl">
              {ACCOUNT_ITEMS.map((item) => {
                const inner = (
                  <>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-surface-2 font-mono text-[11px] leading-none text-gold-400/90 transition group-hover:bg-gold-500/15 group-hover:text-gold-300">
                      {item.icon}
                    </span>
                    {item.label}
                  </>
                );
                const cls =
                  "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs text-fg-secondary transition hover:bg-surface-2 hover:text-fg-primary";
                return item.href ? (
                  <Link
                    key={item.label}
                    href={item.href}
                    onClick={() => setAccountOpen(false)}
                    className={cls}
                  >
                    {inner}
                  </Link>
                ) : (
                  <button
                    key={item.label}
                    type="button"
                    onClick={() => {
                      setAccountOpen(false);
                      window.dispatchEvent(new Event("fx:open-tour"));
                    }}
                    className={`${cls} text-left`}
                  >
                    {inner}
                  </button>
                );
              })}
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
