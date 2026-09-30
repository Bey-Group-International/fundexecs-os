"use client";

// The small pieces both the meeting room and its call screen need. Kept apart
// from CallParts so the room can use them without pulling the call screen's
// chunk in ahead of the green room.

import React, {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useLayoutEffect,
  useRef,
  useState,
  useSyncExternalStore,
} from "react";
import { createPortal } from "react-dom";
import type { RemovalSubject } from "@/lib/meetings/removal";
import { shouldRequestNotificationPermission, type NotificationPermissionLike } from "@/lib/meetings/knock-notice";

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

// Synthesize a short chime using Web Audio API (no audio files needed)
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
// wrapped by app/(app)/template.tsx in `animate-fade-up`. Its keyframes used to
// finish at `transform: translateY(0)` with fill-mode `both`, so a transform
// stayed applied forever; they now end at `none` with `backwards`, but the
// wrapper is still transformed for the ~0.45s entrance. Any non-`none`
// transform makes that wrapper the containing block for `position: fixed`
// descendants, which trapped the call overlay inside the page and collapsed its
// height (invisible video tiles). Portaling to <body> puts the overlay outside
// any transformed ancestor so `fixed inset-0` always resolves against the
// viewport and the call is truly full-screen.
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
      className="z-[9999] overflow-y-auto overscroll-contain rounded-xl border border-[var(--line)] bg-[var(--surface-2)] shadow-xl p-1"
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

/**
 * Wrap a set of handlers in functions whose identity never changes and which
 * always call the handlers from the latest render.
 *
 * For props handed to a memoized child: passing the handlers directly would
 * give it new functions every render and defeat the memo, and freezing the
 * first render's would act on stale state.
 */
export function useStableHandlers<T extends Record<string, (...args: any[]) => unknown>>(handlers: T): T {
  const latest = useRef(handlers);
  useLayoutEffect(() => { latest.current = handlers; });
  const [stable] = useState(() => {
    const out = {} as Record<string, (...args: unknown[]) => unknown>;
    for (const key of Object.keys(handlers)) {
      out[key] = (...args: unknown[]) => latest.current[key](...args);
    }
    return out as T;
  });
  return stable;
}

/** Somebody the host removed, and the name they had when it happened. */
export interface RemovedPerson { subject: RemovalSubject; displayName: string }

// ── Who is talking ──────────────────────────────────────────────────────────
//
// The same move MeetingClock made for the second hand, for the same reason and
// three times as often.
//
// `speaking` used to be a Set in MeetingRoom's own state, republished by the
// voice meter whenever a voice crossed the 900ms hold — which is every pause in
// ordinary conversation, about three times a second. MeetingRoom is a
// 4,858-line component, so each of those re-ran all of it: every tile, the
// control bar, and the copilot sidebar's whole body, on the same main thread
// that decodes the video. Measured over ten seconds of talking, 31 runs at
// 2.3ms with eight people and 3.8ms with twenty-six.
//
// Almost none of that work was about the change. `speaking` is read by LEAVES
// only — the ring on a tile and the dot on a sidebar row — and one person
// talking changes the answer for one of them. The sidebar's People list is
// behind a tab that is not even the default, so on the chat tab the panel was
// rebuilt three times a second for a value it does not draw.
//
// So the set lives here instead, and the leaves subscribe to their own id. A
// publish notifies only the ids whose answer actually changed, which is what
// makes one person starting to talk cost one tile rather than a room.
//
// Why a store rather than a ref: the clock could hold a ref because a tick tells
// it WHEN to look and the answer is arithmetic it can redo. Nobody ticks for
// speech, so the leaves have to be told. `useSyncExternalStore` is the
// supported way to be told without tearing.

/** A read side: what one id's answer is, and how to hear about changes to it. */
export interface SpeakingSource {
  get(id: string): boolean;
  subscribe(id: string, onChange: () => void): () => void;
}

export interface SpeakingStore extends SpeakingSource {
  /** Replace the whole set. Only the ids whose membership moved are notified. */
  publish(next: ReadonlySet<string>): void;
}

export function createSpeakingStore(): SpeakingStore {
  let current: ReadonlySet<string> = new Set<string>();
  const listeners = new Map<string, Set<() => void>>();

  return {
    get: (id) => current.has(id),

    subscribe(id, onChange) {
      const forId = listeners.get(id) ?? new Set<() => void>();
      forId.add(onChange);
      listeners.set(id, forId);
      return () => {
        forId.delete(onChange);
        // Dropped rather than left empty: a long call admits and removes people,
        // and a map that only ever grows is a leak with extra steps.
        if (forId.size === 0) listeners.delete(id);
      };
    },

    publish(next) {
      const before = current;
      current = next;
      // Only the ids somebody is watching, and only where the answer moved. The
      // whole point is that one voice does not wake twenty-five tiles.
      for (const [id, forId] of listeners) {
        if (before.has(id) === next.has(id)) continue;
        for (const onChange of forId) onChange();
      }
    },
  };
}

const SpeakingContext = createContext<SpeakingSource | null>(null);

/** Hand the leaves below a live source. The room owns the store; they read it. */
export const SpeakingProvider = SpeakingContext.Provider;

/**
 * Whether one person is talking, live, without re-rendering anything above.
 *
 * `fallback` answers in two cases: when there is no provider, and when `id` is
 * empty. The first is how every component here stays renderable on its own with
 * a plain boolean, as CallParts.sidebar.test.tsx and MeetingRoom.tile.test.tsx
 * both do. The second is the one this shipped without, and CodeRabbit caught it
 * on #1176: an empty id used to ask the store about a participant who cannot
 * exist, which answers `false` forever, so a caller who gave a boolean and no id
 * got silence instead of their own value. Nothing was visibly broken — every
 * call site in the room passes a real id — but the contract VideoTile documents
 * was not the one this kept.
 *
 * So: no store, or nobody named, means the caller's own answer stands.
 */
export function useSpeaking(id: string, fallback: boolean): boolean {
  const source = useContext(SpeakingContext);

  const watching = source !== null && id !== "";
  const subscribe = useCallback(
    (onChange: () => void) => (watching && source ? source.subscribe(id, onChange) : () => {}),
    [watching, source, id],
  );
  const read = useCallback(
    () => (watching && source ? source.get(id) : fallback),
    [watching, source, id, fallback],
  );

  return useSyncExternalStore(subscribe, read, read);
}
