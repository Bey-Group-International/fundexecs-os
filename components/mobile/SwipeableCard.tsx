"use client";

import { useRef, useState, type ComponentType, type SVGProps } from "react";
import Link from "next/link";
import { haptic } from "./haptics";

export interface SwipeAction {
  key: string;
  label: string;
  icon: ComponentType<SVGProps<SVGSVGElement>>;
  href?: string;
  onClick?: () => void;
  tone?: "neutral" | "gold" | "danger";
}

const TONE: Record<string, string> = {
  neutral: "bg-surface-3 text-fg-secondary",
  gold: "bg-gold-500/20 text-gold-300",
  danger: "bg-status-danger/20 text-status-danger",
};

const ACTION_W = 72; // px per revealed action button

// Swipe-left to reveal one-tap actions — the native gesture the spec calls for
// on deal cards. Horizontal drags are captured here; vertical scrolling stays
// with the browser via `touch-action: pan-y`, so the gesture never fights the
// page scroll and no preventDefault is needed. Tap still activates the child
// (e.g. a Link) when the card is closed; when open, a tap closes it. Purely a
// touch enhancement — the child remains the full keyboard/AT-accessible target.
export function SwipeableCard({
  actions,
  children,
  className = "",
}: {
  actions: SwipeAction[];
  children: React.ReactNode;
  className?: string;
}) {
  const reveal = actions.length * ACTION_W;
  const [tx, setTx] = useState(0); // current translateX (0 … -reveal)
  const [dragging, setDragging] = useState(false);
  const base = useRef(0); // committed offset at gesture start
  const startX = useRef(0);
  const startY = useRef(0);
  const axis = useRef<null | "h" | "v">(null);

  const open = tx <= -reveal + 1;

  function onTouchStart(e: React.TouchEvent) {
    const t = e.touches[0];
    startX.current = t.clientX;
    startY.current = t.clientY;
    base.current = tx;
    axis.current = null;
    setDragging(true);
  }

  function onTouchMove(e: React.TouchEvent) {
    const t = e.touches[0];
    const dx = t.clientX - startX.current;
    const dy = t.clientY - startY.current;
    if (axis.current === null) {
      if (Math.abs(dx) > 8 || Math.abs(dy) > 8) {
        axis.current = Math.abs(dx) > Math.abs(dy) ? "h" : "v";
      }
    }
    if (axis.current !== "h") return;
    const next = Math.max(-reveal, Math.min(0, base.current + dx));
    setTx(next);
  }

  function onTouchEnd() {
    setDragging(false);
    if (axis.current === "h") {
      const shouldOpen = tx < -reveal / 2;
      setTx(shouldOpen ? -reveal : 0);
      if (shouldOpen && !open) haptic("select");
    }
    axis.current = null;
  }

  function close() {
    setTx(0);
  }

  return (
    <div className="relative overflow-hidden rounded-2xl">
      {/* Action strip revealed behind the card */}
      <div className="absolute inset-y-0 right-0 flex" aria-hidden={!open}>
        {actions.map((a) => {
          const Icon = a.icon;
          const inner = (
            <>
              <Icon width={19} height={19} />
              <span className="text-[10px] font-medium leading-none">{a.label}</span>
            </>
          );
          const cls = `flex h-full flex-col items-center justify-center gap-1 ${TONE[a.tone ?? "neutral"]}`;
          return a.href ? (
            <Link
              key={a.key}
              href={a.href}
              tabIndex={open ? 0 : -1}
              onClick={() => {
                haptic("tap");
                close();
              }}
              className={cls}
              style={{ width: ACTION_W }}
            >
              {inner}
            </Link>
          ) : (
            <button
              key={a.key}
              type="button"
              tabIndex={open ? 0 : -1}
              onClick={() => {
                haptic("tap");
                a.onClick?.();
                close();
              }}
              className={cls}
              style={{ width: ACTION_W }}
            >
              {inner}
            </button>
          );
        })}
      </div>

      {/* Foreground card — the swipeable layer */}
      <div
        onTouchStart={onTouchStart}
        onTouchMove={onTouchMove}
        onTouchEnd={onTouchEnd}
        onClickCapture={(e) => {
          // When actions are revealed, a tap dismisses them instead of
          // activating the underlying card.
          if (open) {
            e.preventDefault();
            e.stopPropagation();
            close();
          }
        }}
        style={{
          transform: `translateX(${tx}px)`,
          transition: dragging ? "none" : "transform 0.24s cubic-bezier(0.22,1,0.36,1)",
          touchAction: "pan-y",
        }}
        className={`relative ${className}`}
      >
        {children}
      </div>
    </div>
  );
}
