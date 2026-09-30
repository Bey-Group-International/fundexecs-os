"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { haptic } from "./haptics";

const THRESHOLD = 72; // px pull needed to trigger a refresh
const MAX = 110; // px cap on the visible pull
const RESIST = 0.5; // rubber-band resistance

// Native pull-to-refresh for the mobile app screens. The app shell scrolls the
// document (window), not an inner container, so the gesture is bound to this
// screen's content and gated on the page scroll position. Only engages when the
// page is scrolled to the very top and the user drags DOWN, so it never fights
// normal scrolling; a downward pull past the threshold calls
// router.refresh() to re-run the server component's queries. Touch-only and
// mobile-only — desktop/web never mount it.
export function PullToRefresh({ children }: { children: React.ReactNode }) {
  const router = useRouter();
  const wrapRef = useRef<HTMLDivElement>(null);
  const [pull, setPull] = useState(0);
  const [refreshing, setRefreshing] = useState(false);
  const [dragging, setDragging] = useState(false);

  // Refs mirror the latest state for the once-bound native listeners.
  const pullRef = useRef(0);
  pullRef.current = pull;
  const refreshingRef = useRef(false);
  refreshingRef.current = refreshing;

  const startY = useRef(0);
  const active = useRef(false); // a genuine top-anchored downward pull
  const armed = useRef(false); // crossed the threshold (haptic once)

  useEffect(() => {
    const wrap = wrapRef.current;
    if (!wrap) return;

    // The document is the scroller; read its offset fresh on every touch.
    const scrollTop = () => document.scrollingElement?.scrollTop ?? window.scrollY;

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || scrollTop() > 0) return;
      startY.current = e.touches[0].clientY;
      active.current = true;
      armed.current = false;
    };

    const onMove = (e: TouchEvent) => {
      if (!active.current || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || scrollTop() > 0) {
        active.current = false;
        setDragging(false);
        setPull(0);
        return;
      }
      // We own this gesture now — stop the page from rubber-banding.
      e.preventDefault();
      setDragging(true);
      const dist = Math.min(MAX, dy * RESIST);
      setPull(dist);
      if (!armed.current && dist >= THRESHOLD) {
        armed.current = true;
        haptic("select");
      } else if (armed.current && dist < THRESHOLD) {
        armed.current = false;
      }
    };

    const onEnd = () => {
      if (!active.current) return;
      active.current = false;
      setDragging(false);
      if (pullRef.current >= THRESHOLD && !refreshingRef.current) {
        setRefreshing(true);
        setPull(THRESHOLD);
        haptic("success");
        router.refresh();
        // router.refresh() resolves the server render but exposes no promise;
        // hold the indicator briefly so the gesture reads as deliberate.
        window.setTimeout(() => {
          setRefreshing(false);
          setPull(0);
        }, 900);
      } else {
        setPull(0);
      }
    };

    wrap.addEventListener("touchstart", onStart, { passive: true });
    wrap.addEventListener("touchmove", onMove, { passive: false });
    wrap.addEventListener("touchend", onEnd, { passive: true });
    wrap.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      wrap.removeEventListener("touchstart", onStart);
      wrap.removeEventListener("touchmove", onMove);
      wrap.removeEventListener("touchend", onEnd);
      wrap.removeEventListener("touchcancel", onEnd);
    };
  }, [router]);

  const progress = Math.min(1, pull / THRESHOLD);

  return (
    <div className="relative">
      {/* Refresh indicator, revealed as the content is pulled down. */}
      <div
        className="pointer-events-none absolute inset-x-0 -top-12 flex justify-center"
        style={{ transform: `translateY(${pull}px)`, opacity: progress }}
        aria-hidden
      >
        <span
          className={`flex h-9 w-9 items-center justify-center rounded-full border border-gold-500/30 bg-surface-1/90 text-gold-300 shadow-lg ${
            refreshing ? "animate-spin" : ""
          }`}
          style={{ transform: refreshing ? undefined : `rotate(${progress * 270}deg)` }}
        >
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
            <path d="M21 12a9 9 0 1 1-3-6.7" />
            <path d="M21 3v5h-5" />
          </svg>
        </span>
      </div>

      <div
        ref={wrapRef}
        style={{
          // No transform at rest: even `translateY(0)` would make this wrapper
          // the containing block for any `position: fixed` sheet/toast inside
          // the screen, pinning it to the content instead of the viewport.
          transform: pull ? `translateY(${pull}px)` : undefined,
          transition: dragging ? "none" : "transform 0.28s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
