"use client";

// Implements the native mobile "re-tap the active tab to scroll to top"
// affordance. On iOS and Android, tapping the bottom-nav tab you're already on
// snaps the current screen back to the top of its content. It's a small thing
// that matters a lot on the go: a long conversation thread, an activity feed,
// or a deals list can be scrolled far down, and this gives the user one tap to
// return to the top without a tedious drag — thumb already on the tab bar.
//
// The returned handler is meant to be wired to the bottom nav's tab taps
// (alongside the normal Link navigation). It only does something when the
// tapped destination is the route you're already on; for any other tab it's a
// no-op so the regular navigation proceeds untouched.
//
// Two courtesies:
//  - It only buzzes and scrolls when there's actually somewhere to scroll
//    (window.scrollY > 0), so a re-tap while already at the top does nothing
//    rather than firing a pointless haptic.
//  - It respects prefers-reduced-motion: users who quiet motion get an instant
//    ("auto") jump instead of a smooth animated scroll.
//
// SSR-safe: all window access is guarded, and the hook only touches the DOM
// inside the event handler (which never runs on the server).
import { useCallback } from "react";
import { usePathname } from "next/navigation";
import { haptic } from "./haptics";

// Drop a single trailing slash so "/home" and "/home/" compare equal. Kept
// deliberately simple — the root "/" is left as-is.
function normalize(path: string): string {
  return path.length > 1 && path.endsWith("/") ? path.slice(0, -1) : path;
}

export function useTabReselect(): (href: string) => void {
  const pathname = usePathname();

  return useCallback(
    (href: string) => {
      // Only act when the tapped tab is the route we're already on.
      if (normalize(href) !== normalize(pathname)) return;
      if (typeof window === "undefined") return;
      // Nothing to scroll back to — don't buzz pointlessly.
      if (window.scrollY <= 0) return;

      haptic("tap");

      const reduce = window.matchMedia?.("(prefers-reduced-motion: reduce)").matches;
      window.scrollTo({ top: 0, behavior: reduce ? "auto" : "smooth" });
    },
    [pathname],
  );
}
