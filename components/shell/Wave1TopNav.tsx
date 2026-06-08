'use client';

import { useEffect, useRef } from 'react';
import { useRouter } from 'next/navigation';
import { Search, Sun, Moon, Menu } from 'lucide-react';
import type { ShellIdentity } from '@/lib/queries/identity';
import type { CreditWallet } from '@/lib/queries/credit-wallet';
import { CreditWalletGauge } from './CreditWalletGauge';
import { NotificationsBell } from './NotificationsBell';
import { TopNavAccountMenu } from './account/TopNavAccountMenu';

/** Topbar theme toggle — flips `data-theme`, persists to localStorage('fx-theme').
 *  Icon is driven by `data-theme` via CSS (no React state) so there's no
 *  hydration mismatch. */
function ThemeToggle() {
  function toggle() {
    const root = document.documentElement;
    root.classList.add('fx-no-transition');
    const isLight = root.getAttribute('data-theme') === 'light';
    if (isLight) root.removeAttribute('data-theme');
    else root.setAttribute('data-theme', 'light');
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
      data-testid="topnav-theme-toggle"
      className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] border border-hairline bg-surface-1 text-fg-3 transition-[background,box-shadow] hover:bg-surface-2 hover:text-fg-1 focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-gold-1"
    >
      <Sun size={17} strokeWidth={1.9} className="fx-icon-sun" aria-hidden />
      <Moon size={17} strokeWidth={1.9} className="fx-icon-moon" aria-hidden />
    </button>
  );
}

export interface Wave1TopNavProps {
  title: string;
  subtitle?: string;
  identity: ShellIdentity;
  /** Mobile menu trigger handler (opens the side-rail drawer). */
  onMenu: () => void;
  /** Earn-coins wallet payload — when omitted the gauge self-fetches; when
   *  `configured:false` it renders the clean stub. */
  wallet?: CreditWallet | null;
}

/**
 * Wave1TopNav — the global control bar: org context (title / subtitle relayed
 * by the page), **⌘K command/search**, theme toggle, the **Earn-coins wallet**
 * (the platform's AI credits, one proprietary module with inline top-up), the
 * alerts bell, and the profile avatar (→ account menu).
 *
 * Earn coins ARE the credits — there is a single wallet here, not a separate
 * gamification coin. XP / level / streak live on the dashboard and the
 * side-rail account footer. Color discipline: gold stays on the Earn wallet.
 */
export function Wave1TopNav({ title, subtitle, identity, onMenu, wallet }: Wave1TopNavProps) {
  const searchRef = useRef<HTMLInputElement>(null);
  const router = useRouter();

  // ⌘K / Ctrl-K focuses the search box (placeholder command-palette entry).
  useEffect(() => {
    function handler(e: KeyboardEvent) {
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        searchRef.current?.focus();
      }
    }
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, []);

  // Enter fires the search at /connections?q=… (ConnectionsView seeds its
  // in-page filter from that query); Escape clears the box and blurs. Without
  // this the box only focused on ⌘K and never went anywhere.
  function onSearchKeyDown(e: React.KeyboardEvent<HTMLInputElement>) {
    if (e.key === 'Enter') {
      const q = e.currentTarget.value.trim();
      if (!q) return;
      e.preventDefault();
      searchRef.current?.blur();
      router.push(`/connections?q=${encodeURIComponent(q)}`);
    } else if (e.key === 'Escape') {
      e.currentTarget.value = '';
      searchRef.current?.blur();
    }
  }

  return (
    <header
      data-testid="wave1-top-nav"
      className="sticky top-0 z-20 flex h-[60px] flex-none items-center gap-3 border-b border-hairline bg-[var(--topbar-bg)] px-4 backdrop-blur-md sm:px-6"
    >
      <button
        type="button"
        onClick={onMenu}
        aria-label="Open menu"
        data-testid="topnav-menu-btn"
        className="flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] border border-hairline bg-surface-1 text-fg-3 hover:bg-surface-2 lg:hidden"
      >
        <Menu size={18} strokeWidth={1.9} aria-hidden />
      </button>

      <div className="min-w-0 flex-1">
        <div className="truncate text-[15px] font-semibold tracking-[-0.015em] text-fg-1">
          {title}
        </div>
        {subtitle ? <div className="truncate text-xs text-fg-4">{subtitle}</div> : null}
      </div>

      {/* ⌘K command / search — hidden until lg so the title/subtitle keep room
          on mid-width screens (it was squashing "Command Center" next to it). */}
      <div className="relative hidden min-w-0 max-w-[300px] flex-[0_1_300px] lg:block">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-5">
          <Search size={15} strokeWidth={1.9} aria-hidden />
        </span>
        <input
          ref={searchRef}
          type="search"
          placeholder="Jump to deal, LP, or agent action…"
          aria-label="Command and search"
          onKeyDown={onSearchKeyDown}
          data-testid="topnav-search-input"
          className="w-full rounded-[10px] border border-hairline bg-surface-1 py-2 pl-9 pr-12 text-[13px] text-fg-1 outline-none transition-[border-color] placeholder:text-fg-4 focus:border-[var(--accent-line)]"
        />
        <kbd
          aria-hidden
          className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-hairline px-1.5 py-px font-mono text-[10px] text-fg-5"
        >
          ⌘K
        </kbd>
      </div>

      <ThemeToggle />

      {/* Earn-coins wallet — the single proprietary credits module (Earn coins
          are the platform's AI credits). XP/level lives in the dashboard +
          side-rail, so there's no separate gamification pill here anymore. */}
      <CreditWalletGauge wallet={wallet} />

      {/* Alerts bell — opens a dropdown of recent notifications (not a page jump) */}
      <NotificationsBell initialUnread={identity.unreadCount} />

      {/* Profile avatar → account menu (Settings, workspace switch, log out) */}
      <TopNavAccountMenu identity={identity} />
    </header>
  );
}

export default Wave1TopNav;
