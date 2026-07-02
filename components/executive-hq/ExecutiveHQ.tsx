"use client";

import React, { useState, useCallback, useEffect, useRef } from "react";
import { useRouter } from "next/navigation";
import { ExecutiveHQBoot } from "./ExecutiveHQBoot";

// ─── Types ────────────────────────────────────────────────────────────────────

type ExecData = {
  id: string; name: string; shortName: string; sprite: string;
  themeColor: string; href: string; bobDelay: string;
  wanderDelay: string; hint: string; walkDuration: string;
};
type RoomData = {
  id: string; label: string; href: string; gridArea: string;
  accentColor: string; monitorColor: string; executives: ExecData[];
};
type BubbleState = { execId: string; text: string } | null;

// ─── Constants ────────────────────────────────────────────────────────────────

const HQ_BOOT_SEEN_KEY = "fx-hq-boot-seen-v1";

const ROOM_ACTIVITY: Record<string, 0 | 1 | 2 | 3> = {
  ceo: 1, boardroom: 2, trading: 3, research: 1,
  investor: 2, ops: 3, legal: 0, marketing: 2, reception: 1,
};

// Musical tones for ambient hover sound (Hz)
const ROOM_FREQUENCIES: Record<string, number> = {
  ceo: 261, boardroom: 294, trading: 330, research: 349,
  investor: 392, ops: 440, legal: 494, marketing: 523, reception: 220,
};

// Translate values to pan the full office image to center on each room
// Formula: translate(50%-cx, 50%-cy) where cx/cy are approximate room centers
// Grid: top 2%, bottom 18% → 80% height. Rows: 38/30/32fr. 4 equal cols.
const ROOM_ZOOM_TRANSLATE: Record<string, string> = {
  ceo:       "translate(36%,   33%)",
  boardroom: "translate(12%,   33%)",
  trading:   "translate(-12%,  33%)",
  research:  "translate(-36%,  33%)",
  legal:     "translate(36%,   6%)",
  ops:       "translate(0%,    6%)",
  marketing: "translate(-36%,  6%)",
  investor:  "translate(36%,  -19%)",
  reception: "translate(0%,   -19%)",
};

const LIGHT_FLICKER_DELAYS = ["0s","2.3s","5.1s","1.7s","3.8s","4.2s","0.9s","6.1s","1.2s"];

const ROOM_ROWS = [[0,1,2,3],[4,5,6,7],[8]];

// ─── Exec data ────────────────────────────────────────────────────────────────

const E: Record<string, ExecData> = {
  earnest:           { id:"earnest-fundmaker",   name:"Earnest Fundmaker",   shortName:"Earnest",      sprite:"/assets/fundexecs/characters/earnest-fundmaker/sprite.png",   themeColor:"#fbbf24", href:"/dashboard",                 bobDelay:"0s",   wanderDelay:"0s",   hint:"Onboarding complete ✓",    walkDuration:"7s"  },
  executiveAdvisor:  { id:"executive-advisor",   name:"Executive Advisor",   shortName:"Exec Advisor", sprite:"/assets/fundexecs/characters/executive-advisor/sprite.png",   themeColor:"#a855f7", href:"/dashboard",                 bobDelay:"0.6s", wanderDelay:"1.2s", hint:"Market signal detected",   walkDuration:"8s"  },
  dealSourcer:       { id:"deal-sourcer",        name:"Deal Sourcer",        shortName:"Deal",         sprite:"/assets/fundexecs/characters/deal-sourcer/sprite.png",        themeColor:"#f97316", href:"/dashboard/deals",           bobDelay:"0.2s", wanderDelay:"0.5s", hint:"3 targets in pipeline",    walkDuration:"9s"  },
  capitalRaiser:     { id:"capital-raiser",      name:"Capital Raiser",      shortName:"Capital",      sprite:"/assets/fundexecs/characters/capital-raiser/sprite.png",      themeColor:"#ec4899", href:"/dashboard/deals",           bobDelay:"0.8s", wanderDelay:"2.1s", hint:"Fund room ready",          walkDuration:"10s" },
  workflowInstructor:{ id:"workflow-instructor", name:"Workflow Instructor", shortName:"Workflow",     sprite:"/assets/fundexecs/characters/workflow-instructor/sprite.png", themeColor:"#ef4444", href:"/dashboard",                 bobDelay:"0.4s", wanderDelay:"0.9s", hint:"SOP updated",              walkDuration:"11s" },
  capitalConnector:  { id:"capital-connector",   name:"Capital Connector",   shortName:"Cap. Conn.",   sprite:"/assets/fundexecs/characters/capital-connector/sprite.png",   themeColor:"#14b8a6", href:"/dashboard/capital",         bobDelay:"0.4s", wanderDelay:"1.8s", hint:"Follow-up due",            walkDuration:"12s" },
  automater:         { id:"automater",           name:"Automater",           shortName:"Automater",    sprite:"/assets/fundexecs/characters/automater/sprite.png",           themeColor:"#22c55e", href:"/dashboard/automation",      bobDelay:"0.1s", wanderDelay:"0.3s", hint:"2 workflows ran today",    walkDuration:"13s" },
  rainmaker:         { id:"rainmaker",           name:"Rainmaker",           shortName:"Rainmaker",    sprite:"/assets/fundexecs/characters/rainmaker/sprite.png",           themeColor:"#fbbf24", href:"/dashboard/capital",         bobDelay:"0.5s", wanderDelay:"1.5s", hint:"High-value lead flagged",  walkDuration:"7.5s"},
  prDirector:        { id:"pr-director",         name:"Firm Narrator",       shortName:"Narrative",    sprite:"/assets/fundexecs/characters/pr-director/sprite.png",         themeColor:"#f97316", href:"/dashboard/marketing",       bobDelay:"0s",   wanderDelay:"0.7s", hint:"LP narrative ready",       walkDuration:"8.5s"},
  leadGenerator:     { id:"lead-generator",      name:"LP Connector",        shortName:"LP Conn.",     sprite:"/assets/fundexecs/characters/lead-generator/sprite.png",      themeColor:"#f97316", href:"/dashboard/marketing",       bobDelay:"0.3s", wanderDelay:"2.4s", hint:"LP outreach queued",       walkDuration:"9.5s"},
  seoDisruptor:      { id:"seo-disruptor",       name:"Market Authority",    shortName:"Authority",    sprite:"/assets/fundexecs/characters/seo-disruptor/sprite.png",       themeColor:"#f97316", href:"/dashboard/marketing",       bobDelay:"0.6s", wanderDelay:"1.1s", hint:"Firm visibility up",       walkDuration:"10.5s"},
  curator:           { id:"curator",             name:"Content Lead",        shortName:"Content",      sprite:"/assets/fundexecs/characters/curator/sprite.png",             themeColor:"#f97316", href:"/dashboard/marketing",       bobDelay:"0.9s", wanderDelay:"3.0s", hint:"Thought piece drafted",    walkDuration:"11.5s"},
  investorRelations: { id:"investor-relations",  name:"Investor Relations",  shortName:"IR",           sprite:"/assets/fundexecs/characters/investor-relations/sprite.png",  themeColor:"#f59e0b", href:"/dashboard/investor-relations",bobDelay:"0.3s",wanderDelay:"0.6s", hint:"LP update ready",          walkDuration:"12.5s"},
  officeManager:     { id:"office-manager",      name:"Office Manager",      shortName:"Manager",      sprite:"/assets/fundexecs/characters/office-manager/sprite.svg",      themeColor:"#94a3b8", href:"/dashboard",                 bobDelay:"0.1s", wanderDelay:"0.2s", hint:"All systems operational",  walkDuration:"9s"  },
};

