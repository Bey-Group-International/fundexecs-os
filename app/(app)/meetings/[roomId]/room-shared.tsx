"use client";

// The small pieces both the meeting room and its call screen need. Kept apart
// from CallParts so the room can use them without pulling the call screen's
// chunk in ahead of the green room.

import React, { useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import type { RemovalSubject } from "@/lib/meetings/removal";
import { shouldRequestNotificationPermission, type NotificationPermissionLike } from "@/lib/meetings/knock-notice";

// Synthesize a short chime using Web Audio API (no audio files needed)
/** What the browser currently says about notifications, including "no API". */
export function notificationPermission(): NotificationPermissionLike {
  if (typeof window === "undefined" || typeof Notification === "undefined") return "unsupported";
  return Notification.permission as NotificationPermissionLike;
}

/**
 * Ask the host, once, whether we may knock on their behalf.
 *
 * Deliberately synchronous. `Notification.requestPermission()` is gated on
 * transient user activation, and activation does not survive an `await` — so
 * this has to run on the same tick as the click that triggered it, not after
 * the sign-in check, the meeting lookup and the camera have all been waited on.
 * Getting that wrong does not throw: the prompt is simply never shown, the
 * permission stays "default", and the waiting-room notification this exists for
 * silently never fires.
 */
export function requestHostNotifications(isHost: boolean): void {
  if (!shouldRequestNotificationPermission({ isHost, permission: notificationPermission() })) return;
  try { void Notification.requestPermission(); } catch { /* unsupported */ }
}

export function playChime(type: "join" | "leave" | "knock") {
  try {
    const ctx = new AudioContext();
    const osc = ctx.createOscillator();
    const gain = ctx.createGain();
    osc.connect(gain); gain.connect(ctx.destination);
    if (type === "join") {
      osc.frequency.setValueAtTime(880, ctx.currentTime);
      osc.frequency.setValueAtTime(1100, ctx.currentTime + 0.1);
    } else if (type === "knock") {
      // Two soft taps, distinct from the join tone: somebody is at the door, not
      // in the room. A host looking at a document has only this and the tab
      // title to tell them anyone is waiting.
      osc.frequency.setValueAtTime(520, ctx.currentTime);
      osc.frequency.setValueAtTime(520, ctx.currentTime + 0.12);
    } else {
      osc.frequency.setValueAtTime(660, ctx.currentTime);
      osc.frequency.setValueAtTime(440, ctx.currentTime + 0.1);
    }
    gain.gain.setValueAtTime(0.15, ctx.currentTime);
    gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
    osc.start(ctx.currentTime);
    osc.stop(ctx.currentTime + 0.35);
    osc.onended = () => void ctx.close();
  } catch { /* AudioContext not available */ }
}

// ─── BodyPortal ───────────────────────────────────────────────────────────────

// Renders children into <body>, escaping the app shell. The meeting page is
// wrapped by app/(app)/template.tsx in `animate-fade-up`, whose keyframes finish
// at `transform: translateY(0)` with fill-mode `both` — so a transform stays
// applied forever. Any non-`none` transform makes that wrapper the containing
// block for `position: fixed` descendants, which trapped the call overlay inside
// the scrolling content pane and collapsed its height (invisible video tiles).
// Portaling to <body> puts the overlay outside that transformed ancestor so
// `fixed inset-0` resolves against the viewport and the call is truly full-screen.
export function BodyPortal({ children }: { children: React.ReactNode }) {
  const [mounted, setMounted] = useState(false);
  useEffect(() => setMounted(true), []);
  if (!mounted || typeof document === "undefined") return null;
  return createPortal(children, document.body);
}

// ─── FloatingMenu ─────────────────────────────────────────────────────────────

// A popover anchored to a trigger button that ALWAYS stays inside the viewport.
// The in-call controls live inside a `fixed inset-0` overlay, and their menus
// used to open with `absolute bottom-full left-1/2 -translate-x-1/2` — which
// bled off the top/side edges (a long camera list spilled straight off-screen).
// This renders the menu in a portal on <body> with fixed, viewport-clamped
// positioning, so no transformed/overflow-clipped ancestor can trap or cut it,
// and the list scrolls when it's taller than the space available.
export function FloatingMenu({
  open, anchorRef, onClose, children, minWidth = 220,
}: {
  open: boolean;
  anchorRef: React.RefObject<HTMLElement | null>;
  onClose: () => void;
  children: React.ReactNode;
  minWidth?: number;
}) {
  const panelRef = useRef<HTMLDivElement>(null);
  const [style, setStyle] = useState<React.CSSProperties>({ position: "fixed", top: 0, left: 0, visibility: "hidden" });

  useLayoutEffect(() => {
    if (!open) return;
    const reposition = () => {
      const anchor = anchorRef.current;
      const panel = panelRef.current;
      if (!anchor || !panel) return;
      const a = anchor.getBoundingClientRect();
      const vw = window.innerWidth;
      const vh = window.innerHeight;
      const margin = 8;
      const gap = 8;
      const pw = panel.offsetWidth;
      const ph = panel.scrollHeight;
      // Horizontal: center over the anchor, then clamp within the viewport.
      let left = a.left + a.width / 2 - pw / 2;
      left = Math.max(margin, Math.min(left, vw - pw - margin));
      // Vertical: prefer opening above the anchor (it sits in a bottom bar);
      // flip below when there isn't room, and cap height so it always fits.
      const spaceAbove = a.top - gap - margin;
      const spaceBelow = vh - a.bottom - gap - margin;
      let top: number;
      let maxHeight: number;
      if (ph <= spaceAbove || spaceAbove >= spaceBelow) {
        maxHeight = spaceAbove;
        top = a.top - gap - Math.min(ph, maxHeight);
      } else {
        maxHeight = spaceBelow;
        top = a.bottom + gap;
      }
      setStyle({
        position: "fixed",
        left,
        top: Math.max(margin, top),
        maxHeight: Math.max(120, maxHeight),
        visibility: "visible",
      });
    };
    reposition();
    window.addEventListener("resize", reposition);
    window.addEventListener("scroll", reposition, true);
    return () => {
      window.removeEventListener("resize", reposition);
      window.removeEventListener("scroll", reposition, true);
    };
  }, [open, anchorRef]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (panelRef.current?.contains(e.target as Node) || anchorRef.current?.contains(e.target as Node)) return;
      onClose();
    };
    const onKey = (e: KeyboardEvent) => { if (e.key === "Escape") onClose(); };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, onClose, anchorRef]);

  if (!open || typeof document === "undefined") return null;

  return createPortal(
    <div
      ref={panelRef}
      style={{ minWidth, ...style }}
      className="z-[9999] overflow-y-auto rounded-xl border border-[var(--line)] bg-[var(--surface-2)] shadow-xl p-1"
      role="menu"
    >
      {children}
    </div>,
    document.body,
  );
}

/** The live video track inside a stream, which is not the same as the stream. */
export function videoTrackOf(stream: MediaStream | null): MediaStreamTrack | null {
  return stream?.getVideoTracks()[0] ?? null;
}


/** Somebody the host removed, and the name they had when it happened. */
export interface RemovedPerson { subject: RemovalSubject; displayName: string }
