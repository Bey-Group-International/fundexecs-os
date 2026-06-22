"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ExecutiveHQBoot } from "./ExecutiveHQBoot";

type ExecData = {
  id: string;
  name: string;
  shortName: string;
  sprite: string;
  themeColor: string;
  href: string;
  bobDelay: string;
  wanderDelay: string;
  hint: string;
  walkDuration: string;
};

type RoomData = {
  id: string;
  label: string;
  href: string;
  gridArea: string;
  accentColor: string;
  monitorColor: string;
  executives: ExecData[];
};

type BubbleState = { execId: string; text: string } | null;

// Enhancement 1: Live data badges
type RoomStats = { label: string; value: string | number; trend?: "up" | "down" | "flat" };

const ROOM_STATS: Record<string, RoomStats> = {
  ceo:       { label: "tasks",     value: 4,  trend: "flat" },
  boardroom: { label: "meetings",  value: 2,  trend: "up"   },
  trading:   { label: "deals",     value: 7,  trend: "up"   },
  research:  { label: "reports",   value: 3,  trend: "flat" },
  investor:  { label: "LPs",       value: 12, trend: "up"   },
  ops:       { label: "workflows", value: 5,  trend: "flat" },
  legal:     { label: "docs",      value: 2,  trend: "down" },
  marketing: { label: "campaigns", value: 3,  trend: "up"   },
  reception: { label: "visitors",  value: 1,  trend: "flat" },
};

// Enhancement 3: Activity levels
const ROOM_ACTIVITY: Record<string, 0 | 1 | 2 | 3> = {
  ceo: 1, boardroom: 2, trading: 3, research: 1,
  investor: 2, ops: 3, legal: 0, marketing: 2, reception: 1,
};

// Deterministic particle positions — no Math.random() in render
const PARTICLE_POSITIONS: Array<{ top: string; left: string; drift: string; delay: string }> = [
  { top: "20%", left: "15%", drift: "-6px", delay: "0s" },
  { top: "35%", left: "70%", drift: "8px",  delay: "0.8s" },
  { top: "55%", left: "40%", drift: "-4px", delay: "1.5s" },
  { top: "70%", left: "85%", drift: "10px", delay: "0.4s" },
];

const MONITOR_POSITIONS: Array<{ top: string; left: string; size: string; delay: string; duration: string }> = [
  { top: "25%", left: "20%", size: "10px",  delay: "0s",    duration: "3.2s" },
  { top: "30%", left: "60%", size: "8px",   delay: "1.1s",  duration: "4s"   },
  { top: "28%", left: "80%", size: "9px",   delay: "0.6s",  duration: "3.6s" },
];

const LIGHT_FLICKER_DELAYS = ["0s", "2.3s", "5.1s", "1.7s", "3.8s", "4.2s", "0.9s", "6.1s", "1.2s"];

// Transform origins for each room based on grid position
const ROOM_TRANSFORM_ORIGINS: Record<string, string> = {
  ceo: "top left",
  boardroom: "top center",
  trading: "top right",
  research: "top right",
  investor: "top left",
  ops: "top center",
  legal: "top right",
  marketing: "top right",
  reception: "bottom center",
};