const ROOMS: RoomData[] = [
  { id:"ceo",       label:"CEO OFFICE",       href:"/dashboard",                   gridArea:"ceo",      accentColor:"#b45309", monitorColor:"#fbbf24", executives:[E.earnest] },
  { id:"boardroom", label:"BOARDROOM",        href:"/dashboard",                   gridArea:"board",    accentColor:"#3b82f6", monitorColor:"#93c5fd", executives:[E.executiveAdvisor] },
  { id:"trading",   label:"TRADING FLOOR",   href:"/dashboard/deals",             gridArea:"trading",  accentColor:"#14b8a6", monitorColor:"#5eead4", executives:[E.dealSourcer,E.capitalRaiser] },
  { id:"research",  label:"RESEARCH HUB",    href:"/dashboard",                   gridArea:"research", accentColor:"#6366f1", monitorColor:"#a5b4fc", executives:[E.workflowInstructor] },
  { id:"investor",  label:"INVESTOR LOUNGE", href:"/dashboard/capital",           gridArea:"investor", accentColor:"#a855f7", monitorColor:"#d8b4fe", executives:[E.capitalConnector] },
  { id:"ops",       label:"OPERATIONS HUB",  href:"/dashboard/automation",        gridArea:"ops",      accentColor:"#22c55e", monitorColor:"#86efac", executives:[E.automater,E.officeManager] },
  { id:"legal",     label:"LEGAL CORNER",    href:"/dashboard/capital",           gridArea:"legal",    accentColor:"#ef4444", monitorColor:"#fca5a5", executives:[E.rainmaker] },
  { id:"marketing", label:"MARKETING SALOON",href:"/dashboard/marketing",         gridArea:"marketing",accentColor:"#f97316", monitorColor:"#fdba74", executives:[E.prDirector,E.leadGenerator,E.seoDisruptor,E.curator] },
  { id:"reception", label:"RECEPTION",       href:"/dashboard/investor-relations",gridArea:"reception",accentColor:"#b49320", monitorColor:"#fcd34d", executives:[E.investorRelations] },
];


// ─── Mini-map ─────────────────────────────────────────────────────────────────

const GOLD = "#c9a84c";
const GOLD_DIM = "#c9a84c55";

// HQ room id → virtual office room key mapping (for occupancy lookup)
const HQ_TO_VIRTUAL_KEY: Record<string, string> = { investor: "office" };

