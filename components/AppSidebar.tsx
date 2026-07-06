"use client";

import { memo, useCallback, useEffect, useRef, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { Logo } from "@/components/Logo";
import { StreakBar } from "@/components/StreakBar";
import type { StreakState } from "@/lib/gamification";
import { useMobileNav } from "@/components/nav/mobile-nav";
import { navHrefActive } from "@/lib/nav-active";

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

// Per-hub visual identity — icon glyph + left-edge accent color.
const HUB_IDENTITY: Record<string, { icon: string; color: string }> = {
  build:   { icon: "⬡", color: "#f59e0b" },  // gold — foundation
  source:  { icon: "◎", color: "#38bdf8" },  // blue — deal radar
  run:     { icon: "⚡", color: "#22c55e" }, // emerald — execution
  execute: { icon: "▶", color: "#a78bfa" },  // violet — outbound
};

// Secondary destinations folded under "More". Kept intentionally lean: entries
// that duplicate a hub module or another destination live where they belong and
// are not repeated here. Notably "LP Report" is gone — Execute › Reporting is
// the single reporting surface (/reports now redirects there); "Portfolio"
// lives under Execute › Asset Management; "Command Center" is the /command-center
// / dashboard surface; and "Capital Map" overlaps Graphs + Source › LP Pipeline.
const MORE_ITEMS: NavItem[] = [
  { href: "/prospecting", label: "Prospecting" },
  { href: "/campaigns", label: "Campaigns" },
  { href: "/grid", label: "Execution Grid" },
  { href: "/grid/review", label: "Routing Review" },
  { href: "/activity", label: "Activity" },
  { href: "/agenda", label: "Agenda" },
  { href: "/meetings", label: "Meetings" },
  { href: "/search", label: "Search" },
  { href: "/graph", label: "Graphs" },
  { href: "/marketplace", label: "Marketplace" },
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

interface AppSidebarProps {
  name: string;
  planName: string;
  hubs: HubItem[];
  sessions: SessionItem[];
  groups: GroupItem[];
  streak?: StreakState;
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
}

// The hub/session/account nav content, shared verbatim by the always-mounted
// desktop rail and the mobile slide-over so the two surfaces can never drift —
// each mounted instance owns its own local UI state (which hub is expanded,
// which session menu is open, etc.) independently.
function SidebarPanel({
  name,
  planName,
  hubs,
  sessions,
  groups,
  streak,
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
}: AppSidebarProps) {
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
    "flex items-center gap-2 rounded-md px-2 py-1.5 text-fg-secondary transition duration-150 hover:bg-surface-2/80 hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400";
  const activeLinkClass = "fx-nav-active rounded-md px-2 py-1.5 text-fg-primary transition duration-150 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400";

  return (
    <>
      {/* Logo — centralized coin mark + wordmark, with subtle glow beneath */}
      <div className="relative flex h-12 items-center gap-2 border-b border-line/60 px-4">
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 bottom-0 h-px bg-gradient-to-r from-transparent via-gold-500/30 to-transparent"
        />
        <Logo href="/command-center" variant="coin-wordmark" />
      </div>

      <nav className="flex-1 overflow-y-auto px-2 py-3 text-sm">
        {/* Top-level destinations */}
        <div className="flex flex-col gap-0.5">
          <Link
            href="/workspace"
            className={navHrefActive(pathname, "/workspace") ? `${activeLinkClass} flex items-center gap-2` : linkClass}
          >
            Sessions
          </Link>
          <Link
            href="/automations"
            className={navHrefActive(pathname, "/automations") ? `${activeLinkClass} flex items-center gap-2` : linkClass}
          >
            Automations
          </Link>
          {/* Command Center — direct rail access to the AI Executive Command
              Floor (the spatial office world where Earn orchestrates the
              executive team). Sits between Automations and Inbox. */}
          <Link
            href="/command-center"
            className={`${navHrefActive(pathname, "/command-center") ? `${activeLinkClass} flex items-center justify-between gap-2` : `${linkClass} justify-between`}`}
          >
            <span className="flex items-center gap-2">
              <span aria-hidden className="font-mono text-base leading-none text-neural-400">◈</span>
              Command Center
            </span>
          </Link>
          <Link
            href="/inbox"
            className={`${navHrefActive(pathname, "/inbox") ? `${activeLinkClass} flex items-center justify-between gap-2` : `${linkClass} justify-between`}`}
          >
            <span className="flex items-center gap-2">
              Inbox
            </span>
            {inboxUnread > 0 ? (
              <span className="rounded-full bg-gradient-to-r from-gold-400 to-gold-300 px-1.5 py-0.5 font-mono text-[10px] font-bold leading-none text-surface-0 shadow-[0_0_8px_rgb(var(--fx-gold-rgb)/0.5)]">
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
            <span className="font-mono text-[10px] text-fg-muted transition-transform duration-150" style={{ transform: moreOpen ? "rotate(90deg)" : "rotate(0deg)" }}>
              ▸
            </span>
          </button>
          {moreOpen ? (
            <div className="flex flex-col animate-fade-up">
              {MORE_ITEMS.map((item) => (
                <Link
                  key={item.label}
                  href={item.href}
                  className={`rounded-md px-2 py-1 pl-9 text-xs transition duration-150 ${
                    navHrefActive(pathname, item.href)
                      ? "text-gold-300 bg-gold-500/8"
                      : "text-fg-secondary hover:bg-surface-2/80 hover:text-fg-primary"
                  }`}
                >
                  {item.label}
                </Link>
              ))}
            </div>
          ) : null}
        </div>

        <p className="mb-1.5 mt-5 px-2 font-mono text-[9px] uppercase tracking-[0.22em] text-fg-muted/70">
          Hubs
        </p>
        {hubs.map((hub) => {
          const isOpen = openHub === hub.key;
          const identity = HUB_IDENTITY[hub.key];
          return (
            <div key={hub.key} className="relative">
              {/* Left-edge accent stripe when open */}
              {isOpen && identity && (
                <span
                  aria-hidden
                  className="absolute left-0 top-[15%] bottom-[15%] w-[2px] rounded-r-full"
                  style={{ background: identity.color, boxShadow: `0 0 6px ${identity.color}` }}
                />
              )}
              <button
                type="button"
                onClick={() => setOpenHub(isOpen ? null : hub.key)}
                aria-expanded={isOpen}
                className={`flex w-full items-center justify-between rounded-md px-2 py-1.5 transition duration-150 ${
                  isOpen
                    ? "bg-gradient-to-r from-neural-400/8 to-transparent text-fg-primary"
                    : "text-fg-secondary hover:bg-surface-2/80 hover:text-fg-primary"
                }`}
              >
                <span className="flex items-center gap-1.5">
                  {identity && (
                    <span
                      aria-hidden
                      className="shrink-0 font-mono text-[13px] leading-none"
                      style={{ color: isOpen ? identity.color : undefined, opacity: isOpen ? 1 : 0.5 }}
                    >
                      {identity.icon}
                    </span>
                  )}
                  {hub.label}
                  {hub.approvalGated ? (
                    <span
                      title="Approval gate — actions in this hub run behind your explicit sign-off before any outward-facing work executes"
                      className="rounded border border-gold-500/40 bg-gold-500/10 px-1 py-px font-mono text-[8px] font-medium uppercase leading-none tracking-wider text-gold-300"
                    >
                      gate
                    </span>
                  ) : null}
                </span>
                <span
                  className="font-mono text-[10px] text-fg-muted transition-transform duration-200"
                  style={{ transform: isOpen ? "rotate(90deg)" : "rotate(0deg)" }}
                >
                  ▸
                </span>
              </button>
              {/* Modules reveal on click. */}
              {isOpen ? (
                <div className="flex flex-col animate-fade-up">
                  {hub.modules.map((mod) => {
                    const isModActive = navHrefActive(pathname, mod.href);
                    return (
                      <Link
                        key={mod.href}
                        href={mod.href}
                        className={`flex items-center gap-1.5 rounded-md px-2 py-1 pl-7 text-xs transition duration-150 ${
                          isModActive
                            ? "bg-gradient-to-r from-neural-400/10 to-transparent text-fg-primary font-medium"
                            : "text-fg-secondary hover:bg-surface-2/80 hover:text-fg-primary"
                        }`}
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
                                ? "bg-emerald-400 shadow-[0_0_5px_#34d399]"
                                : mod.status === "started"
                                  ? "bg-gold-400 shadow-[0_0_5px_rgb(var(--fx-gold-rgb)/0.7)]"
                                  : "bg-line"
                            }`}
                          />
                        ) : null}
                        <span className="truncate">{mod.label}</span>
                      </Link>
                    );
                  })}
                </div>
              ) : null}
            </div>
          );
        })}

        {/* Execution streak — sits beneath the hub list. */}
        {streak ? (
          <div className="mt-3">
            <StreakBar
              current={streak.current}
              longest={streak.longest}
              lastActivityAt={streak.lastActivityAt}
              freezeUsedAt={streak.freezeUsedAt}
            />
          </div>
        ) : null}

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
      <div className="relative border-t border-line/60 p-3" ref={accountRef}>
        {/* Subtle top glow line */}
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold-500/20 to-transparent"
        />
        <div className="relative">
          <button
            type="button"
            onClick={() => setAccountOpen((v) => !v)}
            aria-expanded={accountOpen}
                className="flex w-full items-center gap-2 rounded-md px-1.5 py-1.5 text-left transition duration-150 hover:bg-surface-2/80 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400"
          >
            {/* Avatar with gold ring */}
            <span className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-gradient-to-br from-gold-300 to-gold-500 font-display text-xs font-bold text-surface-0 shadow-[0_0_10px_rgb(var(--fx-gold-rgb)/0.4)]">
              {name.charAt(0).toUpperCase()}
            </span>
            <span className="min-w-0 flex-1">
              <span className="block truncate text-xs font-semibold text-fg-primary">
                {name}
              </span>
              <span className="block truncate text-[10px] text-gold-400/70">
                {planName} plan
              </span>
            </span>
            <span
              className="font-mono text-[10px] text-fg-muted transition-transform duration-200"
              style={{ transform: accountOpen ? "rotate(180deg)" : "rotate(0deg)" }}
            >
              ▾
            </span>
          </button>

          {accountOpen ? (
            <div className="absolute bottom-full left-0 right-0 mb-2 flex flex-col gap-0.5 rounded-xl border border-line/80 bg-surface-1/95 p-1.5 shadow-[0_-8px_40px_-12px_rgba(0,0,0,0.6)] backdrop-blur-xl animate-fade-up">
              {ACCOUNT_ITEMS.map((item) => {
                const inner = (
                  <>
                    <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-md bg-surface-2/80 font-mono text-[11px] leading-none text-gold-400/90 transition group-hover:bg-gold-500/15 group-hover:text-gold-300">
                      {item.icon}
                    </span>
                    {item.label}
                  </>
                );
                const cls =
                  "group flex items-center gap-2.5 rounded-md px-2 py-1.5 text-xs text-fg-secondary transition duration-100 hover:bg-surface-2/80 hover:text-fg-primary";
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
          <button className="w-full rounded-md border border-line/60 px-2 py-1.5 text-xs text-fg-muted transition duration-150 hover:border-line hover:bg-surface-2/60 hover:text-fg-secondary">
            Sign out
          </button>
        </form>
      </div>
    </>
  );
}

// Below `md` the desktop rail is `hidden` with nothing standing in for it — a
// hamburger in the header (GlobalTopBar / SessionCommandBar) toggles this
// slide-over via the shared MobileNavProvider so the exact same hub/session
// nav is reachable on a phone.
export function AppSidebar(props: AppSidebarProps) {
  const { open, setOpen } = useMobileNav();
  const pathname = usePathname();

  // Close on navigation — covers link clicks, back/forward, and programmatic
  // redirects alike without wiring an onClick through every nav Link.
  useEffect(() => {
    setOpen(false);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    const prevOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    return () => {
      document.removeEventListener("keydown", onKey);
      document.body.style.overflow = prevOverflow;
    };
  }, [open, setOpen]);

  return (
    <>
      <aside className="hidden w-[224px] shrink-0 flex-col border-r border-line/60 bg-surface-1/95 backdrop-blur-xl md:flex">
        <SidebarPanel {...props} />
      </aside>

      {open ? (
            <div role="dialog" aria-modal="true" aria-label="Navigation" className="fixed inset-0 z-50 md:hidden">
          <div
            aria-hidden
            onClick={() => setOpen(false)}
            className="fixed inset-0 bg-black/60 backdrop-blur-sm motion-safe:animate-fade-up"
          />
          <aside id="fx-mobile-nav" className="fixed inset-y-0 left-0 flex w-[260px] max-w-[80vw] flex-col border-r border-line/60 bg-surface-1 shadow-2xl motion-safe:animate-slide-in-left">
            <SidebarPanel {...props} />
          </aside>
        </div>
      ) : null}
    </>
  );
}
