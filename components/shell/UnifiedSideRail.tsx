'use client';

import Link from 'next/link';
import {
  LayoutDashboard,
  TrendingUp,
  Vault,
  Users,
  Plug,
  Target,
  Bell,
  Settings,
  ChevronsUpDown,
  X,
  LogOut,
  type LucideIcon
} from 'lucide-react';
import { Avatar, Badge } from '@/components/ui';
import { createClient } from '@/lib/supabase/client';
import type { ShellIdentity } from '@/lib/queries/identity';
import { cn } from '@/lib/utils';

export interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  /** Static numeric badge — usually omitted; prefer `dynamicBadge`. */
  badge?: number;
  /** Live-data badge slot. Resolved against the current `ShellIdentity`
   *  on render, so the value stays in sync with server-side state. */
  dynamicBadge?: 'unread';
  /** Optional tone for a leading status pill (e.g. NEW for Fund Room). */
  meta?: { label: string; tone?: 'gold' | 'azure' | 'success' };
}

/**
 * Default navigation for the unified side rail. `/lp-room` (Fund Room) sits
 * immediately after Pipeline so capital-formation surfaces cluster together.
 */
export const DEFAULT_NAV: NavItem[] = [
  { href: '/command-center', label: 'Command Center', icon: LayoutDashboard },
  { href: '/pipeline', label: 'Pipeline', icon: TrendingUp },
  {
    href: '/lp-room',
    label: 'Fund Room',
    icon: Vault,
    meta: { label: 'NEW', tone: 'gold' }
  },
  { href: '/connections', label: 'Connections', icon: Users },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/strategy', label: 'Strategy', icon: Target },
  { href: '/notifications', label: 'Notifications', icon: Bell, dynamicBadge: 'unread' },
  { href: '/settings', label: 'Settings', icon: Settings }
];

export interface UnifiedSideRailProps {
  /** Current route, used to resolve the active nav state. */
  pathname: string;
  /** Mobile drawer open state (lg+ ignores this; rail is always visible). */
  open: boolean;
  /** Close handler for the mobile drawer. Also fires after any nav click. */
  onClose: () => void;
  /** Signed-in identity used to populate org switcher + user footer. */
  identity: ShellIdentity;
  /** Override the default nav (e.g. for demo surfaces or tests). */
  nav?: NavItem[];
  /** Optional sign-out override (defaults to Supabase client signOut). */
  onSignOut?: () => void | Promise<void>;
}

/**
 * UnifiedSideRail — the single, canonical 244px side rail used by every
 * authenticated surface. Extracted from the original `AppShell` sidebar so
 * the rail can be reused across the app and future demo surfaces without
 * duplicating chrome or drifting visually.
 *
 * Composition: brand wordmark · org switcher · nav · user footer + sign-out.
 * All visual values come from the design tokens in `app/globals.css`. No
 * inline hex.
 */
export function UnifiedSideRail({
  pathname,
  open,
  onClose,
  identity,
  nav = DEFAULT_NAV,
  onSignOut
}: UnifiedSideRailProps) {
  async function defaultSignOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    window.location.assign('/login');
  }

  async function handleSignOut() {
    if (onSignOut) {
      await onSignOut();
      return;
    }
    await defaultSignOut();
  }

  return (
    <aside
      data-testid="unified-side-rail"
      className={cn(
        'fixed inset-y-0 left-0 z-40 flex h-full w-[244px] flex-none flex-col border-r border-hairline bg-bg-1 transition-transform duration-200 lg:static lg:z-10 lg:translate-x-0',
        open ? 'translate-x-0' : '-translate-x-full'
      )}
    >
      {/* Brand */}
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
          data-testid="side-rail-close-btn"
          className="flex h-7 w-7 items-center justify-center rounded-lg text-fg-4 hover:bg-surface-1 hover:text-fg-1 lg:hidden"
        >
          <X size={16} strokeWidth={1.9} aria-hidden />
        </button>
      </div>

      {/* Org switcher */}
      <div className="px-3 pb-3">
        <button
          type="button"
          data-testid="side-rail-org-switcher"
          className="flex w-full items-center gap-2.5 rounded-[10px] border border-hairline bg-surface-1 px-2.5 py-2 transition-[background,box-shadow] hover:bg-surface-2"
        >
          <Avatar name={identity.orgName} size={26} tone="gold" />
          <div className="flex-1 overflow-hidden text-left">
            <div className="truncate text-[12.5px] font-semibold text-fg-1">
              {identity.orgName}
            </div>
            <div className="truncate text-[10.5px] text-fg-4">{identity.orgTier}</div>
          </div>
          <ChevronsUpDown size={14} strokeWidth={1.9} className="text-fg-4" aria-hidden />
        </button>
      </div>

      {/* Nav */}
      <nav
        className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3"
        data-testid="side-rail-nav"
      >
        <div className="px-3 pb-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
          Workspace
        </div>
        {nav.map((item) => {
          const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
          const Icon = item.icon;
          const badgeValue =
            item.badge ?? (item.dynamicBadge === 'unread' ? identity.unreadCount : undefined);
          const showBadge = badgeValue != null && badgeValue > 0;
          return (
            <Link
              key={item.href}
              href={item.href}
              onClick={onClose}
              aria-current={active ? 'page' : undefined}
              data-testid={`side-rail-link-${item.href.replace(/^\//, '') || 'root'}`}
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
              {item.meta && !showBadge && (
                <Badge tone={item.meta.tone ?? 'gold'} className="px-1.5 py-0.5 text-[9.5px]">
                  {item.meta.label}
                </Badge>
              )}
              {showBadge && (
                <Badge
                  tone="azure"
                  className="px-1.5 py-0.5 text-[10.5px]"
                  data-testid={
                    item.dynamicBadge === 'unread' ? 'sidebar-unread-badge' : undefined
                  }
                >
                  {badgeValue}
                </Badge>
              )}
            </Link>
          );
        })}
      </nav>

      {/* User footer */}
      <div
        className="m-3 flex items-center gap-2.5 rounded-[10px] border border-hairline px-2.5 py-2.5"
        data-testid="side-rail-user-footer"
      >
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
          onClick={handleSignOut}
          aria-label="Sign out"
          title="Sign out"
          data-testid="side-rail-signout-btn"
          className="flex h-7 w-7 flex-none items-center justify-center rounded-lg text-fg-4 transition-[background,box-shadow] hover:bg-surface-1 hover:text-fg-1"
        >
          <LogOut size={15} strokeWidth={1.9} aria-hidden />
        </button>
      </div>
    </aside>
  );
}

export default UnifiedSideRail;