function MiniMap({ activeId, nightMode, occupancy = {} }: { activeId: string | null; nightMode: boolean; occupancy?: Record<string, number> }) {
  const W = 28; const H = 18; const G = 2;
  const cells = [
    {id:"ceo",       c:0,r:0,s:1,col:"#c9a84c"},
    {id:"boardroom", c:1,r:0,s:1,col:"#a8c4e0"},
    {id:"trading",   c:2,r:0,s:1,col:"#5eead4"},
    {id:"research",  c:3,r:0,s:1,col:"#a5b4fc"},
    {id:"legal",     c:0,r:1,s:1,col:"#fca5a5"},
    {id:"ops",       c:1,r:1,s:2,col:"#86efac"},
    {id:"marketing", c:3,r:1,s:1,col:"#fdba74"},
    {id:"investor",  c:0,r:2,s:1,col:"#d8b4fe"},
    {id:"reception", c:1,r:2,s:2,col:"#c9a84c"},
  ];
  const tw = 4*(W+G)-G;
  const th = 3*(H+G)-G;
  return (
    <div style={{
      position:"absolute", bottom:16, right:16, zIndex:20,
      background:"rgba(8,6,4,0.88)",
      border:`1px solid ${GOLD_DIM}`,
      borderRadius:4, padding:"7px 8px", pointerEvents:"none",
      backdropFilter:"blur(8px)",
      boxShadow:`0 0 20px rgba(201,168,76,0.08), inset 0 1px 0 rgba(201,168,76,0.12)`,
    }}>
      <div style={{ fontFamily:"Georgia,serif", fontSize:6.5, color:GOLD_DIM, marginBottom:4, letterSpacing:"0.18em", textTransform:"uppercase" }}>Floor Plan</div>
      <svg width={tw} height={th} viewBox={`0 0 ${tw} ${th}`}>
        {cells.map(cell=>{
          const active = cell.id === activeId;
          const virtualKey = HQ_TO_VIRTUAL_KEY[cell.id] ?? cell.id;
          const count = occupancy[virtualKey] ?? 0;
          const cellX = cell.c*(W+G);
          const cellY = cell.r*(H+G);
          const cellW = W*cell.s+G*(cell.s-1);
          return (
            <g key={cell.id}>
              <rect
                x={cellX} y={cellY}
                width={cellW} height={H}
                fill={active ? `${cell.col}40` : `${cell.col}18`}
                stroke={active ? cell.col : `${cell.col}40`}
                strokeWidth={active ? 1 : 0.5}
                rx={1}
              />
              {count > 0 && (
                <g>
                  <circle cx={cellX+cellW-4} cy={cellY+4} r={3.5} fill="#22c55e" opacity={0.9} />
                  <text x={cellX+cellW-4} y={cellY+4+2} textAnchor="middle" fontSize={4} fill="#fff" fontFamily="monospace">{count > 9 ? "9+" : count}</text>
                </g>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
}

// ─── ExecAvatar ───────────────────────────────────────────────────────────────

function getInitials(name: string): string {
  return name.split(" ").map(w => w[0]).join("").slice(0, 2).toUpperCase();
}

function ExecAvatar({
  exec,
  size,
  onClick,
  activeBubble,
}: {
  exec: ExecData;
  size: number;
  onClick: () => void;
  activeBubble: BubbleState;
}) {
  const speaking = activeBubble?.execId === exec.id;
  const initials = getInitials(exec.name);
  const fontSize = Math.round(size * 0.32);
  return (
    <button
      type="button"
      onClick={(e) => { e.stopPropagation(); onClick(); }}
      title={`${exec.name} — ${exec.hint}`}
      aria-label={`${exec.name}. ${exec.hint}`}
      style={{
        position: "relative",
        width: size,
        height: size,
        borderRadius: "50%",
        border: `1.5px solid ${exec.themeColor}${speaking ? "cc" : "66"}`,
        background: `radial-gradient(circle at 40% 35%, ${exec.themeColor}22 0%, rgba(8,6,4,0.85) 70%)`,
        boxShadow: speaking
          ? `0 0 0 2px ${exec.themeColor}55, 0 0 18px ${exec.themeColor}44`
          : `0 0 0 0px transparent`,
        cursor: "pointer",
        pointerEvents: "auto",
        transform: speaking ? "scale(1.08)" : "scale(1)",
        transition: "transform 180ms ease, box-shadow 180ms ease, border-color 180ms ease",
        display: "flex",
        alignItems: "center",
        justifyContent: "center",
        flexShrink: 0,
      }}
    >
      <span style={{
        fontFamily: "Georgia, 'Times New Roman', serif",
        fontSize,
        fontWeight: 600,
        color: exec.themeColor,
        letterSpacing: "0.04em",
        userSelect: "none",
        lineHeight: 1,
      }}>
        {initials}
      </span>
      {/* Active status dot */}
      <span style={{
        position: "absolute",
        bottom: 1,
        right: 1,
        width: Math.max(6, size * 0.17),
        height: Math.max(6, size * 0.17),
        borderRadius: "50%",
        background: "#22c55e",
        border: "1.5px solid rgba(8,6,4,0.9)",
      }} />
    </button>
  );
}

// ─── RoomCell ─────────────────────────────────────────────────────────────────

function RoomCell({
  room, roomIndex, onExecClick, onRoomClick, zoomingRoom,
  activeBubble, reducedEffects, nightMode, isFocused, activity,
  onHoverChange, debugGrid,
}: {
  room: RoomData; roomIndex: number;
  onExecClick: (exec: ExecData) => void;
  onRoomClick: (roomId: string, href: string) => void;
  zoomingRoom: string | null; activeBubble: BubbleState;
  reducedEffects: boolean; nightMode: boolean;
  isFocused: boolean; activity: 0 | 1 | 2 | 3;
  onHoverChange: (id: string | null) => void;
  debugGrid: boolean;
}) {
  const [hovered, setHovered] = useState(false);
  const [roomNight, setRoomNight] = useState(nightMode);
  const mode = roomNight ? "night" : "day";
  const flickerDelay = LIGHT_FLICKER_DELAYS[roomIndex % LIGHT_FLICKER_DELAYS.length];
  const isZooming = zoomingRoom === room.id;
  const breatheDuration = activity >= 3 ? "2s" : "4s";

  const handleEnter = () => { setHovered(true); onHoverChange(room.id); };
  const handleLeave = () => { setHovered(false); onHoverChange(null); };

  const handleToggleNight = (e: React.MouseEvent) => {
    e.stopPropagation();
    setRoomNight(v => !v);
  };

  const isActive = hovered || isFocused;
  const goldBorder = `rgba(201,168,76,${isActive ? 0.7 : activity >= 3 ? 0.3 : 0.15})`;
  const shimmerOpacity = isActive ? 0.18 : activity >= 2 ? 0.06 : 0.02;

  const DEBUG_COLORS = ["#ff4444","#44ff44","#4488ff","#ffaa00","#ff44ff","#44ffff","#ff8844","#88ff44","#aa44ff"];
  let boxShadow: string;
  if (debugGrid)        boxShadow = `inset 0 0 0 2px ${DEBUG_COLORS[roomIndex % DEBUG_COLORS.length]}`;
  else if (isFocused)   boxShadow = `inset 0 0 0 1.5px ${GOLD}, 0 0 32px rgba(201,168,76,0.25), 0 8px 40px rgba(0,0,0,0.6)`;
  else if (hovered)     boxShadow = `inset 0 0 0 1px ${GOLD}aa, 0 0 24px rgba(201,168,76,0.18), 0 8px 40px rgba(0,0,0,0.5)`;
  else                  boxShadow = "none";

  return (
    <div
      onClick={() => onRoomClick(room.id, room.href)}
      onMouseEnter={handleEnter}
      onMouseLeave={handleLeave}
      style={{
        gridArea: room.gridArea,
        position: "relative",
        cursor: "pointer",
        background: "transparent",
        overflow: "hidden",
        boxShadow,
        borderRadius: isActive ? 2 : 0,
        transform: hovered ? "scale(1.018)" : "scale(1)",
        zIndex: isZooming ? 30 : hovered ? 5 : undefined,
        opacity: isZooming ? 0 : 1,
        transition: isZooming
          ? "opacity 0.3s ease-in 0.1s"
          : "transform 0.2s cubic-bezier(0.2,0,0,1), box-shadow 0.25s ease, opacity 0s",
      }}
    >
{/* Hover brightness lift */}
      <div style={{
        position:"absolute", inset:0, zIndex:1, pointerEvents:"none",
        background: hovered ? "rgba(255,240,180,0.04)" : "transparent",
        transition:"background 0.25s ease",
      }}/>

      {/* Gold shimmer — only visible on hover/focus */}
      {isActive && (
        <div style={{
          position:"absolute", inset:0, pointerEvents:"none", zIndex:2,
          background:`linear-gradient(135deg, rgba(201,168,76,0.14) 0%, transparent 50%, rgba(201,168,76,0.07) 100%)`,
          transition:"opacity 0.3s ease",
        }}/>
      )}

      {/* Hover radial glow */}
      {isActive && (
        <div style={{
          position:"absolute", inset:0, pointerEvents:"none", zIndex:3,
          background:`radial-gradient(ellipse at 50% 70%, rgba(201,168,76,0.09) 0%, transparent 65%)`,
        }}/>
      )}

      {/* Cinematic scan line on entry */}
      {isZooming && (
        <div style={{
          position:"absolute", left:0, right:0, height:1,
          background:`linear-gradient(90deg, transparent 0%, ${GOLD}88 20%, #fff8e8 50%, ${GOLD}88 80%, transparent 100%)`,
          boxShadow:`0 0 12px ${GOLD}`,
          animation:"door-scan 0.35s ease-in forwards",
          pointerEvents:"none", zIndex:9,
        }}/>
      )}


      {/* Active executives */}
      <div style={{ position:"absolute", bottom:28, left:0, right:0, zIndex:5, display:"flex", justifyContent:"space-around", alignItems:"flex-end", pointerEvents:"none" }}>
        {room.executives.map(exec=>(
          <ExecAvatar key={exec.id} exec={exec} size={44} onClick={()=>onExecClick(exec)}
            activeBubble={activeBubble}/>
        ))}
      </div>

      {/* Bottom glass panel */}
      <div style={{
        position:"absolute", bottom:0, left:0, right:0, zIndex:6,
        background: isActive
          ? "linear-gradient(180deg, rgba(8,6,4,0) 0%, rgba(8,6,4,0.82) 100%)"
          : "linear-gradient(180deg, rgba(8,6,4,0) 0%, rgba(8,6,4,0.65) 100%)",
        backdropFilter: isActive ? "blur(8px)" : "blur(4px)",
        borderTop:`1px solid ${goldBorder}`,
        display:"flex", flexDirection:"column",
        padding:"4px 8px 5px",
        pointerEvents:"none", userSelect:"none",
        transition:"all 0.25s ease",
      }}>
        {/* Gold rule */}
        <div style={{
          width: isActive ? "100%" : "35%", height:1,
          background:`linear-gradient(90deg, ${GOLD}88 0%, transparent 100%)`,
          marginBottom:3,
          transition:"width 0.35s ease",
        }}/>
        <div style={{ display:"flex", alignItems:"center", justifyContent:"space-between", gap:4 }}>
          <div style={{
            fontFamily:"Georgia,'Times New Roman',serif",
            fontSize:8.5, fontWeight:400,
            letterSpacing:"0.14em", textTransform:"uppercase",
            color: isActive ? GOLD : `${GOLD}88`,
            textShadow: isActive ? `0 0 16px ${GOLD}66` : "none",
            transition:"all 0.25s ease",
            flex:1, minWidth:0,
          }}>
            {isZooming ? "Entering…" : room.label}
          </div>
          {/* Activity status badge */}
          {!isZooming && (
            <div style={{
              display:"flex", alignItems:"center", gap:3, flexShrink:0,
            }}>
              <span style={{
                width:5, height:5, borderRadius:"50%", flexShrink:0,
                background: activity >= 3 ? "#22c55e" : activity >= 2 ? "#fbbf24" : activity >= 1 ? "#60a5fa" : "#475569",
                boxShadow: activity >= 2 ? `0 0 5px ${activity >= 3 ? "#22c55e" : "#fbbf24"}88` : "none",
              }}/>
              <span style={{
                fontFamily:"'Courier New',monospace", fontSize:7,
                color:"rgba(255,248,220,0.5)", letterSpacing:"0.04em", whiteSpace:"nowrap",
              }}>
                {room.executives.length} active
              </span>
            </div>
          )}
        </div>
      </div>

      {/* Keyboard focus indicator */}
      {isFocused && !hovered && (
        <div style={{
          position:"absolute", top:5, right:6, zIndex:7, pointerEvents:"none",
          fontFamily:"Georgia,serif", fontSize:6.5, color:GOLD, opacity:0.7,
          letterSpacing:"0.1em", userSelect:"none",
        }}>
          ↵
        </div>
      )}

      {/* Debug grid label — press D to toggle */}
      {debugGrid && (
        <div style={{
          position:"absolute", top:4, left:4, zIndex:10, pointerEvents:"none",
          fontFamily:"monospace", fontSize:9, fontWeight:700,
          color:DEBUG_COLORS[roomIndex % DEBUG_COLORS.length],
          background:"rgba(0,0,0,0.75)", padding:"1px 4px", borderRadius:2,
          userSelect:"none",
        }}>
          {roomIndex}: {room.id}
        </div>
      )}
    </div>
  );
}

// ─── Room positions (% of 16:9 container) for delegation walk ────────────────
const EXEC_ROOM_POS: Record<string, { x: number; y: number }> = {
  "earnest-fundmaker":    { x: 50, y: 45 },
  "executive-advisor":   { x: 37, y: 22 },
  "deal-sourcer":        { x: 56, y: 22 },
  "capital-raiser":      { x: 61, y: 25 },
  "workflow-instructor": { x: 82, y: 22 },
  "capital-connector":   { x: 14, y: 60 },
  "automater":           { x: 47, y: 56 },
  "office-manager":      { x: 53, y: 58 },
  "rainmaker":           { x: 14, y: 52 },
  "pr-director":         { x: 76, y: 55 },
  "lead-generator":      { x: 81, y: 57 },
  "seo-disruptor":       { x: 79, y: 60 },
  "curator":             { x: 86, y: 60 },
  "investor-relations":  { x: 50, y: 77 },
};

// Semicircle arc around Earn — agents in a curved row
const AGENT_ARC: { x: number; y: number }[] = [
  { x: 15, y: 68 }, { x: 26, y: 64 }, { x: 37, y: 61 }, { x: 46, y: 59 },
  { x: 54, y: 59 }, { x: 63, y: 61 }, { x: 74, y: 64 }, { x: 85, y: 68 },
];

function BoardroomScene({
  animPhase, delegateDetail, reducedEffects,
}: {
  animPhase: 'huddle'|'brief'|'dispatch'|'working';
  delegateDetail: { planTitle?: string; steps?: {agent: string; title: string}[] } | null;
  reducedEffects: boolean;
}) {
  const [atArc, setAtArc] = React.useState(false);

  React.useEffect(() => {
    if (animPhase === 'huddle') {
      const t = setTimeout(() => setAtArc(true), 80);
      return () => clearTimeout(t);
    }
    if (animPhase === 'dispatch') setAtArc(false);
  }, [animPhase]);

  const isWalking = (animPhase === 'huddle' && !atArc) || animPhase === 'dispatch';
  const isBriefing = animPhase === 'brief';
  const allExecs = ROOMS.flatMap(r => r.executives);
  const nonEarn = allExecs.filter(ex => ex.id !== 'earnest-fundmaker').slice(0, 8);

  return (
    <div
      aria-live="polite"
      style={{
        position:"absolute", inset:0, zIndex:50,
        background:"rgba(4,3,2,0.82)",
        backdropFilter:"blur(6px)",
      }}
    >
      {/* Phase label */}
      <div style={{
        position:"absolute", top:"8%", left:0, right:0, textAlign:"center",
        fontFamily:"Georgia,'Times New Roman',serif",
        fontSize:10, letterSpacing:"0.28em", textTransform:"uppercase",
        color:GOLD, opacity:0.75,
        animation: "board-in 0.4s ease-out",
      }}>
        {animPhase === 'huddle' ? "Assembling the team…" : isBriefing ? "Earn is briefing the team" : "Agents dispatched"}
      </div>

      {/* Plan title */}
      {delegateDetail?.planTitle && isBriefing && (
        <div style={{
          position:"absolute", top:"14%", left:"10%", right:"10%", textAlign:"center",
          fontFamily:"Georgia,serif", fontSize:14, fontWeight:400,
          color:"rgba(255,248,220,0.9)", letterSpacing:"0.04em",
          textShadow:`0 0 32px ${GOLD}44`,
          animation:"board-in 0.4s ease-out",
        }}>
          {delegateDetail.planTitle}
        </div>
      )}

      {/* Earn — always at center */}
      {(() => {
        const earnPos = atArc ? { x: 50, y: 42 } : (EXEC_ROOM_POS["earnest-fundmaker"] ?? { x: 50, y: 45 });
        const movingRight = 50 > (EXEC_ROOM_POS["earnest-fundmaker"]?.x ?? 50);
        return (
          <div key="earn" style={{
            position:"absolute",
            left:`${earnPos.x}%`,
            top:`${earnPos.y}%`,
            transform:"translate(-50%,-100%)",
            transition: "left 1.4s ease-in-out, top 1.2s ease-in-out",
            zIndex:10,
            display:"flex", flexDirection:"column", alignItems:"center", gap:4,
          }}>
            <div style={{
              width:72, height:72,
              animation: isBriefing ? "earn-brief 0.7s ease-in-out infinite" : (isWalking ? "exec-stride 0.45s linear infinite" : "exec-float 3s ease-in-out infinite"),
              filter:`drop-shadow(0 4px 20px ${E.earnest.themeColor}aa)`,
              transformOrigin:"bottom center",
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={E.earnest.sprite} alt="Earn" width={72} height={72} style={{ objectFit:"contain", display:"block", transform: isWalking && !movingRight ? "scaleX(-1)" : undefined }} />
            </div>
            {isBriefing && (
              <div style={{ fontFamily:"Georgia,serif", fontSize:7, color:GOLD, letterSpacing:"0.14em", textTransform:"uppercase" }}>Earn</div>
            )}
          </div>
        );
      })()}

      {/* Agents */}
      {nonEarn.map((exec, idx) => {
        const roomPos = EXEC_ROOM_POS[exec.id] ?? { x: 50, y: 50 };
        const arcPos = AGENT_ARC[idx] ?? { x: 50, y: 65 };
        const pos = atArc ? arcPos : roomPos;
        const movingRight = arcPos.x > roomPos.x;
        const shouldFlip = isWalking && (animPhase === 'huddle' ? !movingRight : movingRight);
        return (
          <div key={exec.id} style={{
            position:"absolute",
            left:`${pos.x}%`,
            top:`${pos.y}%`,
            transform:"translate(-50%,-100%)",
            transition: "left 1.4s ease-in-out, top 1.2s ease-in-out",
            zIndex:5,
            display:"flex", flexDirection:"column", alignItems:"center", gap:4,
            transitionDelay: `${idx * 0.08}s`,
          }}>
            <div style={{
              width:48, height:48,
              animation: isWalking ? "exec-stride 0.45s linear infinite" : "exec-float 3s ease-in-out infinite",
              filter:`drop-shadow(0 2px 12px ${exec.themeColor}88) drop-shadow(0 1px 2px rgba(0,0,0,0.9))`,
              transformOrigin:"bottom center",
              animationDelay: exec.bobDelay,
            }}>
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={exec.sprite} alt={exec.name} width={48} height={48} style={{ objectFit:"contain", display:"block", transform: shouldFlip ? "scaleX(-1)" : undefined }} />
            </div>
            {(isBriefing || animPhase === 'dispatch') && (
              <div style={{ fontFamily:"Georgia,serif", fontSize:6, color:`${exec.themeColor}cc`, letterSpacing:"0.1em", textTransform:"uppercase", maxWidth:48, textAlign:"center", whiteSpace:"nowrap", overflow:"hidden", textOverflow:"ellipsis" }}>
                {exec.shortName}
              </div>
            )}
          </div>
        );
      })}

      {/* Steps list during brief */}
      {delegateDetail?.steps?.length && isBriefing ? (
        <div style={{
          position:"absolute", bottom:"8%", left:"50%", transform:"translateX(-50%)",
          display:"flex", flexDirection:"column", gap:5, width:"min(380px,80%)",
        }}>
          {delegateDetail.steps.map((st, i) => {
            const agentData = ROOMS.flatMap(r=>r.executives).find(ex=>
              ex.id.replace(/-/g,'') === st.agent.replace(/_/g,'') ||
              ex.shortName.toLowerCase().includes(st.agent.toLowerCase().split('_')[0])
            );
            const color = agentData?.themeColor ?? GOLD;
            return (
              <div key={i} style={{
                display:"flex", alignItems:"center", gap:10,
                background:"rgba(201,168,76,0.04)", border:`1px solid ${color}28`,
                borderRadius:3, padding:"4px 10px",
                animation:`board-in 0.3s ease-out ${i * 0.08}s both`,
              }}>
                <div style={{ width:5, height:5, borderRadius:"50%", background:color, flexShrink:0 }}/>
                <div style={{ fontFamily:"'Courier New',monospace", fontSize:8.5, color:"rgba(255,248,220,0.65)", letterSpacing:"0.06em", flex:1, minWidth:0, overflow:"hidden", textOverflow:"ellipsis", whiteSpace:"nowrap" }}>
                  {st.title}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {/* Gold rule top/bottom */}
      <div style={{ position:"absolute", top:"6%", left:"20%", right:"20%", height:1, background:`linear-gradient(90deg,transparent,${GOLD}66,transparent)` }}/>
      <div style={{ position:"absolute", bottom:"6%", left:"20%", right:"20%", height:1, background:`linear-gradient(90deg,transparent,${GOLD}66,transparent)` }}/>
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ExecutiveHQ({
  onNavigateRoom,
  roomOccupancy = {},
}: {
  onNavigateRoom?: (hqRoomId: string) => void;
  roomOccupancy?: Record<string, number>;
} = {}) {
  const router = useRouter();
  const [booting, setBooting]             = useState(() => {
    if (typeof window === "undefined") return true;
    return sessionStorage.getItem(HQ_BOOT_SEEN_KEY) !== "1";
  });
  const [nightMode, setNightMode]         = useState(() => new Date().getHours() >= 18);
  const [zoomingRoom, setZoomingRoom]     = useState<string | null>(null);
  const [activeBubble, setActiveBubble]   = useState<BubbleState>(null);
  const [isVisible, setIsVisible]         = useState(true);
  const [reducedEffects, setReducedEffects] = useState(false);
  const [focusedRoomIndex, setFocusedRoomIndex] = useState<number | null>(null);
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const [soundMuted, setSoundMuted]       = useState(true);
  const [debugGrid, setDebugGrid]         = useState(false);
  const [animPhase, setAnimPhase]         = useState<'idle'|'huddle'|'brief'|'dispatch'|'working'>('idle');
  const [delegateDetail, setDelegateDetail] = useState<{ planTitle?: string; steps?: {agent: string; title: string}[] } | null>(null);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lowPower = navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency < 4;
    setReducedEffects(prefersReduced || lowPower);
  }, []);

  // Pause animations when off-screen
  useEffect(() => {
    const el = containerRef.current;
    if (!el) return;
    const obs = new IntersectionObserver(([e]) => setIsVisible(e.isIntersecting), { threshold: 0.1 });
    obs.observe(el);
    return () => obs.disconnect();
  }, []);

  // Ambient room tone on hover
  const playRoomTone = useCallback((roomId: string) => {
    if (soundMuted) return;
    try {
      if (!audioCtxRef.current) audioCtxRef.current = new AudioContext();
      const ctx = audioCtxRef.current;
      const osc  = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.connect(gain);
      gain.connect(ctx.destination);
      osc.type = "sine";
      osc.frequency.value = ROOM_FREQUENCIES[roomId] ?? 300;
      gain.gain.setValueAtTime(0.04, ctx.currentTime);
      gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.35);
      osc.start(ctx.currentTime);
      osc.stop(ctx.currentTime + 0.35);
    } catch { /* AudioContext not supported */ }
  }, [soundMuted]);

  const handleHoverChange = useCallback((id: string | null) => {
    setHoveredRoomId(id);
    if (id) playRoomTone(id);
  }, [playRoomTone]);

  const handleRoomClick = useCallback((roomId: string, href: string) => {
    if (zoomingRoom) return;
    if (onNavigateRoom) {
      onNavigateRoom(roomId);
      return;
    }
    setZoomingRoom(roomId);
    setTimeout(() => { router.push(href); setZoomingRoom(null); }, 420);
  }, [router, zoomingRoom, onNavigateRoom]);

  const handleExecClick = useCallback((exec: ExecData) => {
    setActiveBubble({ execId: exec.id, text: exec.hint });
    setTimeout(() => setActiveBubble(null), 3000);
    window.dispatchEvent(new CustomEvent("earn:open-with-context", {
      detail: { execName: exec.name, prompt: `You are advising ${exec.name}. What can I help you with today?` },
    }));
  }, []);

  // Listen for earn-delegate: run the institutional animation sequence
  useEffect(() => {
    function onDelegate(e: Event) {
      const detail = (e as CustomEvent).detail;
      setDelegateDetail(detail);
      setAnimPhase('huddle');
      setTimeout(() => setAnimPhase('brief'),    1500);
      setTimeout(() => setAnimPhase('dispatch'), 4500);
      setTimeout(() => setAnimPhase('working'),  6500);
      setTimeout(() => { setAnimPhase('idle'); setDelegateDetail(null); }, 10000);
    }
    window.addEventListener('earn-delegate', onDelegate);
    return () => window.removeEventListener('earn-delegate', onDelegate);
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "n" || e.key === "N") { setNightMode(v => !v); return; }
    if (e.key === "d" || e.key === "D") { setDebugGrid(v => !v); return; }
    if (e.key === "Escape") { setFocusedRoomIndex(null); return; }
    if (e.key === "Enter" && focusedRoomIndex !== null) {
      const room = ROOMS[focusedRoomIndex];
      if (room) handleRoomClick(room.id, room.href);
      return;
    }
    if (!["ArrowLeft","ArrowRight","ArrowUp","ArrowDown"].includes(e.key)) return;
    e.preventDefault();
    const cur = focusedRoomIndex ?? 0;
    let curRow = 0, curCol = 0;
    for (let r = 0; r < ROOM_ROWS.length; r++) {
      const c = ROOM_ROWS[r].indexOf(cur);
      if (c !== -1) { curRow = r; curCol = c; break; }
    }
    let next = cur;
    if (e.key === "ArrowLeft")  { const row = ROOM_ROWS[curRow]; next = row[(curCol-1+row.length)%row.length]; }
    if (e.key === "ArrowRight") { const row = ROOM_ROWS[curRow]; next = row[(curCol+1)%row.length]; }
    if (e.key === "ArrowUp")    { const nr = (curRow-1+ROOM_ROWS.length)%ROOM_ROWS.length; next = ROOM_ROWS[nr][Math.min(curCol,ROOM_ROWS[nr].length-1)]; }
    if (e.key === "ArrowDown")  { const nr = (curRow+1)%ROOM_ROWS.length; next = ROOM_ROWS[nr][Math.min(curCol,ROOM_ROWS[nr].length-1)]; }
    setFocusedRoomIndex(next);
  }, [focusedRoomIndex, handleRoomClick]);

  if (booting) {
    return (
      <ExecutiveHQBoot
        onComplete={() => {
          try { sessionStorage.setItem(HQ_BOOT_SEEN_KEY, "1"); } catch { /* ignore */ }
          setBooting(false);
        }}
      />
    );
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
        aspectRatio: "16 / 9",
        fontFamily: "monospace",
        overflow: "hidden",
        outline: "none",
        background: nightMode ? "#010207" : "#0a0908",
      }}
    >
      <style>{`
        @keyframes monitor-pulse  { 0%,100%{opacity:0.5} 50%{opacity:0.9} }
        @keyframes light-flicker  { 0%,97%,100%{opacity:1} 98%{opacity:0.88} 99%{opacity:0.96} }
        @keyframes room-breathe   { 0%,100%{opacity:0} 50%{opacity:1} }
        @keyframes bubble-in      { from{opacity:0;transform:translateX(-50%) translateY(4px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes fadeSlideUp    { from{opacity:0;transform:translateX(-50%) translateY(6px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes door-scan      { 0%{top:-2px;opacity:1} 100%{top:100%;opacity:0} }
        @keyframes hq-scanline    { 0%{transform:translateY(-100%)} 100%{transform:translateY(200%)} }
        @keyframes gold-particle  { 0%{transform:translate(0,0) scale(1);opacity:0} 15%{opacity:1} 85%{opacity:0.7} 100%{transform:translate(var(--pdx),var(--pdy)) scale(0.4);opacity:0} }
        @keyframes pulse-ring-lux { 0%{r:12;opacity:0.6;stroke-width:1.5} 100%{r:40;opacity:0;stroke-width:0.5} }
        @keyframes hud-sweep      { 0%{transform:translateX(-100%)} 100%{transform:translateX(400%)} }
        @keyframes brand-fade     { from{opacity:0;transform:translateY(-4px)} to{opacity:1;transform:translateY(0)} }
        @keyframes exec-float     { 0%,100%{transform:translateY(0)} 50%{transform:translateY(-4px)} }
        @keyframes exec-breathe   { 0%,100%{transform:scale(1)} 50%{transform:scale(1.03)} }
        @keyframes exec-glow      { 0%,100%{opacity:0.4} 50%{opacity:0.85} }
        @keyframes exec-talk      { 0%,100%{transform:scale(1) translateY(0)} 25%{transform:scale(1.06) translateY(-3px)} 75%{transform:scale(0.97) translateY(1px)} }
        @keyframes exec-stride    { 0%,100%{transform:rotate(-5deg) translateY(0px)} 25%{transform:rotate(-1deg) translateY(-4px)} 50%{transform:rotate(5deg) translateY(0px)} 75%{transform:rotate(1deg) translateY(-4px)} }
        @keyframes earn-brief     { 0%,100%{transform:scale(1) rotate(0deg) translateY(0)} 20%{transform:scale(1.08) rotate(-3deg) translateY(-5px)} 50%{transform:scale(1.1) rotate(1deg) translateY(-7px)} 80%{transform:scale(1.07) rotate(-1deg) translateY(-3px)} }
        @keyframes exec-huddle    { 0%{transform:translateX(0)} 100%{transform:translateX(var(--huddle-dx,0))} }
        @keyframes board-in       { from{opacity:0;transform:scale(0.94)} to{opacity:1;transform:scale(1)} }
        @keyframes board-out      { from{opacity:1;transform:scale(1)} to{opacity:0;transform:scale(1.04)} }
        @keyframes dispatch-glow  { 0%{opacity:0;transform:scale(0.8)} 30%{opacity:1} 70%{opacity:0.6} 100%{opacity:0;transform:scale(1.6)} }
        @keyframes gold-pulse-ring{ 0%{r:18;opacity:0.8;stroke-width:2} 100%{r:56;opacity:0;stroke-width:0.5} }
        .hq-paused * { animation-play-state: paused !important; }
      `}</style>

      {/* Full-office PNG background (walls, corridors, lobby) */}
      <img
        src={`/assets/fundexecs/office/rooms/${nightMode ? "night" : "day"}/office-${nightMode ? "night" : "day"}-empty.png`}
        alt=""
        aria-hidden="true"
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: nightMode ? "contain" : "cover", objectPosition: "center center",
          pointerEvents: "none", userSelect: "none",
          filter: nightMode ? "brightness(0.88) saturate(0.88)" : "brightness(0.95) saturate(0.97)",
          transformOrigin: "center center",
          transform: zoomingRoom
            ? `scale(3.5) ${ROOM_ZOOM_TRANSLATE[zoomingRoom] ?? ""}`
            : "scale(1) translate(0,0)",
          transition: zoomingRoom
            ? "transform 0.45s cubic-bezier(0.4,0,0.6,1)"
            : "transform 0s",
        }}
      />

      {/* ── Luxury cinematic vignette ── */}
      <div aria-hidden="true" style={{
        position:"absolute", inset:0, zIndex:2, pointerEvents:"none",
        background:"radial-gradient(ellipse 85% 70% at 50% 45%, transparent 30%, rgba(4,3,2,0.72) 100%)",
      }}/>

      {/* ── Subtle scanline HUD overlay ── */}
      {!reducedEffects && (
        <div aria-hidden="true" style={{
          position:"absolute", inset:0, zIndex:2, pointerEvents:"none", overflow:"hidden",
          background:"repeating-linear-gradient(0deg, transparent, transparent 2px, rgba(201,168,76,0.018) 2px, rgba(201,168,76,0.018) 3px)",
        }}>
          <div style={{
            position:"absolute", left:0, right:0, height:"25%",
            background:"linear-gradient(180deg, transparent 0%, rgba(201,168,76,0.05) 50%, transparent 100%)",
            animation:"hq-scanline 6s linear infinite",
          }}/>
        </div>
      )}

      {/* ── HUD sweep line (top) ── */}
      {!reducedEffects && (
        <div aria-hidden="true" style={{
          position:"absolute", top:0, left:0, right:0, height:1, zIndex:3, pointerEvents:"none", overflow:"hidden",
        }}>
          <div style={{
            position:"absolute", top:0, width:"25%", height:"100%",
            background:`linear-gradient(90deg, transparent, ${GOLD}55, transparent)`,
            animation:"hud-sweep 8s ease-in-out 2s infinite",
          }}/>
        </div>
      )}

      {/* ── Controls (top right) ── */}
      <div style={{ position:"absolute", top:10, right:12, zIndex:20, display:"flex", gap:6, alignItems:"center" }}>
        <button
          onClick={() => setSoundMuted(v => !v)}
          title={soundMuted ? "Enable ambient sound" : "Mute sound"}
          style={{
            background:"rgba(8,6,4,0.8)", backdropFilter:"blur(8px)",
            border:`1px solid ${GOLD_DIM}`, borderRadius:2,
            color:"rgba(255,248,220,0.5)", fontFamily:"Georgia,serif",
            fontSize:9, padding:"3px 8px", cursor:"pointer", letterSpacing:"0.12em",
            transition:"all 0.2s ease",
          }}
        >
          {soundMuted ? "♩" : "♪"}
        </button>
        <button
          onClick={() => setNightMode(v => !v)}
          title="Toggle day/night (N)"
          style={{
            background:"rgba(8,6,4,0.8)", backdropFilter:"blur(8px)",
            border:`1px solid ${GOLD}66`, borderRadius:2,
            color:GOLD, fontFamily:"Georgia,serif",
            fontSize:9, padding:"3px 9px", cursor:"pointer", letterSpacing:"0.12em",
            boxShadow:`0 0 12px ${GOLD}22`,
            transition:"all 0.2s ease",
          }}
        >
          {nightMode ? "Day" : "Night"}
        </button>
      </div>

      {/* Mini-map */}
      <MiniMap activeId={hoveredRoomId ?? (focusedRoomIndex !== null ? ROOMS[focusedRoomIndex]?.id ?? null : null)} nightMode={nightMode} occupancy={roomOccupancy} />

      {/* ── Interactive room grid overlay ── */}
      <div style={{
        position: "absolute",
        inset: 0,
        display: "grid",
        gridTemplateColumns: "1fr 1fr 1fr 1fr",
        gridTemplateRows: "38fr 30fr 32fr",
        gridTemplateAreas: `
          "ceo     board    trading  research"
          "legal   ops      ops      marketing"
          "investor reception reception ."
        `,
        zIndex: 4,
      }}>
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
            activity={(ROOM_ACTIVITY[room.id] ?? 0) as 0 | 1 | 2 | 3}
            onHoverChange={handleHoverChange}
            debugGrid={debugGrid}
          />
        ))}
      </div>

      {/* ── Boardroom delegation scene ── */}
      {(animPhase === 'huddle' || animPhase === 'brief' || animPhase === 'dispatch') && (
        <BoardroomScene
          animPhase={animPhase}
          delegateDetail={delegateDetail}
          reducedEffects={reducedEffects}
        />
      )}
    </div>
  );
}
