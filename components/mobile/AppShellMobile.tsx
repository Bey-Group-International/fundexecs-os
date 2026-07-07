"use client";

import { useState } from "react";
import { usePathname } from "next/navigation";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileQuickAction } from "./MobileQuickAction";
import { MobileMoreMenu } from "./MobileMoreMenu";
import { PlusIcon } from "./icons";
import { useHideOnScroll } from "./useHideOnScroll";
import { haptic } from "./haptics";
import { OfflineBanner } from "./OfflineBanner";
import { MobileSyncRegistrar } from "./MobileSyncRegistrar";

// The mobile app shell: the persistent chrome that turns the responsive web
// app into an app-native experience on phones. Renders the bottom tab bar, the
// floating quick-action FAB, and the slide-up drawers. Every element is
// `md:hidden` — desktop and web layouts are entirely unaffected.
export function AppShellMobile({
  name,
  planName,
  approvalsCount = 0,
  signOutAction,
}: {
  name: string;
  planName: string;
  approvalsCount?: number;
  signOutAction: () => void | Promise<void>;
}) {
  const [quickOpen, setQuickOpen] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  // Content-first: the nav + FAB slide out of the way while reading (scroll
  // down) and return the moment the user scrolls up. A sheet being open pins
  // the chrome visible so it never vanishes mid-interaction.
  const scrolledAway = useHideOnScroll();
  const hidden = scrolledAway && !quickOpen && !moreOpen;
  // The Earn conversation home (/home) owns the bottom-right with its own
  // "Message Earn" composer, so the quick-action FAB is suppressed there to
  // avoid two stacked controls; it returns on every other screen.
  const pathname = usePathname() || "/";
  const fabSuppressed = pathname === "/home";

  return (
    <div className="md:hidden print:hidden">
      {/* Registers offline-queue executors app-wide so queued actions flush on
          reconnect regardless of the current screen. Renders nothing. */}
      <MobileSyncRegistrar />

      {/* Connectivity + pending-sync notice for on-the-go dead zones. */}
      <OfflineBanner />

      {/* Floating persistent quick-action button — one tap to move work. */}
      {!fabSuppressed && (
        <button
          type="button"
          onClick={() => {
            haptic("select");
            setMoreOpen(false);
            setQuickOpen(true);
          }}
          aria-label="Quick actions"
          aria-hidden={hidden}
          tabIndex={hidden ? -1 : 0}
          className={`fx-fab fx-tap fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-gold-300/40 bg-gradient-to-br from-gold-300 to-gold-500 text-surface-0 transition-all duration-300 active:scale-95 ${
            hidden ? "pointer-events-none translate-y-[140%] opacity-0" : "translate-y-0 opacity-100"
          }`}
        >
          <PlusIcon width={26} height={26} strokeWidth={2.2} />
        </button>
      )}

      <MobileBottomNav
        approvalsCount={approvalsCount}
        moreOpen={moreOpen}
        hidden={hidden}
        onMore={() => {
          haptic("select");
          setQuickOpen(false);
          setMoreOpen(true);
        }}
      />

      <MobileQuickAction open={quickOpen} onClose={() => setQuickOpen(false)} />
      <MobileMoreMenu
        open={moreOpen}
        onClose={() => setMoreOpen(false)}
        name={name}
        planName={planName}
        signOutAction={signOutAction}
      />
    </div>
  );
}
