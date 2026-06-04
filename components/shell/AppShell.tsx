'use client';

import { type ReactNode } from 'react';
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
  Sparkles,
  ChevronsUpDown,
  type LucideIcon
} from 'lucide-react';
import { Avatar, Badge, Button } from '@/components/ui';
import { cn } from '@/lib/utils';

interface NavItem {
  href: string;
  label: string;
  icon: LucideIcon;
  badge?: number;
}

const NAV: NavItem[] = [
  { href: '/command-center', label: 'Command Center', icon: LayoutDashboard },
  { href: '/pipeline', label: 'Pipeline', icon: TrendingUp },
  { href: '/connections', label: 'Connections', icon: Users },
  { href: '/integrations', label: 'Integrations', icon: Plug },
  { href: '/strategy', label: 'Strategy', icon: Target },
  { href: '/notifications', label: 'Notifications', icon: Bell, badge: 3 }
];

const USER = {
  name: 'Avery Sloane',
  role: 'Managing Partner',
  org: 'Northwind Capital',
  tier: 'Emerging manager',
  xp: 4820
};

function SidebarNav({ pathname }: { pathname: string }) {
  return (
    <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3">
      <div className="px-3 pb-1.5 pt-2 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
        Workspace
      </div>
      {NAV.map((item) => {
        const active = pathname === item.href || pathname.startsWith(`${item.href}/`);
        const Icon = item.icon;
        return (
          <Link
            key={item.href}
            href={item.href}
            aria-current={active ? 'page' : undefined}
            className={cn(
              'relative flex items-center gap-3 rounded-[10px] px-3 py-2.5 text-[13.5px] font-medium transition',
              active
                ? 'bg-gradient-to-r from-[var(--azure-soft)] to-surface-1 text-fg-1'
                : 'text-fg-3 hover:bg-surface-1 hover:text-fg-2'
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
            {item.badge != null && (
              <Badge tone="azure" className="px-1.5 py-0.5 text-[10.5px]">
                {item.badge}
              </Badge>
            )}
          </Link>
        );
      })}
    </nav>
  );
}

function Sidebar({ pathname }: { pathname: string }) {
  return (
    <aside className="relative z-10 flex h-full w-[244px] flex-none flex-col border-r border-hairline bg-bg-1">
      <div className="flex items-center gap-2.5 px-[18px] pb-4 pt-[18px]">
        <span className="inline-flex h-[30px] w-[30px] flex-none items-center justify-center rounded-lg bg-gradient-to-br from-gold-1 to-gold-2 text-[15px] font-bold text-[#070b14]">
          F
        </span>
        <div className="text-base font-semibold tracking-[-0.02em]">
          FundExecs <span className="font-medium text-fg-4">OS</span>
        </div>
      </div>

      <div className="px-3 pb-3">
        <button
          type="button"
          className="flex w-full items-center gap-2.5 rounded-[10px] border border-hairline bg-surface-1 px-2.5 py-2 transition hover:bg-surface-2"
        >
          <Avatar name={USER.org} size={26} tone="gold" />
          <div className="flex-1 overflow-hidden text-left">
            <div className="truncate text-[12.5px] font-semibold text-fg-1">{USER.org}</div>
            <div className="text-[10.5px] text-fg-4">{USER.tier}</div>
          </div>
          <ChevronsUpDown size={14} strokeWidth={1.9} className="text-fg-4" aria-hidden />
        </button>
      </div>

      <SidebarNav pathname={pathname} />

      <button
        type="button"
        className="m-3 flex items-center gap-2.5 rounded-[10px] border border-hairline px-2.5 py-2.5 text-left transition hover:bg-surface-1"
      >
        <Avatar name={USER.name} size={30} />
        <div className="flex-1 overflow-hidden">
          <div className="truncate text-[12.5px] font-semibold text-fg-1">{USER.name}</div>
          <div className="truncate text-[10.5px] text-fg-4">{USER.role}</div>
        </div>
        <Badge tone="gold" className="px-1.5 py-0.5 text-[10px]">
          L7
        </Badge>
      </button>
    </aside>
  );
}

function Topbar({ title, subtitle }: { title: string; subtitle?: string }) {
  return (
    <header className="sticky top-0 z-20 flex h-[60px] flex-none items-center gap-4 border-b border-hairline bg-[var(--topbar-bg)] px-6 backdrop-blur-md">
      <div className="min-w-0 flex-1">
        <div className="text-[15px] font-semibold tracking-[-0.015em] text-fg-1">{title}</div>
        {subtitle && <div className="text-xs text-fg-4">{subtitle}</div>}
      </div>

      <div className="relative hidden max-w-[320px] flex-[0_1_320px] sm:block">
        <span className="pointer-events-none absolute left-3 top-1/2 -translate-y-1/2 text-fg-5">
          <Search size={15} strokeWidth={1.9} aria-hidden />
        </span>
        <input
          type="search"
          placeholder="Search deals, LPs, partners…"
          className="w-full rounded-[10px] border border-hairline bg-surface-1 py-2 pl-9 pr-12 text-[13px] text-fg-1 outline-none transition placeholder:text-fg-4 focus:border-[var(--accent-line)]"
        />
        <kbd className="pointer-events-none absolute right-2.5 top-1/2 -translate-y-1/2 rounded border border-hairline px-1.5 py-px font-mono text-[10px] text-fg-5">
          ⌘K
        </kbd>
      </div>

      <Button variant="gold" size="sm" icon={Sparkles}>
        Ask Earn
      </Button>

      <button
        type="button"
        aria-label="Notifications"
        className="relative flex h-[38px] w-[38px] flex-none items-center justify-center rounded-[10px] border border-hairline bg-surface-1 text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
      >
        <Bell size={17} strokeWidth={1.9} aria-hidden />
        <span className="absolute -right-1.5 -top-1.5 flex h-4 min-w-4 items-center justify-center rounded-full border-2 border-bg-0 bg-azure-1 px-1 text-[10px] font-bold text-white">
          3
        </span>
      </button>

      <Avatar name={USER.name} size={32} />
    </header>
  );
}

export interface AppShellProps {
  title: string;
  subtitle?: string;
  children: ReactNode;
}

/**
 * AppShell — the authenticated workspace shell: left sidebar nav, a sticky top
 * bar (search + Ask Earn + notifications + avatar) and a scrolling content slot.
 * Presentational; nav state is derived from the current route.
 */
export function AppShell({ title, subtitle, children }: AppShellProps) {
  const pathname = usePathname();
  return (
    <div className="relative flex h-screen overflow-hidden">
      <Sidebar pathname={pathname} />
      <div className="relative z-0 flex min-w-0 flex-1 flex-col">
        <Topbar title={title} subtitle={subtitle} />
        <main className="flex-1 overflow-y-auto px-7 pb-20 pt-6">
          <div className="mx-auto max-w-[1180px]">{children}</div>
        </main>
      </div>
    </div>
  );
}

export default AppShell;