const E: Record<string, ExecData> = {
  earnest: {
    id: "earnest-fundmaker",
    name: "Earnest Fundmaker",
    shortName: "Earnest",
    sprite: "/assets/fundexecs/characters/earnest-fundmaker/sprite.png",
    themeColor: "#fbbf24",
    href: "/dashboard",
    bobDelay: "0s",
    wanderDelay: "0s",
    hint: "Onboarding complete ✓",
    walkDuration: "7s",
  },
  executiveAdvisor: {
    id: "executive-advisor",
    name: "Executive Advisor",
    shortName: "Exec Advisor",
    sprite: "/assets/fundexecs/characters/executive-advisor/sprite.png",
    themeColor: "#a855f7",
    href: "/dashboard",
    bobDelay: "0.6s",
    wanderDelay: "1.2s",
    hint: "Market signal detected",
    walkDuration: "8s",
  },
  dealSourcer: {
    id: "deal-sourcer",
    name: "Deal Sourcer",
    shortName: "Deal",
    sprite: "/assets/fundexecs/characters/deal-sourcer/sprite.png",
    themeColor: "#f97316",
    href: "/dashboard/deals",
    bobDelay: "0.2s",
    wanderDelay: "0.5s",
    hint: "3 targets in pipeline",
    walkDuration: "9s",
  },
  capitalRaiser: {
    id: "capital-raiser",
    name: "Capital Raiser",
    shortName: "Capital",
    sprite: "/assets/fundexecs/characters/capital-raiser/sprite.png",
    themeColor: "#ec4899",
    href: "/dashboard/deals",
    bobDelay: "0.8s",
    wanderDelay: "2.1s",
    hint: "Fund room ready",
    walkDuration: "10s",
  },
  workflowInstructor: {
    id: "workflow-instructor",
    name: "Workflow Instructor",
    shortName: "Workflow",
    sprite: "/assets/fundexecs/characters/workflow-instructor/sprite.png",
    themeColor: "#ef4444",
    href: "/dashboard",
    bobDelay: "0.4s",
    wanderDelay: "0.9s",
    hint: "SOP updated",
    walkDuration: "11s",
  },
  capitalConnector: {
    id: "capital-connector",
    name: "Capital Connector",
    shortName: "Cap. Conn.",
    sprite: "/assets/fundexecs/characters/capital-connector/sprite.png",
    themeColor: "#14b8a6",
    href: "/dashboard/capital",
    bobDelay: "0.4s",
    wanderDelay: "1.8s",
    hint: "Follow-up due",
    walkDuration: "12s",
  },
  automater: {
    id: "automater",
    name: "Automater",
    shortName: "Automater",
    sprite: "/assets/fundexecs/characters/automater/sprite.png",
    themeColor: "#22c55e",
    href: "/dashboard/automation",
    bobDelay: "0.1s",
    wanderDelay: "0.3s",
    hint: "2 workflows ran today",
    walkDuration: "13s",
  },
  rainmaker: {
    id: "rainmaker",
    name: "Rainmaker",
    shortName: "Rainmaker",
    sprite: "/assets/fundexecs/characters/rainmaker/sprite.png",
    themeColor: "#fbbf24",
    href: "/dashboard/capital",
    bobDelay: "0.5s",
    wanderDelay: "1.5s",
    hint: "High-value lead flagged",
    walkDuration: "7.5s",
  },
  prDirector: {
    id: "pr-director",
    name: "PR Director",
    shortName: "PR",
    sprite: "/assets/fundexecs/characters/pr-director/sprite.png",
    themeColor: "#f97316",
    href: "/dashboard/marketing",
    bobDelay: "0s",
    wanderDelay: "0.7s",
    hint: "Story opportunity",
    walkDuration: "8.5s",
  },
  leadGenerator: {
    id: "lead-generator",
    name: "Lead Generator",
    shortName: "Lead",
    sprite: "/assets/fundexecs/characters/lead-generator/sprite.png",
    themeColor: "#f97316",
    href: "/dashboard/marketing",
    bobDelay: "0.3s",
    wanderDelay: "2.4s",
    hint: "12 leads captured",
    walkDuration: "9.5s",
  },
  seoDisruptor: {
    id: "seo-disruptor",
    name: "SEO Disruptor",
    shortName: "SEO",
    sprite: "/assets/fundexecs/characters/seo-disruptor/sprite.png",
    themeColor: "#f97316",
    href: "/dashboard/marketing",
    bobDelay: "0.6s",
    wanderDelay: "1.1s",
    hint: "Rankings improved",
    walkDuration: "10.5s",
  },
  curator: {
    id: "curator",
    name: "Curator",
    shortName: "Curator",
    sprite: "/assets/fundexecs/characters/curator/sprite.png",
    themeColor: "#f97316",
    href: "/dashboard/marketing",
    bobDelay: "0.9s",
    wanderDelay: "3.0s",
    hint: "Event scheduled",
    walkDuration: "11.5s",
  },
  investorRelations: {
    id: "investor-relations",
    name: "Investor Relations",
    shortName: "IR",
    sprite: "/assets/fundexecs/characters/investor-relations/sprite.png",
    themeColor: "#f59e0b",
    href: "/dashboard/investor-relations",
    bobDelay: "0.3s",
    wanderDelay: "0.6s",
    hint: "LP update ready",
    walkDuration: "12.5s",
  },
  officeManager: {
    id: "office-manager",
    name: "Office Manager",
    shortName: "Manager",
    sprite: "/assets/fundexecs/characters/office-manager/sprite.svg",
    themeColor: "#94a3b8",
    href: "/dashboard",
    bobDelay: "0.1s",
    wanderDelay: "0.2s",
    hint: "All systems operational",
    walkDuration: "9s",
  },
};

