"use client";

import React, { useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { ExecutiveHQBoot } from "./ExecutiveHQBoot";

type ExecData = {
  id: string;
  name: string;
  shortName: string;
  card: string;
  themeColor: string;
  href: string;
  bobDelay: string;
};

type RoomData = {
  id: string;
  label: string;
  sublabel: string;
  href: string;
  gridArea: string;
  floorColor: string;
  accentColor: string;
  deskColor: string;
  executives: ExecData[];
};

const E: Record<string, ExecData> = {
  earnest: {
    id: "earnest-fundmaker",
    name: "Earnest Fundmaker",
    shortName: "Earnest",
    card: "/assets/fundexecs/characters/earnest-fundmaker/card.png",
    themeColor: "#fbbf24",
    href: "/dashboard",
    bobDelay: "0s",
  },
  executiveAdvisor: {
    id: "executive-advisor",
    name: "Executive Advisor",
    shortName: "Exec Advisor",
    card: "/assets/fundexecs/characters/executive-advisor/card.png",
    themeColor: "#a855f7",
    href: "/dashboard",
    bobDelay: "0.6s",
  },
  dealSourcer: {
    id: "deal-sourcer",
    name: "Deal Sourcer",
    shortName: "Deal",
    card: "/assets/fundexecs/characters/deal-sourcer/card.png",
    themeColor: "#f97316",
    href: "/dashboard/deals",
    bobDelay: "0.2s",
  },
  capitalRaiser: {
    id: "capital-raiser",
    name: "Capital Raiser",
    shortName: "Capital",
    card: "/assets/fundexecs/characters/capital-raiser/card.png",
    themeColor: "#ec4899",
    href: "/dashboard/fund-room",
    bobDelay: "0.8s",
  },
  workflowInstructor: {
    id: "workflow-instructor",
    name: "Workflow Instructor",
    shortName: "Workflow",
    card: "/assets/fundexecs/characters/workflow-instructor/card.png",
    themeColor: "#ef4444",
    href: "/dashboard",
    bobDelay: "0.4s",
  },
  capitalConnector: {
    id: "capital-connector",
    name: "Capital Connector",
    shortName: "Capital Conn.",
    card: "/assets/fundexecs/characters/capital-connector/card.png",
    themeColor: "#14b8a6",
    href: "/dashboard/capital",
    bobDelay: "0.4s",
  },
  automater: {
    id: "automater",
    name: "Automater",
    shortName: "Automater",
    card: "/assets/fundexecs/characters/automater/card.png",
    themeColor: "#22c55e",
    href: "/dashboard/automation",
    bobDelay: "0.1s",
  },
  rainmaker: {
    id: "rainmaker",
    name: "Rainmaker",
    shortName: "Rainmaker",
    card: "/assets/fundexecs/characters/rainmaker/card.png",
    themeColor: "#fbbf24",
    href: "/dashboard/capital",
    bobDelay: "0.5s",
  },
  prDirector: {
    id: "pr-director",
    name: "PR Director",
    shortName: "PR",
    card: "/assets/fundexecs/characters/pr-director/card.png",
    themeColor: "#06b6d4",
    href: "/dashboard/marketing",
    bobDelay: "0s",
  },
  leadGenerator: {
    id: "lead-generator",
    name: "Lead Generator",
    shortName: "Lead",
    card: "/assets/fundexecs/characters/lead-generator/card.png",
    themeColor: "#84cc16",
    href: "/dashboard/marketing",
    bobDelay: "0.3s",
  },
  seoDisruptor: {
    id: "seo-disruptor",
    name: "SEO Disruptor",
    shortName: "SEO",
    card: "/assets/fundexecs/characters/seo-disruptor/card.png",
    themeColor: "#8b5cf6",
    href: "/dashboard/marketing",
    bobDelay: "0.6s",
  },
  curator: {
    id: "curator",
    name: "Curator",
    shortName: "Curator",
    card: "/assets/fundexecs/characters/curator/card.png",
    themeColor: "#d946ef",
    href: "/dashboard/marketing",
    bobDelay: "0.9s",
  },
  investorRelations: {
    id: "investor-relations",
    name: "Investor Relations",
    shortName: "IR",
    card: "/assets/fundexecs/characters/investor-relations/card.png",
    themeColor: "#f59e0b",
    href: "/dashboard/investor-relations",
    bobDelay: "0.3s",
  },
};

const ROOMS: RoomData[] = [
  {
    id: "ceo",
    label: "CEO OFFICE",
    sublabel: "Executive Suite",
    href: "/dashboard",
    gridArea: "ceo",
    floorColor: "#0a0703",
    accentColor: "#b45309",
    deskColor: "#2a1204",
    executives: [E.earnest],
  },
  {
    id: "boardroom",
    label: "BOARDROOM",
    sublabel: "Strategy & Intelligence",
    href: "/dashboard/capital",
    gridArea: "board",
    floorColor: "#03060e",
    accentColor: "#3b82f6",
    deskColor: "#060e20",
    executives: [E.executiveAdvisor],
  },
  {
    id: "trading",
    label: "TRADING FLOOR",
    sublabel: "Deal Flow",
    href: "/dashboard/deals",
    gridArea: "trading",
    floorColor: "#020a09",
    accentColor: "#14b8a6",
    deskColor: "#041210",
    executives: [E.dealSourcer, E.capitalRaiser],
  },
  {
    id: "research",
    label: "RESEARCH HUB",
    sublabel: "Intelligence",
    href: "/dashboard",
    gridArea: "research",
    floorColor: "#03060e",
    accentColor: "#6366f1",
    deskColor: "#080a1c",
    executives: [E.workflowInstructor],
  },
  {
    id: "investor",
    label: "INVESTOR LOUNGE",
    sublabel: "Capital Pipeline",
    href: "/dashboard/capital",
    gridArea: "investor",
    floorColor: "#07030d",
    accentColor: "#a855f7",
    deskColor: "#120520",
    executives: [E.capitalConnector],
  },
  {
    id: "ops",
    label: "OPERATIONS HUB",
    sublabel: "Automation",
    href: "/dashboard/automation",
    gridArea: "ops",
    floorColor: "#020a03",
    accentColor: "#22c55e",
    deskColor: "#041206",
    executives: [E.automater],
  },
  {
    id: "legal",
    label: "LEGAL CORNER",
    sublabel: "Compliance",
    href: "/settings",
    gridArea: "legal",
    floorColor: "#0b0303",
    accentColor: "#ef4444",
    deskColor: "#1c0505",
    executives: [E.rainmaker],
  },
  {
    id: "marketing",
    label: "MARKETING SALOON",
    sublabel: "Growth & Brand",
    href: "/dashboard/marketing",
    gridArea: "marketing",
    floorColor: "#0a0603",
    accentColor: "#f97316",
    deskColor: "#1c0c04",
    executives: [E.prDirector, E.leadGenerator, E.seoDisruptor, E.curator],
  },
];

function Monitor({ color }: { color: string }) {
  return (
    <div style={{
      width: 10,
      height: 7,
      background: "#060c14",
      border: `1px solid ${color}50`,
      boxShadow: `0 0 4px ${color}40`,
      flexShrink: 0,
    }} />
  );
}

function ExecAvatar({
  exec,
  size,
  onClick,
}: {
  exec: ExecData;
  size: number;
  onClick: () => void;
}) {
  return (
    <button
      onClick={(e: React.MouseEvent) => { e.stopPropagation(); onClick(); }}
      title={exec.name}
      style={{
        all: "unset",
        cursor: "pointer",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        gap: 2,
        animation: `exec-bob 2.6s ease-in-out infinite`,
        animationDelay: exec.bobDelay,
      }}
    >
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img
        src={exec.card}
        alt={exec.name}
        width={size}
        height={size}
        draggable={false}
        style={{ imageRendering: "pixelated", display: "block", userSelect: "none" }}
      />
      <span style={{
        fontFamily: "monospace",
        fontSize: 7,
        color: exec.themeColor,
        textShadow: `0 0 6px ${exec.themeColor}`,
        textTransform: "uppercase",
        letterSpacing: "0.08em",
        whiteSpace: "nowrap",
        userSelect: "none",
      }}>
        {exec.shortName}
      </span>
    </button>
  );
}

function RoomCell({
  room,
  onExecClick,
  onRoomClick,
}: {
  room: RoomData;
  onExecClick: (exec: ExecData) => void;
  onRoomClick: (href: string) => void;
}) {
  const [hovered, setHovered] = useState(false);
  const execCount = room.executives.length;
  const avatarSize = execCount >= 4 ? 40 : execCount >= 3 ? 44 : 50;
  const deskWidth = execCount >= 4 ? "92%" : execCount >= 2 ? "72%" : "56%";

  return (
    <div
      onClick={() => onRoomClick(room.href)}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        gridArea: room.gridArea,
        position: "relative",
        cursor: "pointer",
        // Floor tiles
        backgroundColor: room.floorColor,
        backgroundImage: `
          linear-gradient(${room.accentColor}14 1px, transparent 1px),
          linear-gradient(90deg, ${room.accentColor}14 1px, transparent 1px)
        `,
        backgroundSize: "20px 20px",
        // Walls
        border: `2px solid ${room.accentColor}${hovered ? "cc" : "55"}`,
        boxShadow: hovered
          ? `inset 0 0 50px ${room.accentColor}18, 0 0 16px ${room.accentColor}28`
          : `inset 0 0 20px ${room.accentColor}06`,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        overflow: "hidden",
        minHeight: 165,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingBottom: 10,
      }}
    >
      {/* Room label */}
      <div style={{
        position: "absolute",
        top: 6,
        left: 7,
        zIndex: 2,
        userSelect: "none",
        lineHeight: 1.5,
      }}>
        <div style={{
          fontFamily: "monospace",
          fontSize: 8,
          fontWeight: 700,
          letterSpacing: "0.2em",
          textTransform: "uppercase",
          color: room.accentColor,
          textShadow: `0 0 10px ${room.accentColor}`,
          opacity: hovered ? 1 : 0.65,
          transition: "opacity 0.15s",
        }}>
          {room.label}
        </div>
        <div style={{
          fontFamily: "monospace",
          fontSize: 7,
          letterSpacing: "0.15em",
          textTransform: "uppercase",
          color: room.accentColor,
          opacity: hovered ? 0.5 : 0.3,
          transition: "opacity 0.15s",
        }}>
          {room.sublabel}
        </div>
      </div>

      {/* Enter indicator */}
      {hovered && (
        <div style={{
          position: "absolute",
          top: 7,
          right: 7,
          fontFamily: "monospace",
          fontSize: 7,
          color: room.accentColor,
          letterSpacing: "0.12em",
          opacity: 0.85,
          userSelect: "none",
        }}>
          → ENTER
        </div>
      )}

      {/* Wall accent lines (top border stripe) */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: `linear-gradient(90deg, ${room.accentColor}00, ${room.accentColor}60, ${room.accentColor}00)`,
      }} />

      {/* Exec avatars at desks */}
      <div style={{
        position: "relative",
        zIndex: 3,
        display: "flex",
        gap: execCount >= 4 ? 4 : 8,
        alignItems: "flex-end",
        marginBottom: 2,
      }}>
        {room.executives.map((exec) => (
          <ExecAvatar
            key={exec.id}
            exec={exec}
            size={avatarSize}
            onClick={() => onExecClick(exec)}
          />
        ))}
      </div>

      {/* Desk surface */}
      <div style={{
        position: "relative",
        zIndex: 2,
        width: deskWidth,
        height: 14,
        background: `linear-gradient(180deg, ${room.deskColor} 0%, color-mix(in srgb, ${room.deskColor} 70%, #000) 100%)`,
        border: `1px solid ${room.accentColor}45`,
        boxShadow: `0 3px 0 rgba(0,0,0,0.6), 0 0 10px ${room.accentColor}18`,
        display: "flex",
        alignItems: "center",
        justifyContent: execCount === 1 ? "center" : "space-around",
        padding: "0 8px",
        gap: 6,
      }}>
        {room.executives.map((exec, i) => (
          <Monitor key={i} color={exec.themeColor} />
        ))}
      </div>

      {/* Floor shadow under desk */}
      <div style={{
        width: deskWidth,
        height: 5,
        background: "rgba(0,0,0,0.55)",
        marginTop: 1,
      }} />
    </div>
  );
}

