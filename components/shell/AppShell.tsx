'use client';

import { useState, type ReactNode } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import {
  LayoutDashboard,
  TrendingUp,
  Users,
  Plug,
  Target,
  Bell,
  Search,
  Settings,
  ChevronsUpDown,
  Sun,
  Moon,
  Menu,
  X,
  LogOut,
  type LucideIcon
} from 'lucide-react';
import { Avatar, Badge, AnimatedNumber } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import { createClient } from '@/lib/supabase/client';
import type { ShellIdentity } from '@/lib/queries/identity';
import { cn } from '@/lib/utils';
import { EarnOrb } from './earn/EarnOrb';
import { EarnDock } from './earn/EarnDock';
import { TrustToaster } from './trust/TrustToaster';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Static numeric badge — usually omitted; prefer `dynamicBadge`. */
  badge?: number;
  /** Live-data badge slot. Resolved against the current `ShellIdentity`
   *  on render, so the value stays in sync with server-side state. */
  dynamicBadge?: 'unread';
}

const NAV: NavItem[] = [
  { href: '/command-center', label: 'Command Center', icon: LayoutDashboard },
  { href: '/pipeline', label: 'Pipeline', icon: TrendingUp },
  { href: '/connections', label: 'Connections', icon: Users },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/strategy', label: 'Strategy', icon: Target },
  { href: '/notifications', label: 'Notifications', icon: Bell, dynamicBadge: 'unread' },
  { href: '/settings', label: 'Settings', icon: Settings }
];

/** Generic fallback when no signed-in identity is supplied (e.g. SSR before
 *  auth resolves). Never shows a fabricated person's name. */
const DEFAULT_IDENTITY: ShellIdentity = {
  name: 'Your account',
  role: 'Operator',
  email: null,
  orgName: 'Your fund',
  orgTier: 'Emerging manager',
  level: 1,
  xp: 0,
  unreadCount: 0
};

/** Topbar theme toggle — flips `data-theme`, persists to localStorage('fx-theme').
 *  The icon is driven by `data-theme` via CSS (no React state) so there's no
 *  hydration mismatch; the flip is wrapped in `.fx-no-transition` so nothing
 *  animates `color`. */
function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    root.classList.add('fx-no-transition');
    const isLight = root.getAttribute('data-theme') === 'light';
    if (isLight) {
      root.removeAttribute('data-theme');
    } else {
      root.setAttribute('data-theme', 'light');
    }
    try {
      localStorage.setItem('fx-theme', isLight ? 'dark' : 'light');
    } catch {
      /* ignore */
    }
    requestAnimationFrame(() => root.classList.remove('fx-no-transition'));
  }

  return (
    <button
      type="button"
      onClick={toggle}
      aria-label="Toggle theme"
      className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] border border-hairline bg-surface-1 text-fg-3 transition-[background,box-shadow] hover:bg-surface-2 hover:text-fg-1"
    >
      <Sun size={17} strokeWidth={1.9} className="fx-icon-sun" aria-hidden />
      <Moon size={17} strokeWidth={1.9} className="fx-icon-moon" aria-hidden />
    </button>
  );
}