const ROOMS: RoomData[] = [
  {
    id: "ceo",
    label: "CEO OFFICE",
    href: "/dashboard",
    gridArea: "ceo",
    accentColor: "#b45309",
    monitorColor: "#fbbf24",
    executives: [E.earnest],
  },
  {
    id: "boardroom",
    label: "BOARDROOM",
    href: "/dashboard",
    gridArea: "board",
    accentColor: "#3b82f6",
    monitorColor: "#93c5fd",
    executives: [E.executiveAdvisor],
  },
  {
    id: "trading",
    label: "TRADING FLOOR",
    href: "/dashboard/deals",
    gridArea: "trading",
    accentColor: "#14b8a6",
    monitorColor: "#5eead4",
    executives: [E.dealSourcer, E.capitalRaiser],
  },
  {
    id: "research",
    label: "RESEARCH HUB",
    href: "/dashboard",
    gridArea: "research",
    accentColor: "#6366f1",
    monitorColor: "#a5b4fc",
    executives: [E.workflowInstructor],
  },
  {
    id: "investor",
    label: "INVESTOR LOUNGE",
    href: "/dashboard/capital",
    gridArea: "investor",
    accentColor: "#a855f7",
    monitorColor: "#d8b4fe",
    executives: [E.capitalConnector],
  },
  {
    id: "ops",
    label: "OPERATIONS HUB",
    href: "/dashboard/automation",
    gridArea: "ops",
    accentColor: "#22c55e",
    monitorColor: "#86efac",
    executives: [E.automater, E.officeManager],
  },
  {
    id: "legal",
    label: "LEGAL CORNER",
    href: "/dashboard/capital",
    gridArea: "legal",
    accentColor: "#ef4444",
    monitorColor: "#fca5a5",
    executives: [E.rainmaker],
  },
  {
    id: "marketing",
    label: "MARKETING SALOON",
    href: "/dashboard/marketing",
    gridArea: "marketing",
    accentColor: "#f97316",
    monitorColor: "#fdba74",
    executives: [E.prDirector, E.leadGenerator, E.seoDisruptor, E.curator],
  },
  {
    id: "reception",
    label: "RECEPTION",
    href: "/dashboard/investor-relations",
    gridArea: "reception",
    accentColor: "#b49320",
    monitorColor: "#fcd34d",
    executives: [E.investorRelations],
  },
];

function SpeechBubble({ text, color }: { text: string; color: string }) {
  return (
    <div style={{
      position: "absolute",
      bottom: "calc(100% + 4px)",
      left: "50%",
      transform: "translateX(-50%)",
      background: "#06090f",
      border: `1px solid ${color}80`,
      color,
      fontFamily: "monospace",
      fontSize: 7,
      padding: "3px 6px",
      whiteSpace: "nowrap",
      maxWidth: 120,
      textOverflow: "ellipsis",
      overflow: "hidden",
      boxShadow: `0 0 8px ${color}30`,
      animation: "bubble-in 0.2s ease-out",
      pointerEvents: "none",
      zIndex: 10,
    }}>
      {text}
      {/* Tail */}
      <div style={{
        position: "absolute",
        bottom: -4,
        left: "50%",
        width: 6,
        height: 4,
        background: "#06090f",
        borderBottom: `1px solid ${color}80`,
        borderRight: `1px solid ${color}80`,
        transform: "translateX(-50%) rotate(45deg)",
      }} />
    </div>
  );
}

function ExecAvatar({
  exec,
  size,
  onClick,
  activeBubble,
  reducedEffects,
  nightMode,
}: {
  exec: ExecData;
  size: number;
  onClick: () => void;
  activeBubble: BubbleState;
  reducedEffects: boolean;
  nightMode: boolean;
}) {
  // Sprites hidden for now — room map stands on its own
  return null;
}

