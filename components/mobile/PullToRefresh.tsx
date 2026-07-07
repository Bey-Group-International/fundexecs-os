"use client";

import { useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { haptic } from "./haptics";

const THRESHOLD = 72; // px pull needed to trigger a refresh
const MAX = 110; // px cap on the visible pull
const RESIST = 0.5; // rubber-band resistance

// Native pull-to-refresh for the mobile app screens. Attaches to the nearest
// scroll ancestor (the app's `<main>`, which is `overflow-y-auto`). Only engages
// when that container is scrolled to the very top and the user drags DOWN, so it
// never fights normal scrolling; a downward pull past the threshold calls
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

    // Find the scroll container (the app <main>); fall back to the wrapper.
    let scroller: HTMLElement = wrap;
    let el: HTMLElement | null = wrap.parentElement;
    while (el) {
      const oy = getComputedStyle(el).overflowY;
      if (oy === "auto" || oy === "scroll") {
        scroller = el;
        break;
      }
      el = el.parentElement;
    }

    const onStart = (e: TouchEvent) => {
      if (refreshingRef.current || scroller.scrollTop > 0) return;
      startY.current = e.touches[0].clientY;
      active.current = true;
      armed.current = false;
    };

    const onMove = (e: TouchEvent) => {
      if (!active.current || refreshingRef.current) return;
      const dy = e.touches[0].clientY - startY.current;
      if (dy <= 0 || scroller.scrollTop > 0) {
        active.current = false;
        setDragging(false);
        setPull(0);
        return;
      }
      // We own this gesture now — stop the container from rubber-banding.
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

    scroller.addEventListener("touchstart", onStart, { passive: true });
    scroller.addEventListener("touchmove", onMove, { passive: false });
    scroller.addEventListener("touchend", onEnd, { passive: true });
    scroller.addEventListener("touchcancel", onEnd, { passive: true });
    return () => {
      scroller.removeEventListener("touchstart", onStart);
      scroller.removeEventListener("touchmove", onMove);
      scroller.removeEventListener("touchend", onEnd);
      scroller.removeEventListener("touchcancel", onEnd);
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
          className={`flex h-9 w-9 items-center justify-center rounded-full border border-gold-500/30 bg-surface-1/90 text-gold-400 shadow-lg ${
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
          transform: `translateY(${pull}px)`,
          transition: dragging ? "none" : "transform 0.28s cubic-bezier(0.22,1,0.36,1)",
        }}
      >
        {children}
      </div>
    </div>
  );
}