function SidebarNav({
  pathname,
  onNavigate,
  identity
}: {
  pathname: string;
  onNavigate: () => void;
  identity: ShellIdentity;
}) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
      <div className="px-3 pb-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
        Workspace
      </div>
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        const badgeValue =
          item.badge ?? (item.dynamicBadge === 'unread' ? identity.unreadCount : undefined);
        const showBadge = badgeValue != null && badgeValue > 0;
        return (
          <Link
            key={item.href}
            href={item.href}
            onClick={onNavigate}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13.5px] font-medium transition-[background,box-shadow,transform] will-change-transform',
              active
                ? 'bg-gradient-to-r from-[var(--azure-soft)] to-surface-1 text-fg-1'
                : 'text-fg-3 hover:translate-x-0.5 hover:bg-surface-1'
            )}
          >
            {active && (
              <span
                className="absolute -left-3 bottom-2 top-2 w-[3px] rounded-full bg-azure-1"
                aria-hidden
              />
            )}
            <Icon size={17} strokeWidth={1.9} aria-hidden />
            <span className="flex-1">{item.label}</span>
            {showBadge && (
              <Badge
                tone="azure"
                className="px-1.5 py-0.5 text-[10.5px]"
                data-testid={item.dynamicBadge === 'unread' ? 'sidebar-unread-badge' : undefined}
              >
                {badgeValue}
              </Badge>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function Sidebar({
  pathname,
  open,
  onClose,
  identity
}: {
  pathname: string;
  open: boolean;
  onClose: () => void;
  identity: ShellIdentity;
}) {
  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign('/login');
  }

  return (
    <aside
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex h-full w-[244px] flex-none flex-col border-r border-hairline bg-bg-1 transition-transform duration-200 lg:static lg:z-10 lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full'
      )}
    >
      <div className="flex items-center gap-2.5 px-[18px] pb-4 pt-[18px]">
        <span className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-gradient-to-br from-gold-1 to-gold-2 text-[15px] font-bold text-[#070b14]">
          F
        </span>
        <div className="flex-1 text-base font-semibold tracking-[-0.02em]">
          FundExecs <span className="font-medium text-fg-4">OS</span>
        </div>
        <button
          type="button"
          onClick={onClose}
          aria-label="Close menu"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-4 hover:bg-surface-1 hover:text-fg-1 lg:hidden"
        >
          <X size={16} strokeWidth={1.9} aria-hidden />
        </button>
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-[10px] border border-hairline bg-surface-1 px-2.5 py-2 transition-[background,box-shadow] hover:bg-surface-2"
        >
          <Avatar name={identity.orgName} size={26} tone="gold" />
          <div className="flex-1 overflow-hidden text-left">
            <div className="truncate text-[12.5px] font-semibold text-fg-1">{identity.orgName}</div>
            <div className="truncate text-[10.5px] text-fg-4">{identity.orgTier}</div>
          </div>
          <ChevronsUpDown size={14} strokeWidth={1.9} className="text-fg-4" aria-hidden />
        </button>
      </div>

      <SidebarNav pathname={pathname} onNavigate={onClose} identity={identity} />

      <div className="m-3 flex items-center gap-2.5 rounded-[10px] border border-hairline px-2.5 py-2.5">
        <Avatar name={identity.name} size={30} />
        <div className="flex-1 overflow-hidden">
          <div className="truncate text-[12.5px] font-semibold text-fg-1">{identity.name}</div>
          <div className="truncate text-[10.5px] text-fg-4">{identity.role}</div>
        </div>
        <Badge tone="gold" className="px-1.5 py-0.5 text-[10px]">
          L{identity.level}
        </Badge>
        <button
          type="button"
          onClick={signOut}
          aria-label="Sign out"
          title="Sign out"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-lg text-fg-4 transition-[background,box-shadow] hover:bg-surface-1 hover:text-fg-1"
        >
          <LogOut size={15} strokeWidth={1.9} aria-hidden />
        </button>
      </div>
    </aside>
  );
}