function RoomCell({
  room,
  roomIndex,
  onExecClick,
  onRoomClick,
  zoomingRoom,
  activeBubble,
  reducedEffects,
  nightMode,
  isFocused,
  activity,
}: {
  room: RoomData;
  roomIndex: number;
  onExecClick: (exec: ExecData) => void;
  onRoomClick: (roomId: string, href: string) => void;
  zoomingRoom: string | null;
  activeBubble: BubbleState;
  reducedEffects: boolean;
  nightMode: boolean;
  isFocused: boolean;
  activity: 0 | 1 | 2 | 3;
}) {
  const [hovered, setHovered] = useState(false);
  const execCount = room.executives.length;
  const avatarSize = execCount >= 4 ? 36 : execCount >= 2 ? 42 : 48;
  const flickerDelay = LIGHT_FLICKER_DELAYS[roomIndex % LIGHT_FLICKER_DELAYS.length];
  const isZooming = zoomingRoom === room.id;
  const transformOrigin = ROOM_TRANSFORM_ORIGINS[room.id] ?? "center center";

  const stats = ROOM_STATS[room.id];
  const trendArrow = stats?.trend === "up" ? "↑" : stats?.trend === "down" ? "↓" : "→";

  // Activity-based breathe duration
  const breatheDuration = activity >= 3 ? "2s" : "4s";

  // Box shadow for focused/hover/activity
  let boxShadow: string;
  if (isFocused) {
    boxShadow = `inset 0 0 0 2px ${room.accentColor}, 0 0 0 1px white`;
  } else if (hovered) {
    boxShadow = `inset 0 0 0 2px ${room.accentColor}cc, 0 0 20px ${room.accentColor}40`;
  } else if (activity >= 3) {
    boxShadow = `inset 0 0 0 1px ${room.accentColor}44, 0 0 12px ${room.accentColor}30`;
  } else {
    boxShadow = `inset 0 0 0 1px ${room.accentColor}22`;
  }

  return (
    <div
      onClick={() => onRoomClick(room.id, room.href)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        gridArea: room.gridArea,
        position: "relative",
        cursor: "pointer",
        background: "transparent",
        overflow: "hidden",
        boxShadow,
        transform: isZooming ? "scale(2.5)" : "scale(1)",
        transformOrigin,
        zIndex: isZooming ? 20 : undefined,
        transition: isZooming
          ? "transform 0.3s ease-in, box-shadow 0.2s ease"
          : "box-shadow 0.2s ease",
      }}
    >
      {/* Room breathe overlay */}
      {!reducedEffects && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: room.accentColor,
            opacity: 0,
            animation: `room-breathe ${breatheDuration} ease-in-out infinite`,
            animationDelay: `${roomIndex * 0.45}s`,
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
      )}

      {/* Extra fast pulse overlay for activity level 3 */}
      {!reducedEffects && activity >= 3 && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: room.accentColor,
            opacity: 0,
            animation: `room-breathe 2s ease-in-out infinite`,
            animationDelay: `${roomIndex * 0.45 + 1}s`,
            pointerEvents: "none",
            zIndex: 1,
          }}
        />
      )}

      {/* Light flicker overlay */}
      <div
        style={{
          position: "absolute",
          inset: 0,
          background: "rgba(255,255,200,0.04)",
          animation: `light-flicker 8s ease-in-out infinite ${flickerDelay}`,
          pointerEvents: "none",
          zIndex: 1,
        }}
      />

      {/* Hover accent glow */}
      {hovered && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            background: `radial-gradient(ellipse at center, ${room.accentColor}18 0%, transparent 70%)`,
            pointerEvents: "none",
            zIndex: 2,
          }}
        />
      )}

      {/* Monitor glows */}
      {MONITOR_POSITIONS.map((mp, i) => (
        <div
          key={i}
          style={{
            position: "absolute",
            top: mp.top,
            left: mp.left,
            width: mp.size,
            height: mp.size,
            borderRadius: "2px",
            background: room.monitorColor,
            filter: "blur(8px)",
            animation: `monitor-pulse ${mp.duration} ease-in-out infinite ${mp.delay}`,
            pointerEvents: "none",
            zIndex: 2,
          }}
        />
      ))}

      {/* Particles */}
      {!reducedEffects && PARTICLE_POSITIONS.map((pp, i) => (
        <span
          key={i}
          style={{
            position: "absolute",
            top: pp.top,
            left: pp.left,
            width: 2,
            height: 2,
            borderRadius: "50%",
            background: room.accentColor,
            ["--drift" as string]: pp.drift,
            animation: `particle-rise 3s ease-out infinite ${pp.delay}`,
            pointerEvents: "none",
            zIndex: 2,
            opacity: 0,
          }}
        />
      ))}

      {/* Room label — top left, always visible */}
      <div
        style={{
          position: "absolute",
          top: 4,
          left: 5,
          zIndex: 5,
          pointerEvents: "none",
          userSelect: "none",
        }}
      >
        <div
          style={{
            fontFamily: "monospace",
            fontSize: 7,
            fontWeight: 700,
            letterSpacing: "0.14em",
            textTransform: "uppercase",
            color: room.accentColor,
            textShadow: `0 0 8px ${room.accentColor}`,
            opacity: hovered ? 1 : 0.6,
            transition: "opacity 0.15s",
          }}
        >
          {room.label}
        </div>
      </div>

      {/* Enter indicator — top right on hover or zoom */}
      {(hovered || isZooming) && (
        <div
          style={{
            position: "absolute",
            top: 5,
            right: 5,
            fontFamily: "monospace",
            fontSize: 7,
            color: room.accentColor,
            letterSpacing: "0.1em",
            opacity: 0.9,
            userSelect: "none",
            pointerEvents: "none",
            zIndex: 5,
          }}
        >
          {isZooming ? "ENTERING..." : "→ ENTER"}
        </div>
      )}

      {/* Enhancement 1: Stats badge — bottom right */}
      {stats && (
        <div
          style={{
            position: "absolute",
            bottom: 4,
            right: 5,
            zIndex: 5,
            pointerEvents: "none",
            fontFamily: "monospace",
            fontSize: 7,
            textTransform: "uppercase",
            color: room.accentColor,
            letterSpacing: "0.08em",
            userSelect: "none",
          }}
        >
          {stats.value} {stats.label} {trendArrow}
        </div>
      )}

      {/* Enhancement 2: Hover preview card */}
      {hovered && stats && (
        <div
          style={{
            position: "absolute",
            bottom: "calc(100% - 20px)",
            left: "50%",
            transform: "translateX(-50%)",
            background: "rgba(6,9,15,0.92)",
            border: `1px solid ${room.accentColor}60`,
            fontFamily: "monospace",
            fontSize: 8,
            padding: "5px 8px",
            whiteSpace: "nowrap",
            zIndex: 10,
            pointerEvents: "none",
            animation: "fadeSlideUp 0.15s ease-out",
            color: "#e2e8f0",
            textAlign: "center",
            minWidth: 80,
          }}
        >
          <div style={{ color: room.accentColor, fontWeight: 700, letterSpacing: "0.1em", marginBottom: 2 }}>
            {room.label}
          </div>
          <div style={{ opacity: 0.8, marginBottom: 3 }}>
            {stats.value} {stats.label} {trendArrow}
          </div>
          <div style={{ color: room.accentColor, opacity: 0.9, letterSpacing: "0.08em" }}>
            → ENTER
          </div>
        </div>
      )}

      {/* Enhancement 4: Focused ring label */}
      {isFocused && (
        <div
          style={{
            position: "absolute",
            bottom: 4,
            left: 5,
            zIndex: 5,
            pointerEvents: "none",
            fontFamily: "monospace",
            fontSize: 6,
            color: "white",
            opacity: 0.7,
            letterSpacing: "0.08em",
            userSelect: "none",
          }}
        >
          [↵ ENTER]
        </div>
      )}

      {/* Exec avatars — walk across the floor of the room */}
      <div
        style={{
          position: "absolute",
          bottom: 6,
          left: 0,
          right: 0,
          zIndex: 4,
          display: "flex",
          justifyContent: "space-around",
          alignItems: "flex-end",
          pointerEvents: "none",
        }}
      >
        {room.executives.map((exec) => (
          <ExecAvatar
            key={exec.id}
            exec={exec}
            size={avatarSize}
            onClick={() => onExecClick(exec)}
            activeBubble={activeBubble}
            reducedEffects={reducedEffects}
            nightMode={nightMode}
          />
        ))}
      </div>
    </div>
  );
}

