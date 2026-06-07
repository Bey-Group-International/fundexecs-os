'use client';

import { useState, type ReactNode } from 'react';
import { usePathname } from 'next/navigation';
import type { ShellIdentity } from '@/lib/queries/identity';
import type { CreditWallet } from '@/lib/queries/credit-wallet';
import { Wave1SideRail, type NavSignals } from './Wave1SideRail';
import { Wave1TopNav } from './Wave1TopNav';
import { EarnOrb } from './earn/EarnOrb';
import { EarnDock } from './earn/EarnDock';
import { EarnContextProvider } from './earn/EarnContext';
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
  xp: 0,
  unreadCount: 0
};

export interface AppShellProps {
  title: string;
  subtitle?: string;
  /** Signed-in identity for the rail + top nav. Falls back to a generic
   *  identity (never a fabricated name) when omitted. */
  identity?: ShellIdentity | null;
  /** Credit-wallet payload from `getCreditWallet(orgId)`. When omitted, the
   *  top-nav fuel-gauge renders the same clean stub it does for
   *  `configured: false`. */
  wallet?: CreditWallet | null;
  /** Live signals for the side rail (current lifecycle stage + per-item
   *  badges). When omitted the rail renders without badges. */
  navSignals?: NavSignals;
  /** Optional compact card the rail renders at the top of the
   *  "Source of Truth" area. Wave-1: typically a `<FundProfileRailSummary>`
   *  resolved on the server in `AuthedShell`. */
  sourceOfTruthSummary?: ReactNode;
  children: ReactNode;
}

/**
 * AppShell — the authenticated workspace shell. Wave 1 composes the
 * canonical `<Wave1SideRail>` (six logic areas + live signal + stage
 * emphasis), the `<Wave1TopNav>` (org context · ⌘K · alerts · Earn coin ·
 * Credit Wallet fuel-gauge), a 1180px content column, and the shell-level
 * Earn + Chain-of-Trust systems. Every visual value sources from the
 * design tokens in `app/globals.css`; no inline hex.
 *
 * Mounts a top-level `<EarnContextProvider>` whose value derives from the
 * route — entity drawers can wrap their content in their own
 * `<EarnContextProvider value={{ kind: 'deal', ... }}>` to override.
 */
export function AppShell({
  title,
  subtitle,
  identity,
  wallet,
  navSignals,
  sourceOfTruthSummary,
  children
}: AppShellProps) {
  const pathname = usePathname();
  const [navOpen, setNavOpen] = useState(false);
  const [dockOpen, setDockOpen] = useState(false);
  const id = identity ?? DEFAULT_IDENTITY;

  return (
    <EarnContextProvider>
      <div className="relative flex h-screen overflow-hidden">
        {navOpen && (
          <div
            className="fixed inset-0 z-30 bg-black/50 lg:hidden"
            onClick={() => setNavOpen(false)}
            aria-hidden
          />
        )}
        <Wave1SideRail
          pathname={pathname}
          open={navOpen}
          onClose={() => setNavOpen(false)}
          identity={id}
          signals={navSignals}
          sourceOfTruthSummary={sourceOfTruthSummary}
        />
        <div className="relative z-0 flex min-w-0 flex-1 flex-col">
          <Wave1TopNav
            title={title}
            subtitle={subtitle}
            identity={id}
            wallet={wallet}
            onMenu={() => setNavOpen(true)}
            onAskEarn={() => setDockOpen((v) => !v)}
          />
          <main className="flex-1 overflow-y-auto px-5 pb-20 pt-6 sm:px-7">
            {/* Keyed by route so content gently rises in on each navigation —
                a subtle page-enter that respects prefers-reduced-motion. */}
            <div key={pathname} className="fx-rise mx-auto max-w-[1180px]">
              {children}
            </div>
          </main>
        </div>

        {/* Shell-level systems — present on every authenticated screen. */}
        <EarnOrb open={dockOpen} onToggle={() => setDockOpen((v) => !v)} />
        <EarnDock open={dockOpen} onClose={() => setDockOpen(false)} />
        <TrustToaster />
      </div>
    </EarnContextProvider>
  );
}

export default AppShell;
