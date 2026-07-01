"use client";
// CreditPopup — micro-dopamine hit that fires the instant a task completes.
//
// Usage:
//   1. Wrap your app (or hub shell) in <CreditPopupProvider />.
//   2. Call `useCreditPopup().show(payload)` from any task-completion handler.
//
// The popup appears near the triggering element (or screen center-bottom as
// fallback), floats upward, and fades over ~1.8 s. Multiple concurrent
// completions stack with a slight horizontal offset so they don't collide.

import React, {
  createContext,
  useCallback,
  useContext,
  useRef,
  useState,
} from "react";
import type { TaskRewardPayload } from "@/lib/gamification";

// ─── Types ────────────────────────────────────────────────────────────────────

interface PopupInstance {
  id: number;
  payload: TaskRewardPayload;
  /** Viewport-relative coordinates for the pop origin. */
  origin?: { x: number; y: number };
}

interface CreditPopupContextValue {
  show: (payload: TaskRewardPayload, origin?: { x: number; y: number }) => void;
}

// ─── Hub color map ────────────────────────────────────────────────────────────

const HUB_COLOR: Record<string, { text: string; glow: string }> = {
  build:   { text: "text-neural-300",           glow: "drop-shadow-[0_0_10px_rgba(118,185,0,0.7)]"    },
  source:  { text: "text-agent-analyst",         glow: "drop-shadow-[0_0_10px_rgba(34,211,238,0.7)]"  },
  run:     { text: "text-agent-ir",              glow: "drop-shadow-[0_0_10px_rgba(245,158,11,0.7)]"  },
  execute: { text: "text-status-success",        glow: "drop-shadow-[0_0_10px_rgba(95,184,122,0.7)]"  },
};

// ─── Context ──────────────────────────────────────────────────────────────────

const CreditPopupContext = createContext<CreditPopupContextValue>({
  show: () => undefined,
});

export function useCreditPopup(): CreditPopupContextValue {
  return useContext(CreditPopupContext);
}

// ─── Provider ─────────────────────────────────────────────────────────────────

export function CreditPopupProvider({ children }: { children: React.ReactNode }) {
  const [popups, setPopups] = useState<PopupInstance[]>([]);
  const counter = useRef(0);

  const show = useCallback(
    (payload: TaskRewardPayload, origin?: { x: number; y: number }) => {
      const id = ++counter.current;
      setPopups((prev: PopupInstance[]) => [...prev.slice(-4), { id, payload, origin }]);
      // Remove after animation completes (1.8 s + small buffer)
      setTimeout(() => {
        setPopups((prev: PopupInstance[]) => prev.filter((p: PopupInstance) => p.id !== id));
      }, 2_200);
    },
    [],
  );

  return (
    <CreditPopupContext.Provider value={{ show }}>
      {children}
      <div aria-live="polite" aria-atomic="false" className="pointer-events-none fixed inset-0 z-[9999]">
        {popups.map((p: PopupInstance, i: number) => (
          <CreditPopupItem key={p.id} instance={p} stackIndex={i} />
        ))}
      </div>
    </CreditPopupContext.Provider>
  );
}

// ─── Individual popup ─────────────────────────────────────────────────────────

function CreditPopupItem({
  instance,
  stackIndex,
}: {
  instance: PopupInstance;
  stackIndex: number;
}) {
  const { payload, origin } = instance;
  const colors = HUB_COLOR[payload.hub] ?? HUB_COLOR.build;

  // Position: near origin if provided, else bottom-center of viewport
  const left = origin ? origin.x : undefined;
  const bottom = origin ? undefined : 80 + stackIndex * 70;
  const top = origin ? origin.y - stackIndex * 60 : undefined;
  const translateX = origin ? "-50%" : undefined;

  const style: React.CSSProperties = {
    position: "fixed",
    left:    left ?? "50%",
    bottom:  bottom,
    top:     top,
    transform: translateX ? `translateX(${translateX})` : "translateX(-50%)",
    zIndex: 9999,
  };

  const hasMilestone  = (payload.milestoneBonus ?? 0) > 0;
  const hasAchievement = payload.achievementsEarned?.length > 0;
  const hasStreak      = payload.streakBonus > 0;

  return (
    <div style={style} className="animate-credit-pop select-none">
      {/* Main credit badge */}
      <div
        className={[
          "flex items-center gap-1.5 rounded-full border px-3 py-1.5",
          "border-neural-400/40 bg-black/80 backdrop-blur-sm",
          "shadow-[0_4px_24px_rgba(0,0,0,0.6)]",
        ].join(" ")}
      >
        <span className={`font-mono text-lg font-bold leading-none ${colors.text} ${colors.glow}`}>
          ◆
        </span>
        <span className="font-display text-xl font-semibold text-fg-primary">
          +{payload.totalEarned}
        </span>
        <span className="font-mono text-[10px] uppercase tracking-wider text-fg-muted">
          credits
        </span>
      </div>

      {/* Streak multiplier pill */}
      {hasStreak && (
        <div className="mt-1 flex justify-center">
          <span className="flex items-center gap-1 rounded-full border border-orange-500/40 bg-orange-500/15 px-2 py-0.5 font-mono text-[10px] text-orange-300">
            <span className="animate-streak-flame inline-block">🔥</span>
            {payload.streakMult.toFixed(2)}× streak · +{payload.streakBonus}
          </span>
        </div>
      )}

      {/* Milestone unlock */}
      {hasMilestone && (
        <div className="mt-1 flex justify-center">
          <span className="animate-milestone-burst flex items-center gap-1 rounded-full border border-yellow-400/50 bg-yellow-400/15 px-2 py-0.5 font-mono text-[10px] text-yellow-300">
            ★ Milestone · +{payload.milestoneBonus}
          </span>
        </div>
      )}

      {/* Achievement unlock(s) */}
      {hasAchievement &&
        payload.achievementsEarned.map((a) => (
          <div key={a.key} className="mt-1 flex justify-center">
            <span className="animate-badge-reveal flex items-center gap-1 rounded-full border border-neural-400/50 bg-neural-400/15 px-2 py-0.5 font-mono text-[10px] text-neural-300">
              ◈ {a.label}
            </span>
          </div>
        ))}
    </div>
  );
}
