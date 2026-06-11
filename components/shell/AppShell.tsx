'use client';

import { useState } from 'react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { Award, Bell, LayoutDashboard, LogOut, Settings, Sparkles } from 'lucide-react';
import { EarnDock } from '@/components/earn/EarnDock';
import { Badge } from '@/components/ui/Badge';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { MandateIcon } from '@/components/ui/MandateIcon';
import { ProgressBar } from '@/components/ui/ProgressBar';
import type { HubId } from '@/lib/hubs/lifecycle';
import { cn } from '@/lib/utils';

/** One lifecycle hub as the shell renders it (serializable — icons by name). */
export interface ShellHub {
  id: HubId;
  label: string;
  tag: string;
  icon: string;
  href: string;
  /** 0–100 readiness. */
  pct: number;
  /** The hub's modules, shown under the active rail entry. */
  modules: { label: string; icon: string }[];
}

export interface AppShellProps {
  firm: string;
  /** Secondary line under the firm name (e.g. "$500M target"). */
  firmSub: string;
  principal: string;
  /** Secondary line under the principal (e.g. "Level 2 · Operator"). */
  principalSub: string;
  level: number;
  /** Unread notifications for the bell badge. */
  unreadCount: number;
  hubs: ShellHub[];
  /** The operator's center-of-gravity hub (the rail's NOW marker). */
  center: HubId;
  /** Server action: signs out and redirects. */
  signOut: () => Promise<void>;
  children: React.ReactNode;
}

function initials(name: string): string {
  return (
    name
      .trim()
      .split(/\s+/)
      .slice(0, 2)
      .map((w) => w[0]?.toUpperCase() ?? '')
      .join('') || '·'
  );
}

function NowMark() {
  return (
    <span className="inline-flex items-center gap-1 text-[9px] font-bold tracking-[0.06em] text-gold-1">
      <span className="fx-glow-pulse h-[5px] w-[5px] rounded-full bg-gold-1" aria-hidden />
      NOW
    </span>
  );
}

/**
 * The lifecycle shell — the prototype's Command Center chrome, shared by the
 * cockpit and the four verb hubs. Desktop: left rail (brand, firm, Command
 * Center + Build/Source/Run/Execute with live readiness, utilities, user
 * footer) + topbar. Mobile: sticky header + a five-tab bottom bar with the
 * same readiness state.
 */
