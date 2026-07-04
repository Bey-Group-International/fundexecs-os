"use client";

import { useMobileNav } from "@/components/nav/mobile-nav";

// Hamburger button for the slide-over sidebar (components/AppSidebar.tsx),
// rendered in both header variants (GlobalTopBar / SessionCommandBar) since
// exactly one of them is ever mounted at a time.
export function MobileNavToggle() {
  const { open, toggle } = useMobileNav();
  return (
    <button
      type="button"
      onClick={toggle}
      aria-label={open ? "Close navigation" : "Open navigation"}
      aria-expanded={open}
      aria-controls="fx-mobile-nav"
      className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md border border-line text-fg-secondary transition hover:border-gold-500/40 hover:text-fg-primary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold-400 md:hidden"
    >
      <span aria-hidden className="text-sm leading-none">☰</span>
    </button>
  );
}