function Topbar({
  title,
  subtitle,
  onMenu,
  onAskEarn,
  identity
}: {
  title: string;
  subtitle?: string;
  onMenu: () => void;
  onAskEarn: () => void;
  identity: ShellIdentity;
}) {
  return (
    <header className="sticky top-0 z-20 flex h-[60px] flex-none items-center gap-3 border-b border-hairline bg-[var(--topbar-bg)] px-4 backdrop-blur-md sm:px-6">
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] border border-hairline bg-surface-1 text-fg-3 hover:bg-surface-2 lg:hidden"
      >
        <Menu size={18} strokeWidth={1.9} aria-hidden />
      </button>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold tracking-[-0.015em] text-fg-1">
          {title}
        </div>
        {subtitle && <div className="truncate text-xs text-fg-4">{subtitle}</div>}
      </div>

      <div className="relative hidden max-w-[320px] flex-[0_1_320px] md:block">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-5">
          <Search size={15} strokeWidth={1.9} aria-hidden />
        </span>
        <input
          type="search"
          placeholder="Search deals, LPs, partners…"
          className="w-full rounded-[10px] border border-hairline bg-surface-1 py-2 pl-9 pr-12 text-[13px] text-fg-1 outline-none transition-[border-color] placeholder:text-fg-4 focus:border-[var(--accent-line)]"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-hairline px-1.5 py-px font-mono text-[10px] text-fg-5">
          ⌘K
        </kbd>
      </div>

      <ThemeToggle />

      {/* Gold Earn coin wallet (gamification) — opens the Earn dock */}
      <button
        type="button"
        onClick={onAskEarn}
        aria-label="Ask Earn"
        className="hidden items-center gap-2 rounded-[10px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2.5 py-1 transition-[background,box-shadow] hover:bg-[var(--gold-soft)] hover:brightness-110 sm:flex"
      >
        <EarnCoin size={22} />
        <div className="leading-none">
          <AnimatedNumber
            value={identity.xp}
            className="block text-[12.5px] font-semibold text-gold-1"
          />
          <div className="text-[8px] font-semibold uppercase tracking-[0.11em] text-fg-5">
            Earn coins
          </div>
        </div>
      </button>

      <button
        type="button"
        aria-label={
          identity.unreadCount > 0
            ? `Notifications, ${identity.unreadCount} unread`
            : 'Notifications'
        }
        className="relative flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] border border-hairline bg-surface-1 text-fg-3 transition-[background,box-shadow] hover:bg-surface-2 hover:text-fg-1"
        data-testid="topbar-notifications-bell"
      >
        <Bell size={17} strokeWidth={1.9} aria-hidden />
        {identity.unreadCount > 0 ? (
          <span
            className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-bg-0 bg-azure-1 px-1 text-[10px] font-bold text-white"
            data-testid="topbar-unread-badge"
          >
            {identity.unreadCount}
          </span>
        ) : null}
      </button>

      <Avatar name={identity.name} size={32} />
    </header>
  );
}

export interface AppShellProps {
  title: string;
  subtitle?: string;
  /** Signed-in identity for the sidebar + wallet. Falls back to a generic
   *  identity (never a fabricated name) when omitted. */
  identity?: ShellIdentity | null;
  children: ReactNode;
}

/**
 * AppShell — the authenticated workspace shell: a 244px sidebar (brand, org
 * switcher, nav, user footer + sign-out), a sticky topbar (search, theme
 * toggle, gold Earn-coin wallet, notifications), a 1180px content column, and
 * a mobile drawer. Nav state derives from the current route.
 */
export function AppShell({ title, subtitle, identity, children }: AppShellProps) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const id = identity ?? DEFAULT_IDENTITY;

  return (
    <div className="relative flex h-screen overflow-hidden">
      {navOpen && (
        <div
          className="fixed inset-0 z-30 bg-black/50 lg:hidden"
          onClick={() => setNavOpen(false)}
          aria-hidden
        />
      )}
      <Sidebar pathname={pathname} open={navOpen} onClose={() => setNavOpen(false)} identity={id} />
      <div className="relative z-0 flex min-w-0 flex-1 flex-col">
        <Topbar
          title={title}
          subtitle={subtitle}
          onMenu={() => setNavOpen(true)}
          onAskEarn={() => setDockOpen((v) => !v)}
          identity={id}
        />
        <main className="flex-1 overflow-y-auto px-5 pb-20 pt-6 sm:px-7">
          {/* Keyed by route so content gently rises in on each navigation —
              a subtle page-enter that respects prefers-reduced-motion. */}
          <div key={pathname} className="fx-rise mx-auto max-w-[1180px]">
            {children}
          </div>
        </main>
      </div>

      {/* Shell-level systems: Earn orb + Earn dock, and the Chain-of-Trust
          toast layer + drawer. Present on every authenticated screen. */}
      <EarnOrb open={dockOpen} onToggle={() => setDockOpen((v) => !v)} />
      <EarnDock open={dockOpen} onClose={() => setDockOpen(false)} />
      <TrustToaster />
    </div>
  );
}

export default AppShell;