export function AppShell({
  firm,
  firmSub,
  principal,
  principalSub,
  level,
  unreadCount,
  hubs,
  center,
  signOut,
  children
}: AppShellProps) {
  const pathname = usePathname();
  const [earnOpen, setEarnOpen] = useState(false);
  const activeHub = hubs.find((h) => pathname.startsWith(h.href));
  const isHome = !activeHub;
  const title = activeHub?.label ?? 'Command Center';

  return (
    <div className="flex min-h-dvh bg-bg-0 text-fg-1">
      {/* ── desktop rail ─────────────────────────────────────────────── */}
      <aside className="sticky top-0 hidden h-dvh w-[232px] flex-none flex-col border-r border-hairline bg-bg-1 lg:flex">
        <div className="flex items-center gap-2.5 px-4 pb-3.5 pt-[18px]">
          <EarnCoin size={28} />
          <span className="text-[15px] font-semibold tracking-[-0.02em]">
            FundExecs <span className="font-medium text-fg-4">OS</span>
          </span>
          <Badge tone="azure" className="ml-auto px-1.5 py-0 text-[9px]">
            Beta
          </Badge>
        </div>

        <div className="px-3 pb-3">
          <div className="flex items-center gap-2.5 rounded-[10px] border border-hairline bg-surface-1 px-2.5 py-2">
            <span className="flex h-[26px] w-[26px] flex-none items-center justify-center rounded-lg border border-[var(--gold-line)] bg-[var(--gold-soft)] text-[10px] font-bold text-gold-1">
              {initials(firm)}
            </span>
            <div className="min-w-0">
              <div className="truncate text-[12.5px] font-semibold">{firm}</div>
              <div className="truncate text-[10.5px] text-fg-4">{firmSub}</div>
            </div>
          </div>
        </div>

        <nav className="flex flex-1 flex-col gap-0.5 overflow-y-auto px-3" aria-label="Lifecycle">
          <Link
            href="/command-center"
            className={cn(
              'flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13.5px] font-medium transition',
              isHome
                ? 'bg-[linear-gradient(90deg,var(--accent-soft),var(--surface-1))] text-fg-1'
                : 'text-fg-3 hover:bg-surface-1 hover:text-fg-1'
            )}
            aria-current={isHome ? 'page' : undefined}
          >
            <LayoutDashboard size={17} strokeWidth={1.9} aria-hidden />
            Command Center
          </Link>

          <div className="px-2.5 pb-1.5 pt-3 text-[10.5px] font-semibold uppercase tracking-[0.11em] text-fg-4">
            Lifecycle
          </div>
          {hubs.map((hub) => {
            const on = activeHub?.id === hub.id;
            return (
              <div key={hub.id}>
                <Link
                  href={hub.href}
                  className={cn(
                    'flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13.5px] font-medium transition',
                    on
                      ? 'bg-[linear-gradient(90deg,var(--accent-soft),var(--surface-1))] text-fg-1'
                      : 'text-fg-3 hover:bg-surface-1 hover:text-fg-1'
                  )}
                  aria-current={on ? 'page' : undefined}
                >
                  <MandateIcon name={hub.icon} size={17} strokeWidth={1.9} aria-hidden />
                  <span className="flex-1">{hub.label}</span>
                  {center === hub.id && <NowMark />}
                  <span className="text-[10.5px] text-fg-5 [font-feature-settings:'tnum']">
                    {hub.pct}%
                  </span>
                </Link>
                <div className="pl-10 pr-2.5 pt-0.5">
                  <ProgressBar value={hub.pct} height={3} tone={on ? 'accent' : 'neutral'} />
                </div>
                {on && (
                  <div className="flex flex-col gap-0.5 pb-2 pl-10 pt-1.5">
                    {hub.modules.map((mod) => (
                      <span
                        key={mod.label}
                        className="flex items-center gap-2 py-1 text-[12px] text-fg-4"
                      >
                        <MandateIcon name={mod.icon} size={13} strokeWidth={1.9} aria-hidden />
                        {mod.label}
                      </span>
                    ))}
                  </div>
                )}
              </div>
            );
          })}

          <div className="mx-1 my-3 h-px bg-[var(--border)]" aria-hidden />
          <button
            type="button"
            onClick={() => setEarnOpen(true)}
            className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-left text-[13.5px] font-medium text-fg-3 transition hover:bg-surface-1 hover:text-fg-1"
          >
            <Sparkles size={17} strokeWidth={1.9} className="text-gold-1" aria-hidden />
            <span className="flex-1">Ask Earn</span>
          </button>
          <Link
            href="/notifications"
            className={cn(
              'flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13.5px] font-medium transition',
              pathname.startsWith('/notifications')
                ? 'bg-[linear-gradient(90deg,var(--accent-soft),var(--surface-1))] text-fg-1'
                : 'text-fg-3 hover:bg-surface-1 hover:text-fg-1'
            )}
            aria-current={pathname.startsWith('/notifications') ? 'page' : undefined}
          >
            <Bell size={17} strokeWidth={1.9} aria-hidden />
            <span className="flex-1">Notifications</span>
            {unreadCount > 0 && (
              <span className="flex h-[18px] min-w-[18px] items-center justify-center rounded-full bg-accent px-1 text-[10px] font-bold text-white [font-feature-settings:'tnum']">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Link>
          <span className="flex items-center gap-2.5 rounded-[10px] px-2.5 py-2 text-[13.5px] font-medium text-fg-5">
            <Settings size={17} strokeWidth={1.9} aria-hidden />
            <span className="flex-1">Settings</span>
            <span className="text-[9.5px] font-semibold uppercase tracking-[0.08em] text-fg-5">
              Soon
            </span>
          </span>
        </nav>

        <div className="m-3 flex items-center gap-2.5 rounded-xl border border-hairline bg-surface-1 px-3 py-2.5">
          <span className="flex h-[30px] w-[30px] flex-none items-center justify-center rounded-full border border-[var(--azure-line)] bg-[var(--azure-soft)] text-[11px] font-bold text-azure-1">
            {initials(principal)}
          </span>
          <div className="min-w-0 flex-1">
            <div className="truncate text-[12.5px] font-semibold">{principal}</div>
            <div className="truncate text-[10.5px] text-fg-4">{principalSub}</div>
          </div>
          <form action={signOut}>
            <button
              type="submit"
              title="Sign out"
              aria-label="Sign out"
              className="flex h-7 w-7 items-center justify-center rounded-lg border border-hairline text-fg-4 transition hover:bg-surface-2 hover:text-fg-1"
            >
              <LogOut size={13} aria-hidden />
            </button>
          </form>
        </div>
      </aside>

      {/* ── main column ──────────────────────────────────────────────── */}
      <div className="flex min-w-0 flex-1 flex-col">
        {/* desktop topbar */}
        <header className="sticky top-0 z-20 hidden h-[60px] flex-none items-center gap-4 border-b border-hairline bg-[var(--topbar-bg)] px-6 backdrop-blur lg:flex">
          <div className="min-w-0">
            <div className="text-[15px] font-semibold tracking-[-0.01em]">{title}</div>
            <div className="mt-0.5 truncate text-[12px] text-fg-4">
              {activeHub
                ? `${activeHub.tag} · the team works, you approve`
                : 'You set the mandate · the team works · you approve'}
            </div>
          </div>
          <span className="flex-1" />
          <Link
            href="/notifications"
            aria-label={unreadCount > 0 ? `Notifications (${unreadCount} unread)` : 'Notifications'}
            className="relative flex h-9 w-9 items-center justify-center rounded-xl border border-hairline bg-surface-1 text-fg-3 transition hover:bg-surface-2 hover:text-fg-1"
          >
            <Bell size={16} strokeWidth={1.9} aria-hidden />
            {unreadCount > 0 && (
              <span className="absolute -right-1 -top-1 flex h-[16px] min-w-[16px] items-center justify-center rounded-full bg-accent px-1 text-[9px] font-bold text-white">
                {unreadCount > 9 ? '9+' : unreadCount}
              </span>
            )}
          </Link>
          <button
            type="button"
            onClick={() => setEarnOpen(true)}
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3 py-1.5 text-[12.5px] font-semibold text-gold-1 transition hover:brightness-110"
          >
            <Sparkles size={14} aria-hidden />
            Ask Earn
          </button>
          <span className="inline-flex items-center gap-1.5 rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] px-3 py-1 text-[12.5px] font-semibold text-gold-1">
            <Award size={14} aria-hidden />
            Level {level}
          </span>
        </header>

        {/* mobile header */}
        <header className="sticky top-0 z-20 flex items-center gap-2.5 border-b border-hairline bg-[var(--topbar-bg)] px-4 py-3 backdrop-blur lg:hidden">
          <EarnCoin size={26} />
          <div className="min-w-0 flex-1">
            <div className="text-[14px] font-semibold">{title}</div>
            <div className="truncate text-[10.5px] text-fg-4">{firm}</div>
          </div>
          <span className="inline-flex items-center gap-1 rounded-full border border-[var(--gold-line)] bg-[var(--gold-soft)] px-2 py-0.5 text-[11px] font-semibold text-gold-1">
            <Award size={12} aria-hidden />L{level}
          </span>
        </header>

        <main className="flex-1 px-[clamp(16px,3vw,26px)] pb-24 pt-6 lg:pb-14">
          <div className="mx-auto max-w-[1080px]">{children}</div>
        </main>

        {/* mobile bottom bar */}
        <nav
          className="fixed inset-x-0 bottom-0 z-20 flex border-t border-hairline bg-[var(--topbar-bg)] backdrop-blur lg:hidden"
          aria-label="Lifecycle"
        >
          <Link
            href="/command-center"
            className={cn(
              'flex flex-1 flex-col items-center gap-0.5 pb-2.5 pt-2 text-[9.5px] font-medium',
              isHome ? 'text-fg-1' : 'text-fg-5'
            )}
            aria-current={isHome ? 'page' : undefined}
          >
            <LayoutDashboard size={18} strokeWidth={1.9} aria-hidden />
            Home
          </Link>
          {hubs.map((hub) => {
            const on = activeHub?.id === hub.id;
            return (
              <Link
                key={hub.id}
                href={hub.href}
                className={cn(
                  'flex flex-1 flex-col items-center gap-0.5 pb-2.5 pt-2 text-[9.5px] font-medium',
                  on ? 'text-fg-1' : 'text-fg-5'
                )}
                aria-current={on ? 'page' : undefined}
              >
                <MandateIcon name={hub.icon} size={18} strokeWidth={1.9} aria-hidden />
                {hub.label}
              </Link>
            );
          })}
        </nav>
      </div>

      <EarnDock open={earnOpen} onClose={() => setEarnOpen(false)} />
    </div>
  );
}