function ReceptionCell({
  onExecClick,
  onRoomClick,
}: {
  onExecClick: (exec: ExecData) => void;
  onRoomClick: (href: string) => void;
}) {
  const [hovered, setHovered] = useState(false);

  return (
    <div
      onClick={() => onRoomClick("/dashboard")}
      onMouseEnter={() => setHovered(true)}
      onMouseLeave={() => setHovered(false)}
      style={{
        gridArea: "reception",
        position: "relative",
        cursor: "pointer",
        backgroundColor: "#04060e",
        backgroundImage: `
          linear-gradient(#b4932016 1px, transparent 1px),
          linear-gradient(90deg, #b4932016 1px, transparent 1px)
        `,
        backgroundSize: "20px 20px",
        border: `2px solid #b49320${hovered ? "cc" : "50"}`,
        boxShadow: hovered
          ? `inset 0 0 60px #b4932018, 0 0 24px #b4932030`
          : `inset 0 0 30px #b4932008`,
        transition: "border-color 0.15s ease, box-shadow 0.15s ease",
        overflow: "hidden",
        minHeight: 110,
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "flex-end",
        paddingBottom: 12,
      }}
    >
      {/* Top accent */}
      <div style={{
        position: "absolute",
        top: 0,
        left: 0,
        right: 0,
        height: 3,
        background: "linear-gradient(90deg, #b4932000, #b49320aa, #b4932000)",
      }} />

      {/* Room label left */}
      <div style={{
        position: "absolute",
        top: 7,
        left: 10,
        fontFamily: "monospace",
        fontSize: 8,
        fontWeight: 700,
        letterSpacing: "0.2em",
        textTransform: "uppercase",
        color: "#b49320",
        textShadow: "0 0 10px #b49320",
        opacity: hovered ? 1 : 0.6,
        transition: "opacity 0.15s",
        userSelect: "none",
      }}>
        RECEPTION · AFTER HOURS
      </div>

      {/* Centered FundExecs wordmark */}
      <div style={{
        position: "absolute",
        top: 7,
        left: "50%",
        transform: "translateX(-50%)",
        display: "flex",
        alignItems: "center",
        gap: 6,
        fontFamily: "monospace",
        fontSize: 9,
        fontWeight: 700,
        letterSpacing: "0.28em",
        color: "#b49320",
        textShadow: "0 0 10px #b49320",
        textTransform: "uppercase",
        userSelect: "none",
        whiteSpace: "nowrap",
      }}>
        <span style={{ fontSize: 8, opacity: 0.7 }}>⬡</span>
        FUNDEXECS
        <span style={{ fontSize: 8, opacity: 0.7 }}>⬡</span>
      </div>

      {/* IR avatar at desk */}
      <ExecAvatar
        exec={E.investorRelations}
        size={52}
        onClick={() => onExecClick(E.investorRelations)}
      />

      {/* Reception desk — U-shape approximated with CSS */}
      <div style={{
        position: "relative",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        marginTop: 2,
        zIndex: 2,
      }}>
        {/* Main desk top */}
        <div style={{
          width: 180,
          height: 14,
          background: "linear-gradient(180deg, #1c1006 0%, #0e0803 100%)",
          border: "1px solid #b4932055",
          boxShadow: "0 3px 0 rgba(0,0,0,0.6), 0 0 16px #b4932025",
          display: "flex",
          alignItems: "center",
          justifyContent: "space-around",
          padding: "0 16px",
        }}>
          <Monitor color="#b49320" />
          {/* Reception nameplate */}
          <div style={{
            fontFamily: "monospace",
            fontSize: 6,
            color: "#b49320",
            letterSpacing: "0.2em",
            textTransform: "uppercase",
            opacity: 0.7,
            userSelect: "none",
          }}>
            INVESTOR RELATIONS
          </div>
          <Monitor color="#b49320" />
        </div>
        {/* Desk shadow */}
        <div style={{ width: 180, height: 5, background: "rgba(0,0,0,0.6)", marginTop: 1 }} />
      </div>
    </div>
  );
}

