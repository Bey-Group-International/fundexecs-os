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
type RoomStats = { label: string; value: string | number; trend?: "up" | "down" | "flat" };

// ─── Constants ────────────────────────────────────────────────────────────────

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

const ROOM_ACTIVITY: Record<string, 0 | 1 | 2 | 3> = {
  ceo: 1, boardroom: 2, trading: 3, research: 1,
  investor: 2, ops: 3, legal: 0, marketing: 2, reception: 1,
};

// Musical tones for ambient hover sound (Hz)
const ROOM_FREQUENCIES: Record<string, number> = {
  ceo: 261, boardroom: 294, trading: 330, research: 349,
  investor: 392, ops: 440, legal: 494, marketing: 523, reception: 220,
};

const ROOM_TRANSFORM_ORIGINS: Record<string, string> = {
  ceo: "top left", boardroom: "top center", trading: "top right",
  research: "top right", investor: "top left", ops: "top center",
  legal: "top right", marketing: "top right", reception: "bottom center",
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
  prDirector:        { id:"pr-director",         name:"PR Director",         shortName:"PR",           sprite:"/assets/fundexecs/characters/pr-director/sprite.png",         themeColor:"#f97316", href:"/dashboard/marketing",       bobDelay:"0s",   wanderDelay:"0.7s", hint:"Story opportunity",        walkDuration:"8.5s"},
  leadGenerator:     { id:"lead-generator",      name:"Lead Generator",      shortName:"Lead",         sprite:"/assets/fundexecs/characters/lead-generator/sprite.png",      themeColor:"#f97316", href:"/dashboard/marketing",       bobDelay:"0.3s", wanderDelay:"2.4s", hint:"12 leads captured",        walkDuration:"9.5s"},
  seoDisruptor:      { id:"seo-disruptor",       name:"SEO Disruptor",       shortName:"SEO",          sprite:"/assets/fundexecs/characters/seo-disruptor/sprite.png",       themeColor:"#f97316", href:"/dashboard/marketing",       bobDelay:"0.6s", wanderDelay:"1.1s", hint:"Rankings improved",        walkDuration:"10.5s"},
  curator:           { id:"curator",             name:"Curator",             shortName:"Curator",      sprite:"/assets/fundexecs/characters/curator/sprite.png",             themeColor:"#f97316", href:"/dashboard/marketing",       bobDelay:"0.9s", wanderDelay:"3.0s", hint:"Event scheduled",          walkDuration:"11.5s"},
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

// ─── Room background PNG mapping ─────────────────────────────────────────────

const ROOM_BACKGROUNDS: Record<string, string> = {
  ceo:       "ceo-office",
  boardroom: "boardroom",
  trading:   "trading-floor",
  research:  "research-hub",
  investor:  "reception-lounge",
  ops:       "operations-hub",
  legal:     "legal-corner",
  marketing: "marketing-saloon",
  reception: "reception-lounge",
};

function roomBgSrc(roomId: string, mode: "day" | "night"): string {
  const name = ROOM_BACKGROUNDS[roomId] ?? roomId;
  return `/assets/fundexecs/office/rooms/${mode}/${name}-${mode}-empty.png`;
}

// ─── Mini-map ─────────────────────────────────────────────────────────────────

function MiniMap({ activeId, nightMode }: { activeId: string | null; nightMode: boolean }) {
  const W = 20; const H = 13; const G = 2;
  const cells = [
    {id:"ceo",       c:0,r:0,s:1,col:"#b45309"},
    {id:"boardroom", c:1,r:0,s:1,col:"#3b82f6"},
    {id:"trading",   c:2,r:0,s:1,col:"#14b8a6"},
    {id:"research",  c:3,r:0,s:1,col:"#6366f1"},
    {id:"investor",  c:0,r:1,s:1,col:"#a855f7"},
    {id:"ops",       c:1,r:1,s:1,col:"#22c55e"},
    {id:"legal",     c:2,r:1,s:1,col:"#ef4444"},
    {id:"marketing", c:3,r:1,s:1,col:"#f97316"},
    {id:"reception", c:1,r:2,s:2,col:"#b49320"},
  ];
  const tw = 4*(W+G)-G;
  const th = 3*(H+G)-G;
  return (
    <div style={{ position:"absolute", bottom:8, right:8, zIndex:20, background:"rgba(6,9,15,0.82)", border:"1px solid rgba(255,255,255,0.08)", borderRadius:4, padding:"4px 5px", pointerEvents:"none" }}>
      <div style={{ fontFamily:"monospace", fontSize:6, color:"rgba(255,255,255,0.35)", marginBottom:3, letterSpacing:"0.12em" }}>FLOOR MAP</div>
      <svg width={tw} height={th} viewBox={`0 0 ${tw} ${th}`}>
        {cells.map(cell=>{
          const active = cell.id === activeId;
          return (
            <rect key={cell.id}
              x={cell.c*(W+G)} y={cell.r*(H+G)}
              width={W*cell.s+G*(cell.s-1)} height={H}
              fill={active ? cell.col : `${cell.col}35`}
              stroke={active ? cell.col : `${cell.col}55`}
              strokeWidth={active ? 1 : 0.5}
            />
          );
        })}
      </svg>
    </div>
  );
}

// ─── ExecAvatar (hidden until sprites re-introduced) ─────────────────────────

function ExecAvatar(_: { exec: ExecData; size: number; onClick: () => void; activeBubble: BubbleState; reducedEffects: boolean; nightMode: boolean }) {
  return null;
}

// ─── RoomCell ─────────────────────────────────────────────────────────────────

function RoomCell({
  room, roomIndex, onExecClick, onRoomClick, zoomingRoom,
  activeBubble, reducedEffects, nightMode, isFocused, activity,
  onHoverChange,
}: {
  room: RoomData; roomIndex: number;
  onExecClick: (exec: ExecData) => void;
  onRoomClick: (roomId: string, href: string) => void;
  zoomingRoom: string | null; activeBubble: BubbleState;
  reducedEffects: boolean; nightMode: boolean;
  isFocused: boolean; activity: 0 | 1 | 2 | 3;
  onHoverChange: (id: string | null) => void;
}) {
  const mode = nightMode ? "night" : "day";
  const [hovered, setHovered] = useState(false);
  const flickerDelay = LIGHT_FLICKER_DELAYS[roomIndex % LIGHT_FLICKER_DELAYS.length];
  const isZooming = zoomingRoom === room.id;
  const transformOrigin = ROOM_TRANSFORM_ORIGINS[room.id] ?? "center center";
  const breatheDuration = activity >= 3 ? "2s" : "4s";
  const stats = ROOM_STATS[room.id];
  const trendArrow = stats?.trend === "up" ? "↑" : stats?.trend === "down" ? "↓" : "→";

  const handleEnter = () => { setHovered(true); onHoverChange(room.id); };
  const handleLeave = () => { setHovered(false); onHoverChange(null); };

  let boxShadow: string;
  if (isFocused)        boxShadow = `inset 0 0 0 2px ${room.accentColor}, 0 0 0 1px white`;
  else if (hovered)     boxShadow = `inset 0 0 0 2px ${room.accentColor}cc, 0 0 20px ${room.accentColor}40`;
  else if (activity>=3) boxShadow = `inset 0 0 0 1px ${room.accentColor}55, 0 0 10px ${room.accentColor}25`;
  else                  boxShadow = `inset 0 0 0 1px ${room.accentColor}20`;

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
        transform: isZooming ? "scale(6)" : hovered ? "scale(1.015)" : "scale(1)",
        transformOrigin,
        zIndex: isZooming ? 30 : hovered ? 5 : undefined,
        opacity: isZooming ? 0 : 1,
        transition: isZooming
          ? "transform 0.4s cubic-bezier(0.4,0,1,1), opacity 0.35s ease-in 0.05s"
          : "transform 0.15s ease, box-shadow 0.2s ease, opacity 0s",
      }}
    >
      {/* Room-specific PNG background */}
      <img
        src={roomBgSrc(room.id, mode)}
        alt=""
        aria-hidden="true"
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: "cover", objectPosition: "center top",
          pointerEvents: "none", userSelect: "none",
          zIndex: 0,
        }}
      />

      {/* Subtle breathe tint — very low opacity so map shows through */}
      {!reducedEffects && (
        <div style={{
          position:"absolute", inset:0, background: room.accentColor, opacity:0,
          animation:`room-breathe ${breatheDuration} ease-in-out infinite`,
          animationDelay:`${roomIndex*0.45}s`, pointerEvents:"none", zIndex:1,
        }}/>
      )}

      {/* Light flicker */}
      <div style={{
        position:"absolute", inset:0, background:"rgba(255,255,200,0.03)",
        animation:`light-flicker 8s ease-in-out infinite ${flickerDelay}`,
        pointerEvents:"none", zIndex:1,
      }}/>

      {/* Hover glow */}
      {hovered && (
        <div style={{
          position:"absolute", inset:0,
          background:`radial-gradient(ellipse at center, ${room.accentColor}15 0%, transparent 65%)`,
          pointerEvents:"none", zIndex:2,
        }}/>
      )}

      {/* Door-scan line on entry */}
      {isZooming && (
        <div style={{
          position:"absolute", left:0, right:0, height:2,
          background:`linear-gradient(90deg, transparent 0%, ${room.accentColor} 30%, white 50%, ${room.accentColor} 70%, transparent 100%)`,
          animation:"door-scan 0.3s ease-in forwards",
          pointerEvents:"none", zIndex:8,
        }}/>
      )}

      {/* Hover preview card */}
      {hovered && stats && (
        <div style={{
          position:"absolute", bottom:"calc(100% - 20px)", left:"50%",
          transform:"translateX(-50%)",
          background:"rgba(6,9,15,0.92)",
          border:`1px solid ${room.accentColor}55`,
          fontFamily:"monospace", fontSize:8, padding:"5px 8px",
          whiteSpace:"nowrap", zIndex:12, pointerEvents:"none",
          animation:"fadeSlideUp 0.15s ease-out",
          color:"#e2e8f0", textAlign:"center", minWidth:80,
        }}>
          <div style={{ color:room.accentColor, fontWeight:700, letterSpacing:"0.1em", marginBottom:2 }}>{room.label}</div>
          <div style={{ opacity:0.8, marginBottom:3 }}>{stats.value} {stats.label} {trendArrow}</div>
          <div style={{ color:room.accentColor, opacity:0.9, letterSpacing:"0.08em" }}>→ ENTER</div>
        </div>
      )}

      {/* Exec avatars (hidden for now) */}
      <div style={{ position:"absolute", bottom:24, left:0, right:0, zIndex:4, display:"flex", justifyContent:"space-around", alignItems:"flex-end", pointerEvents:"none" }}>
        {room.executives.map(exec=>(
          <ExecAvatar key={exec.id} exec={exec} size={42} onClick={()=>onExecClick(exec)}
            activeBubble={activeBubble} reducedEffects={reducedEffects} nightMode={nightMode}/>
        ))}
      </div>

      {/* Bottom frosted-glass info bar */}
      <div style={{
        position:"absolute", bottom:0, left:0, right:0, zIndex:6,
        background:`rgba(6,9,15,${hovered?"0.88":"0.72"})`,
        backdropFilter:"blur(6px)",
        borderTop:`1px solid ${room.accentColor}${hovered?"55":"22"}`,
        display:"flex", alignItems:"center", justifyContent:"space-between",
        padding:"3px 6px",
        pointerEvents:"none", userSelect:"none",
        transition:"background 0.2s, border-color 0.2s",
      }}>
        <div style={{
          fontFamily:"monospace", fontSize:7, fontWeight:700,
          letterSpacing:"0.12em", textTransform:"uppercase",
          color: room.accentColor,
          textShadow: hovered ? `0 0 8px ${room.accentColor}80` : "none",
          transition:"text-shadow 0.2s",
        }}>
          {isZooming ? "ENTERING..." : room.label}
        </div>
        {stats && (
          <div style={{ fontFamily:"monospace", fontSize:7, letterSpacing:"0.06em", color:room.accentColor, opacity:0.8 }}>
            {stats.value} {stats.label} {trendArrow}
          </div>
        )}
      </div>

      {/* Keyboard focus indicator */}
      {isFocused && !hovered && (
        <div style={{
          position:"absolute", top:4, right:4, zIndex:6, pointerEvents:"none",
          fontFamily:"monospace", fontSize:6, color:"white", opacity:0.6,
          letterSpacing:"0.08em", userSelect:"none",
        }}>
          [↵]
        </div>
      )}
    </div>
  );
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ExecutiveHQ() {
  const router = useRouter();
  const [booting, setBooting]             = useState(true);
  const [nightMode, setNightMode]         = useState(() => new Date().getHours() >= 18);
  const [zoomingRoom, setZoomingRoom]     = useState<string | null>(null);
  const [activeBubble]                    = useState<BubbleState>(null);
  const [isVisible, setIsVisible]         = useState(true);
  const [reducedEffects, setReducedEffects] = useState(false);
  const [focusedRoomIndex, setFocusedRoomIndex] = useState<number | null>(null);
  const [hoveredRoomId, setHoveredRoomId] = useState<string | null>(null);
  const [soundMuted, setSoundMuted]       = useState(true);
  const containerRef = useRef<HTMLDivElement>(null);
  const audioCtxRef  = useRef<AudioContext | null>(null);

  useEffect(() => {
    const prefersReduced = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    const lowPower = navigator.hardwareConcurrency !== undefined && navigator.hardwareConcurrency < 4;
    setReducedEffects(prefersReduced || lowPower);
  }, []);

  // N = day/night toggle
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "n" || e.key === "N") setNightMode(v => !v);
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
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
    setZoomingRoom(roomId);
    setTimeout(() => { router.push(href); setZoomingRoom(null); }, 420);
  }, [router, zoomingRoom]);

  const handleExecClick = useCallback((exec: ExecData) => {
    window.dispatchEvent(new CustomEvent("earn:open-with-context", {
      detail: { execName: exec.name, prompt: `You are advising ${exec.name}. What can I help you with today?` },
    }));
  }, []);

  const handleKeyDown = useCallback((e: React.KeyboardEvent<HTMLDivElement>) => {
    if (e.key === "n" || e.key === "N") return;
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

  if (booting) return <ExecutiveHQBoot onComplete={() => setBooting(false)} />;

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
        height: "clamp(480px, calc(100svh - 160px), 920px)",
        fontFamily: "monospace",
        overflow: "hidden",
        outline: "none",
        background: nightMode ? "#050810" : "#0d0d1a",
      }}
    >
      <style>{`
        @keyframes monitor-pulse { 0%,100%{opacity:0.5} 50%{opacity:0.9} }
        @keyframes light-flicker  { 0%,97%,100%{opacity:1} 98%{opacity:0.88} 99%{opacity:0.96} }
        @keyframes room-breathe   { 0%,100%{opacity:0} 50%{opacity:0.06} }
        @keyframes bubble-in      { from{opacity:0;transform:translateX(-50%) translateY(4px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes fadeSlideUp    { from{opacity:0;transform:translateX(-50%) translateY(6px)} to{opacity:1;transform:translateX(-50%) translateY(0)} }
        @keyframes door-scan      { 0%{top:-2px;opacity:1} 100%{top:100%;opacity:0} }
        .hq-paused * { animation-play-state: paused !important; }
      `}</style>

      {/* Full-office PNG background (walls, corridors, lobby) */}
      <img
        src={`/assets/fundexecs/office/office-${nightMode ? "night" : "day"}.png`}
        alt=""
        aria-hidden="true"
        style={{
          position: "absolute", inset: 0,
          width: "100%", height: "100%",
          objectFit: "cover", objectPosition: "center top",
          pointerEvents: "none", userSelect: "none",
        }}
      />

      {/* Controls row — top right */}
      <div style={{ position:"absolute", top:8, right:8, zIndex:20, display:"flex", gap:4 }}>
        {/* Sound toggle */}
        <button
          onClick={() => setSoundMuted(v => !v)}
          title={soundMuted ? "Enable ambient sound" : "Mute sound"}
          style={{ background:"rgba(6,9,15,0.75)", border:"1px solid rgba(255,255,255,0.15)", borderRadius:4, color:"rgba(255,255,255,0.55)", fontFamily:"monospace", fontSize:10, padding:"2px 6px", cursor:"pointer", letterSpacing:"0.05em" }}
        >
          {soundMuted ? "♪ OFF" : "♪ ON"}
        </button>
        {/* Day/night toggle */}
        <button
          onClick={() => setNightMode(v => !v)}
          title="Toggle day/night (N)"
          style={{ background:"rgba(6,9,15,0.75)", border:"1px solid rgba(180,147,32,0.4)", borderRadius:4, color:"#b49320", fontFamily:"monospace", fontSize:10, padding:"2px 7px", cursor:"pointer", letterSpacing:"0.05em" }}
        >
          {nightMode ? "☀ DAY" : "☾ NIGHT"}
        </button>
      </div>

      {/* Transparent grid overlay — rooms portion */}
      <div style={{
        position:"absolute",
        top:"1.5%", left:"1.5%", right:"1.5%", bottom:"19%",
        display:"grid",
        gridTemplateColumns:"1fr 1fr 1fr 1fr",
        gridTemplateRows:"36fr 26fr 17fr",
        gridTemplateAreas:'"ceo board trading research" "investor ops legal marketing" ". reception reception ."',
        gap:"1%",
        zIndex:3,
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
            activity={ROOM_ACTIVITY[room.id] ?? 0}
            onHoverChange={handleHoverChange}
          />
        ))}
      </div>

      {/* Mini-map */}
      <MiniMap activeId={hoveredRoomId ?? (focusedRoomIndex !== null ? ROOMS[focusedRoomIndex]?.id ?? null : null)} nightMode={nightMode} />
    </div>
  );
}
