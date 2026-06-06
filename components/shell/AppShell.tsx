'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import { Bell, Search, Sun, Moon, Menu } from 'lucide-react';
import { Avatar, AnimatedNumber } from '@/components/ui';
import { EarnCoin } from '@/components/screens/EarnCoin';
import type { ShellIdentity } from '@/lib/queries/identity';
import { UnifiedSideRail } from './UnifiedSideRail';
import { EarnOrb } from './earn/EarnOrb';
import { EarnDock } from './earn/EarnDock';
import { TrustToaster } from './trust/TrustToaster';

/** Generic fallback when no signed-in identity is supplied (e.g. SSR before
 *  auth resolves). Never shows a fabricated person's name. */
const DEFAULT_IDENTITY: ShellIdentity = {
  name: 'Your account',
  role: 'Operator',
  email: null,
  orgName: 'Your fund',
  orgTier: 'Emerging manager',
  level: 1,
  xp: 0
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
        <kbd
          aria-hidden="true"
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-hairline px-1.5 py-px font-mono text-[10px] text-fg-5"
        >
          ⌘K
        </kbd>
      </div>

      <ThemeToggle />

      {/* Gold Earn coin wallet (gamification) — opens the Earn dock */}
      <button
        type="button"
        onClick={onAskEarn}
        aria-label="Ask Earn"
        data-testid="topbar-earn-wallet"
        className="hidden items-center gap-2 rounded-[10px] border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2.5 py-1 transition-[background,box-shadow] hover:bg-[var(--gold-soft)] hover:brightness-110 sm:flex"
      >
        <EarnCoin size={22} />
        <div className="leading-none">
          <AnimatedNumber
            value={identity.xp}
            className="block text-[12.5px] font-semibold text-gold-1"
          />
          <div
            aria-hidden="true"
            className="text-[8px] font-semibold uppercase tracking-[0.11em] text-fg-5"
          >
            Earn coins
          </div>
        </div>
      </button>

      <button
        type="button"
        aria-label="Notifications"
        className="relative flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] border border-hairline bg-surface-1 text-fg-3 transition-[background,box-shadow] hover:bg-surface-2 hover:text-fg-1"
        data-testid="topbar-notifications-bell"
      >
        <Bell size={17} strokeWidth={1.9} aria-hidden />
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
 * AppShell — the authenticated workspace shell. Composes the canonical
 * `<UnifiedSideRail>` (single side-rail used by every authenticated surface),
 * a sticky topbar, a 1180px content column, and the shell-level Earn +
 * Chain-of-Trust systems. The side rail was extracted from this file so it
 * can be reused across demo / preview surfaces without duplicating chrome.
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
      <UnifiedSideRail
        pathname={pathname}
        open={navOpen}
        onClose={() => setNavOpen(false)}
        identity={id}
      />
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