type SelectedExec = ExecData | null;

export function ExecutiveHQ() {
  const router = useRouter();
  const [booting, setBooting] = useState(true);
  const [selected, setSelected] = useState<SelectedExec>(null);

  const handleRoomClick = useCallback((href: string) => {
    router.push(href);
  }, [router]);

  if (booting) {
    return <ExecutiveHQBoot onComplete={() => setBooting(false)} />;
  }

  return (
    <div
      style={{
        background: "#010204",
        fontFamily: "var(--font-mono, monospace)",
        position: "relative",
        padding: 10,
      }}
    >
      <style>{`
        @keyframes exec-bob {
          0%, 100% { transform: translateY(0px); }
          50% { transform: translateY(-4px); }
        }
      `}</style>

      {/* Building shell */}
      <div
        style={{
          display: "grid",
          gridTemplateColumns: "repeat(4, 1fr)",
          gridTemplateRows: "1fr 1fr auto",
          gridTemplateAreas: `
            "ceo board trading research"
            "investor ops legal marketing"
            ". reception reception ."
          `,
          gap: 4,
          background: "#010204",
          border: "2px solid #b4932035",
          boxShadow: "0 0 0 1px #b4932015, inset 0 0 100px rgba(180,147,32,0.03)",
          padding: 4,
        }}
      >
        {ROOMS.map((room) => (
          <RoomCell
            key={room.id}
            room={room}
            onExecClick={setSelected}
            onRoomClick={handleRoomClick}
          />
        ))}
        <ReceptionCell
          onExecClick={setSelected}
          onRoomClick={handleRoomClick}
        />
      </div>

      {/* Executive detail overlay */}
      {selected && (
        <div
          onClick={() => setSelected(null)}
          style={{
            position: "fixed",
            inset: 0,
            zIndex: 50,
            background: "rgba(1,2,4,0.88)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            backdropFilter: "blur(2px)",
          }}
        >
          <div
            onClick={(e: React.MouseEvent) => e.stopPropagation()}
            style={{
              background: "#06090f",
              border: `2px solid ${selected.themeColor}70`,
              boxShadow: `0 0 60px ${selected.themeColor}25, inset 0 0 30px ${selected.themeColor}08`,
              padding: 24,
              maxWidth: 280,
              width: "90%",
              display: "flex",
              flexDirection: "column",
              alignItems: "center",
              gap: 14,
            }}
          >
            {/* Corner accents */}
            {["top-left", "top-right", "bottom-left", "bottom-right"].map((pos) => (
              <span
                key={pos}
                style={{
                  position: "absolute",
                  top: pos.includes("top") ? 4 : "auto",
                  bottom: pos.includes("bottom") ? 4 : "auto",
                  left: pos.includes("left") ? 6 : "auto",
                  right: pos.includes("right") ? 6 : "auto",
                  color: selected.themeColor,
                  fontSize: 8,
                  opacity: 0.6,
                  userSelect: "none",
                }}
              >
                ✦
              </span>
            ))}

            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img
              src={selected.card}
              alt={selected.name}
              width={120}
              height={120}
              style={{ imageRendering: "pixelated" }}
              draggable={false}
            />

            <div style={{ textAlign: "center" }}>
              <p style={{
                fontFamily: "monospace",
                fontSize: 13,
                fontWeight: 700,
                color: selected.themeColor,
                textShadow: `0 0 14px ${selected.themeColor}`,
                textTransform: "uppercase",
                letterSpacing: "0.18em",
                margin: 0,
              }}>
                {selected.name}
              </p>
            </div>

            <div style={{ display: "flex", gap: 8, width: "100%" }}>
              <button
                onClick={() => { router.push(selected.href); setSelected(null); }}
                style={{
                  flex: 1,
                  padding: "9px 12px",
                  background: `${selected.themeColor}18`,
                  border: `1px solid ${selected.themeColor}70`,
                  color: selected.themeColor,
                  fontFamily: "monospace",
                  fontSize: 9,
                  textTransform: "uppercase",
                  letterSpacing: "0.18em",
                  cursor: "pointer",
                }}
              >
                Open Workspace
              </button>
              <button
                onClick={() => setSelected(null)}
                style={{
                  padding: "9px 14px",
                  background: "transparent",
                  border: "1px solid #ffffff18",
                  color: "#ffffff50",
                  fontFamily: "monospace",
                  fontSize: 10,
                  cursor: "pointer",
                }}
              >
                ✕
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
