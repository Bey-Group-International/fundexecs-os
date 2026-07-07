"use client";

import { useState } from "react";
import { MobileBottomNav } from "./MobileBottomNav";
import { MobileQuickAction } from "./MobileQuickAction";
import { MobileMoreMenu } from "./MobileMoreMenu";
import { PlusIcon } from "./icons";

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

  return (
    <div className="md:hidden print:hidden">
      {/* Floating persistent quick-action button — one tap to move work. */}
      <button
        type="button"
        onClick={() => {
          setMoreOpen(false);
          setQuickOpen(true);
        }}
        aria-label="Quick actions"
        className="fx-fab fx-tap fixed bottom-[calc(4.75rem+env(safe-area-inset-bottom,0px))] right-4 z-40 flex h-14 w-14 items-center justify-center rounded-full border border-gold-300/40 bg-gradient-to-br from-gold-300 to-gold-500 text-surface-0 transition active:scale-95"
      >
        <PlusIcon width={26} height={26} strokeWidth={2.2} />
      </button>

      <MobileBottomNav
        approvalsCount={approvalsCount}
        moreOpen={moreOpen}
        onMore={() => {
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