// Enhancement 4: Grid layout for keyboard navigation
// Row 0: indices 0-3 (ceo, boardroom, trading, research)
// Row 1: indices 4-7 (investor, ops, legal, marketing)
// Row 2: index 8 (reception)
const ROOM_ROWS = [[0, 1, 2, 3], [4, 5, 6, 7], [8]];

export function ExecutiveHQ() {
  const router = useRouter();
  const [booting, setBooting] = useState(true);
  const [nightMode, setNightMode] = useState(true);
  const [zoomingRoom, setZoomingRoom] = useState<string | null>(null);
  const [activeBubble, setActiveBubble] = useState<BubbleState>(null);
  const [isVisible, setIsVisible] = useState(true);
  const [reducedEffects, setReducedEffects] = useState(false);
  // Enhancement 4: keyboard navigation state
  const [focusedRoomIndex, setFocusedRoomIndex] = useState<number | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const idleIndexRef = useRef(0);

  // Detect reduced-motion / low-power on mount
  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lowPower = navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency < 4;
    setReducedEffects(prefersReduced || lowPower);
  }, []);

  // N key toggles day/night mode (global)
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "n" || e.key === "N") setNightMode((v) => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);

  // IntersectionObserver for animation pausing
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(
      ([entry]) => setIsVisible(entry.isIntersecting),
      { threshold: 0.1 }
    );
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // earn:exec-activity and idle hints disabled — no visible exec sprites yet
  // (re-enable when sprites are re-introduced)

  const handleRoomClick = useCallback(
    (roomId: string, href: string) => {
      if (zoomingRoom) return;
      setZoomingRoom(roomId);
      setTimeout(() => {
        router.push(href);
        setZoomingRoom(null);
      }, 320);
    },
    [router, zoomingRoom]
  );

  const handleExecClick = useCallback((exec: ExecData) => {
    window.dispatchEvent(
      new CustomEvent("earn:open-with-context", {
        detail: {
          execName: exec.name,
          prompt: `You are advising ${exec.name}. What can I help you with today?`,
        },
      })
    );
  }, []);

  // Enhancement 4: keyboard handler on container
  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "n" || e.key === "N") return; // let the global handler handle it

    if (e.key === "Escape") {
      setFocusedRoomIndex(null);
      return;
    }

    if (e.key === "Enter" && focusedRoomIndex !== null) {
      const room = ROOMS[focusedRoomIndex];
      if (room) handleRoomClick(room.id, room.href);
      return;
    }

    if (!["ArrowLeft", "ArrowRight", "ArrowUp", "ArrowDown"].includes(e.key)) return;
    e.preventDefault();

    const currentIndex = focusedRoomIndex ?? 0;

    // Find current row and col
    let currentRow = 0;
    let currentCol = 0;
    for (let r = 0; r < ROOM_ROWS.length; r++) {
      const colIdx = ROOM_ROWS[r].indexOf(currentIndex);
      if (colIdx !== -1) {
        currentRow = r;
        currentCol = colIdx;
        break;
      }
    }

    let newIndex = currentIndex;

    if (e.key === "ArrowLeft") {
      const row = ROOM_ROWS[currentRow];
      const newCol = (currentCol - 1 + row.length) % row.length;
      newIndex = row[newCol];
    } else if (e.key === "ArrowRight") {
      const row = ROOM_ROWS[currentRow];
      const newCol = (currentCol + 1) % row.length;
      newIndex = row[newCol];
    } else if (e.key === "ArrowUp") {
      const newRow = (currentRow - 1 + ROOM_ROWS.length) % ROOM_ROWS.length;
      const targetRow = ROOM_ROWS[newRow];
      const clampedCol = Math.min(currentCol, targetRow.length - 1);
      newIndex = targetRow[clampedCol];
    } else if (e.key === "ArrowDown") {
      const newRow = (currentRow + 1) % ROOM_ROWS.length;
      const targetRow = ROOM_ROWS[newRow];
      const clampedCol = Math.min(currentCol, targetRow.length - 1);
      newIndex = targetRow[clampedCol];
    }

    setFocusedRoomIndex(newIndex);
  }, [focusedRoomIndex, handleRoomClick]);

  if (booting) {
    return <ExecutiveHQBoot onComplete={() => setBooting(false)} />;
  }

  return (
    <div
      ref={containerRef}
      tabIndex={0}
      onKeyDown={handleKeyDown}
      onFocus={() => { if (focusedRoomIndex === null) setFocusedRoomIndex(0); }}
      onBlur={() => setFocusedRoomIndex(null)}
      className={isVisible ? "" : "hq-paused"}
      style={{
        position: "relative",
        width: "100%",
        aspectRatio: "1",
        fontFamily: "monospace",
        overflow: "hidden",
        outline: "none",
      }}
    >
      <style>{`
        @keyframes monitor-pulse {
          0%, 100% { opacity: 0.6; }
          50%      { opacity: 1; }
        }
        @keyframes light-flicker {
          0%, 97%, 100% { opacity: 1; }
          98%           { opacity: 0.88; }
          99%           { opacity: 0.97; }
        }
        @keyframes particle-rise {
          0%   { transform: translateY(0) translateX(0); opacity: 0.7; }
          100% { transform: translateY(-50px) translateX(var(--drift, 8px)); opacity: 0; }
        }
        @keyframes room-breathe {
          0%, 100% { opacity: 0; }
          50%      { opacity: 0.07; }
        }
        @keyframes bubble-in {
          from { opacity: 0; transform: translateX(-50%) translateY(4px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        @keyframes fadeSlideUp {
          from { opacity: 0; transform: translateX(-50%) translateY(6px); }
          to   { opacity: 1; transform: translateX(-50%) translateY(0); }
        }
        .hq-paused * { animation-play-state: paused !important; }
      `}</style>

      {/* Day/night toggle hint */}
      <button
        onClick={() => setNightMode((v) => !v)}
        title="Toggle day/night (N)"
        style={{
          position: "absolute",
          top: 8,
          right: 8,
          zIndex: 20,
          background: "rgba(6,9,15,0.7)",
          border: "1px solid rgba(180,147,32,0.4)",
          borderRadius: 4,
          color: "#b49320",
          fontFamily: "monospace",
          fontSize: 10,
          padding: "2px 7px",
          cursor: "pointer",
          letterSpacing: "0.05em",
        }}
      >
        {nightMode ? "☀ DAY" : "☾ NIGHT"}
      </button>

      {/* Office background image */}
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={nightMode ? "/assets/fundexecs/office/office-night.png" : "/assets/fundexecs/office/office-day.png"}
        alt="FundExecs Office"
        draggable={false}
        style={{
          position: "absolute",
          inset: 0,
          width: "100%",
          height: "100%",
          imageRendering: "pixelated",
          userSelect: "none",
          pointerEvents: "none",
          zIndex: 0,
        }}
      />

      {/* Transparent grid overlay — rooms portion only, banner left alone */}
      <div
        style={{
          position: "absolute",
          top: "1.5%",
          left: "1.5%",
          right: "1.5%",
          bottom: "19%",
          display: "grid",
          gridTemplateColumns: "1fr 1fr 1fr 1fr",
          gridTemplateRows: "36fr 26fr 17fr",
          gridTemplateAreas:
            '"ceo board trading research" "investor ops legal marketing" ". reception reception ."',
          gap: "1%",
          zIndex: 1,
        }}
      >
        {ROOMS.map((room, idx) => (
          <RoomCell
            key={room.id}
            room={room}
            roomIndex={idx}
            onExecClick={handleExecClick}
            onRoomClick={handleRoomClick}
            zoomingRoom={zoomingRoom}
            activeBubble={activeBubble}
            reducedEffects={reducedEffects}
            nightMode={nightMode}
            isFocused={focusedRoomIndex === idx}
            activity={ROOM_ACTIVITY[room.id] ?? 0}
          />
        ))}
      </div>
    </div>
  );
}
