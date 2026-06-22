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

// ─── Inline SVG floor plan ────────────────────────────────────────────────────
// Matches grid overlay: 1.5% margins, 19% bottom lobby, viewBox 0 0 1000 1000

function OfficeSVG({ night }: { night: boolean }) {
  const wall   = night ? "#050810" : "#0d0d1a";
  const lobby  = night ? "#0e0c0a" : "#c0b8b0";

  // Room floor colors
  const fl = night ? {
    ceo:"#1c1408",       board:"#16141a",    trade:"#020810",
    res:"#181510",       inv:"#0a1020",      ops:"#0e0e1a",
    leg:"#120808",       mkt:"#080e0e",      rec:"#181614",
  } : {
    ceo:"#7a5c1e",       board:"#ddd8c8",    trade:"#060e1c",
    res:"#f0eada",       inv:"#162840",      ops:"#181828",
    leg:"#22100e",       mkt:"#0c1e1e",      rec:"#ccc4bc",
  };

  // Furniture / surface colors
  const desk   = night ? "#221c10" : "#8a6020";
  const shelf  = night ? "#2a2018" : "#7a5018";
  const table  = night ? "#1a1c28" : "#c0b8a0";
  const server = night ? "#0c1428" : "#1a2440";
  const sofa   = night ? "#1a2040" : "#2a4070";
  const board  = night ? "#1a1828" : "#f0eada";

  // Screen glow colors
  const gGreen = night ? "#00ff88" : "#00aa55";
  const gBlue  = night ? "#4488ff" : "#2244aa";
  const gAmber = night ? "#ffaa44" : "#cc7700";

  // Gradient opacity for night room lights
  const nlgt = night ? 0.18 : 0;

  return (
    <svg
      viewBox="0 0 1000 1000"
      preserveAspectRatio="xMidYMid slice"
      aria-hidden="true"
      style={{ position:"absolute", inset:0, width:"100%", height:"100%", pointerEvents:"none" }}
    >
      <defs>
        <radialGradient id="rg-ceo"   cx="50%" cy="50%" r="60%"><stop offset="0%" stopColor="#ffd080" stopOpacity={nlgt}/><stop offset="100%" stopColor="#ffd080" stopOpacity="0"/></radialGradient>
        <radialGradient id="rg-board" cx="50%" cy="40%" r="60%"><stop offset="0%" stopColor="#88aaff" stopOpacity={nlgt*0.7}/><stop offset="100%" stopColor="#88aaff" stopOpacity="0"/></radialGradient>
        <radialGradient id="rg-trade" cx="50%" cy="25%" r="70%"><stop offset="0%" stopColor="#00ff88" stopOpacity={nlgt*1.2}/><stop offset="100%" stopColor="#00ff88" stopOpacity="0"/></radialGradient>
        <radialGradient id="rg-res"   cx="50%" cy="50%" r="60%"><stop offset="0%" stopColor="#8888ff" stopOpacity={nlgt*0.6}/><stop offset="100%" stopColor="#8888ff" stopOpacity="0"/></radialGradient>
        <radialGradient id="rg-inv"   cx="50%" cy="50%" r="60%"><stop offset="0%" stopColor="#4466ff" stopOpacity={nlgt*0.8}/><stop offset="100%" stopColor="#4466ff" stopOpacity="0"/></radialGradient>
        <radialGradient id="rg-ops"   cx="35%" cy="45%" r="55%"><stop offset="0%" stopColor="#22ff88" stopOpacity={nlgt}/><stop offset="100%" stopColor="#22ff88" stopOpacity="0"/></radialGradient>
        <radialGradient id="rg-mkt"   cx="50%" cy="50%" r="60%"><stop offset="0%" stopColor="#ff8822" stopOpacity={nlgt*0.7}/><stop offset="100%" stopColor="#ff8822" stopOpacity="0"/></radialGradient>
        <radialGradient id="rg-rec"   cx="50%" cy="50%" r="60%"><stop offset="0%" stopColor="#ffd080" stopOpacity={nlgt*0.6}/><stop offset="100%" stopColor="#ffd080" stopOpacity="0"/></radialGradient>
      </defs>

      {/* ── Base background (walls / corridors) ── */}
      <rect width="1000" height="1000" fill={wall}/>

      {/* ── Lobby floor (bottom 19%) ── */}
      <rect x="0" y="810" width="1000" height="190" fill={lobby}/>
      {/* Lobby tile grid */}
      {[0,1,2,3,4].map(i=><rect key={i} x={i*200} y="810" width="1" height="190" fill="#00000018"/>)}
      {[0,1].map(i=><rect key={i} x="0" y={810+i*63} width="1000" height="1" fill="#00000018"/>)}
      {/* Entrance doors */}
      <rect x="420" y="810" width="160" height="18" fill={night?"#181410":"#d0c8c0"}/>
      <rect x="460" y="806" width="80" height="8"  fill={night?"#888":"#666"} rx={2}/>
      {/* Lobby desk */}
      <rect x="330" y="855" width="340" height="18" fill={desk} rx={2}/>
      <rect x="340" y="847" width="320" height="8"  fill={shelf} rx={1}/>
      {/* Lobby monitor */}
      <rect x="460" y="842" width="40" height="6" fill={gAmber} opacity={0.6}/>
      {/* Lobby plants */}
      <circle cx="50"  cy="900" r="12" fill={night?"#1a4010":"#2a6020"} opacity={0.7}/>
      <circle cx="950" cy="900" r="12" fill={night?"#1a4010":"#2a6020"} opacity={0.7}/>
      {/* Lobby chairs */}
      {[0,1,2,3].map(i=><rect key={i} x={120+i*60} y="900" width="22" height="16" fill={sofa} opacity={0.5} rx={3}/>)}
      {[0,1,2,3].map(i=><rect key={i} x={640+i*60} y="900" width="22" height="16" fill={sofa} opacity={0.5} rx={3}/>)}

      {/* ════════════════════ ROW 1 ════════════════════ */}

      {/* ── CEO OFFICE (x15,y15 235×353) ── */}
      <rect x="15" y="15" width="235" height="353" fill={fl.ceo}/>
      <rect x="15" y="15" width="235" height="353" fill="url(#rg-ceo)"/>
      {/* Wood floor planks */}
      {[1,2,3,4,5].map(i=><rect key={i} x="15" y={15+i*58} width="235" height="1" fill="#00000022"/>)}
      {/* Bookshelf top wall */}
      <rect x="20" y="18" width="105" height="12" fill={shelf} rx={1}/>
      {["#8B4513","#2F4F4F","#800000","#4a4a8a","#556B2F","#8B4513","#4a0000"].map((c,i)=>(
        <rect key={i} x={22+i*14} y="19" width="12" height="10" fill={c} opacity={0.7}/>
      ))}
      {/* L-desk */}
      <rect x="148" y="25" width="95" height="15" fill={desk} rx={1}/>
      <rect x="228" y="25" width="15" height="58" fill={desk} rx={1}/>
      {/* Desk chair */}
      <rect x="162" y="44" width="13" height="13" fill={desk} opacity={0.55} rx={2}/>
      {/* Monitor on desk */}
      <rect x="172" y="28" width="34" height="9"  fill={gAmber} opacity={0.75}/>
      {/* Papers on desk */}
      <rect x="153" y="30" width="16" height="10" fill={night?"#1a1810":"#f0e8d0"} opacity={0.5}/>
      {/* Small meeting table at bottom */}
      <rect x="50"  y="295" width="150" height="10" fill={desk} opacity={0.4} rx={1}/>
      {[0,1,2,3].map(i=><rect key={i} x={55+i*38} y="308" width="14" height="12" fill={desk} opacity={0.35} rx={2}/>)}
      {/* Plant corner */}
      <circle cx="30"  cy="350" r="9"  fill={night?"#1a4a10":"#2d6a1a"} opacity={0.7}/>
      <circle cx="230" cy="350" r="7"  fill={night?"#1a4a10":"#2d6a1a"} opacity={0.6}/>

      {/* ── BOARDROOM (x260,y15 235×353) ── */}
      <rect x="260" y="15" width="235" height="353" fill={fl.board}/>
      <rect x="260" y="15" width="235" height="353" fill="url(#rg-board)"/>
      {/* Marble tile lines */}
      {[1,2,3].map(i=><rect key={i} x="260" y={15+i*88} width="235" height="1" fill="#00000012"/>)}
      {[1,2].map(i=><rect key={i} x={260+i*78} y="15" width="1" height="353" fill="#00000012"/>)}
      {/* Projector screen */}
      <rect x="275" y="17" width="205" height="14" fill={gBlue} opacity={0.55}/>
      <rect x="278" y="19" width="199" height="10" fill={night?"#06081a":"#0a0e28"} rx={1}/>
      <polyline points="283,26 305,21 325,24 348,19 368,23 390,19 412,23 435,20 455,24 472,21" fill="none" stroke={gBlue} strokeWidth="1.5" opacity={0.8}/>
      {/* Conference table */}
      <rect x="300" y="95" width="155" height="125" fill={table} rx={16} stroke={night?"#ffffff10":"#00000018"} strokeWidth="1"/>
      {/* Table surface sheen */}
      <rect x="308" y="103" width="139" height="60" fill={night?"#ffffff05":"#ffffff20"} rx={12}/>
      {/* Chairs — top */}
      {[0,1,2].map(i=><rect key={i} x={315+i*46} y="82"  width="18" height="11" fill={desk} opacity={0.45} rx={2}/>)}
      {/* Chairs — bottom */}
      {[0,1,2].map(i=><rect key={i} x={315+i*46} y="222" width="18" height="11" fill={desk} opacity={0.45} rx={2}/>)}
      {/* Chairs — sides */}
      <rect x="283" y="135" width="14" height="18" fill={desk} opacity={0.45} rx={2}/>
      <rect x="458" y="135" width="14" height="18" fill={desk} opacity={0.45} rx={2}/>
      {/* Laptop + glasses on table */}
      <rect x="360" y="148" width="32" height="20" fill={night?"#181a28":"#888"} rx={1}/>
      <rect x="362" y="150" width="28" height="16" fill={gBlue} opacity={0.5}/>
      {/* Water carafes */}
      <circle cx="308" cy="168" r="4" fill="#6699cc" opacity={0.4}/>
      <circle cx="447" cy="168" r="4" fill="#6699cc" opacity={0.4}/>
      {/* Side credenza */}
      <rect x="263" y="295" width="45" height="55" fill={desk} opacity={0.4} rx={1}/>
      <rect x="263" y="320" width="45" height="1"  fill="#ffffff15"/>

      {/* ── TRADING FLOOR (x505,y15 235×353) ── */}
      <rect x="505" y="15" width="235" height="353" fill={fl.trade}/>
      <rect x="505" y="15" width="235" height="353" fill="url(#rg-trade)"/>
      {/* Large display wall */}
      <rect x="510" y="17" width="225" height="20" fill={gGreen} opacity={0.5}/>
      <rect x="513" y="19" width="219" height="16" fill={night?"#000e04":"#001a08"} rx={1}/>
      <polyline points="518,30 538,24 558,28 578,22 600,26 622,21 644,25 666,22 688,26 710,22 728,26" fill="none" stroke={gGreen} strokeWidth="1.5" opacity={0.85}/>
      <polyline points="518,33 545,29 568,32 592,28 618,31 642,27 665,30 690,27 715,30" fill="none" stroke={gGreen} strokeWidth="0.8" opacity={0.4}/>
      {/* 3 × 3 desk grid */}
      {[0,1,2].map(row=>[0,1,2].map(col=>(
        <g key={`${row}-${col}`}>
          <rect x={518+col*75} y={48+row*90}  width="58" height="13" fill={server} rx={1}/>
          <rect x={522+col*75} y={37+row*90}  width="20" height="10" fill={gGreen} opacity={0.7-row*0.1}/>
          <rect x={546+col*75} y={37+row*90}  width="20" height="10" fill={gGreen} opacity={0.6-row*0.1}/>
        </g>
      )))}
      {/* Lounge / break area bottom */}
      <rect x="520" y="295" width="95"  height="50" fill={night?"#081018":"#0e1828"} rx={3}/>
      <rect x="530" y="305" width="75"  height="30" fill={night?"#060c14":"#0a1420"} rx={2}/>
      <rect x="630" y="295" width="100" height="18" fill={server} rx={2}/>

      {/* ── RESEARCH HUB (x750,y15 235×353) ── */}
      <rect x="750" y="15" width="235" height="353" fill={fl.res}/>
      <rect x="750" y="15" width="235" height="353" fill="url(#rg-res)"/>
      {/* Warm floor lines */}
      {[1,2,3].map(i=><rect key={i} x="750" y={15+i*88} width="235" height="1" fill="#00000015"/>)}
      {/* Perimeter desk — top */}
      <rect x="755" y="18"  width="225" height="13" fill={desk} opacity={0.35} rx={1}/>
      {[0,1,2,3,4].map(i=>(
        <rect key={i} x={760+i*42} y="20" width="28" height="9" fill={gBlue} opacity={0.45}/>
      ))}
      {/* Whiteboard */}
      <rect x="800" y="55"  width="130" height="60" fill={board} stroke="#00000018" strokeWidth="1" rx={1}/>
      <polyline points="812,90 830,75 852,82 872,70 895,78 920,72" fill="none" stroke={gBlue} strokeWidth="1.5" opacity={0.6}/>
      <rect x="812" y="98" width="110" height="1" fill="#00000020"/>
      {/* Central work table */}
      <rect x="800" y="160" width="130" height="80" fill={table} opacity={0.5} rx={3}/>
      {[0,1,2].map(i=><rect key={i} x={808+i*44} y="150" width="16" height="9" fill={desk} opacity={0.4} rx={1}/>)}
      {[0,1,2].map(i=><rect key={i} x={808+i*44} y="242" width="16" height="9" fill={desk} opacity={0.4} rx={1}/>)}
      {/* Bookshelf right wall */}
      <rect x="973" y="18"  width="12"  height="340" fill={shelf} opacity={0.35} rx={1}/>
      {[0,1,2,3,4,5,6,7,8].map(i=>(
        <rect key={i} x="974" y={22+i*36} width="10" height="32" fill={["#8B4513","#2F4F4F","#800000","#4a4a8a","#3a6a3a","#8B4513","#4a0000","#2a4a6a","#6a2a6a"][i]} opacity={0.6}/>
      ))}

      {/* ════════════════════ ROW 2 ════════════════════ */}

      {/* ── INVESTOR LOUNGE (x15,y378 235×255) ── */}
      <rect x="15"  y="378" width="235" height="255" fill={fl.inv}/>
      <rect x="15"  y="378" width="235" height="255" fill="url(#rg-inv)"/>
      {/* Display / TV wall */}
      <rect x="20"  y="381" width="225" height="15" fill={gBlue} opacity={0.5}/>
      <rect x="23"  y="383" width="219" height="11" fill={night?"#06081a":"#08102a"} rx={1}/>
      <polyline points="28,390 55,385 78,388 105,383 135,387 165,383 195,387 220,384 240,387" fill="none" stroke={gBlue} strokeWidth="1.5" opacity={0.8}/>
      {/* Sofa L + R */}
      <rect x="22"  y="408" width="90"  height="22" fill={sofa} rx={3}/>
      <rect x="162" y="408" width="80"  fill={sofa} height="22" rx={3}/>
      <rect x="22"  y="408" width="22"  height="65" fill={sofa} rx={3}/>
      <rect x="220" y="408" width="22"  height="65" fill={sofa} rx={3}/>
      {/* Coffee table */}
      <rect x="72"  y="450" width="115" height="55" fill={desk} opacity={0.4} rx={4}/>
      <rect x="82"  y="460" width="95"  height="35" fill={desk} opacity={0.2} rx={3}/>
      {/* Magazine/tablet on coffee table */}
      <rect x="88"  y="466" width="38"  height="22" fill={night?"#0c1428":"#cce0f8"} opacity={0.6} rx={1}/>
      {/* Plants */}
      <circle cx="22"  cy="620" r="10" fill={night?"#1a4010":"#2a6020"} opacity={0.65}/>
      <circle cx="230" cy="620" r="10" fill={night?"#1a4010":"#2a6020"} opacity={0.65}/>

      {/* ── OPERATIONS HUB (x260,y378 235×255) ── */}
      <rect x="260" y="378" width="235" height="255" fill={fl.ops}/>
      <rect x="260" y="378" width="235" height="255" fill="url(#rg-ops)"/>
      {/* Floor grid tile lines */}
      {[0,1,2].map(i=><rect key={i} x="260" y={378+i*85} width="235" height="1" fill="#ffffff08"/>)}
      {[0,1,2].map(i=><rect key={i} x={260+i*78} y="378" width="1" height="255" fill="#ffffff08"/>)}
      {/* Server racks — left wall */}
      {[0,1].map(i=>(
        <g key={i}>
          <rect x={265+i*32} y="383" width="26" height="105" fill={server} rx={1}/>
          {[0,1,2,3,4,5,6,7].map(j=>(
            <circle key={j} cx={272+i*32} cy={392+j*12} r="2.5"
              fill={j%3===0?gGreen:j%3===1?"#ff4444":gBlue} opacity={0.85}/>
          ))}
        </g>
      ))}
      {/* Central console */}
      <rect x="330" y="432" width="135" height="68" fill={night?"#0a1220":"#141e30"} rx={2}/>
      <rect x="338" y="440" width="119" height="52" fill={night?"#060c18":"#0c1428"} rx={1}/>
      <rect x="342" y="444" width="50"  height="34" fill={gGreen} opacity={0.3}/>
      <rect x="400" y="444" width="50"  height="34" fill={gBlue}  opacity={0.3}/>
      {/* Hanging cables (decorative lines) */}
      {[0,1,2].map(i=>(
        <path key={i} d={`M ${275+i*30} 383 Q ${280+i*30} 360 ${270+i*30} 340`} fill="none" stroke={gGreen} strokeWidth="0.5" opacity={0.3}/>
      ))}

      {/* ── LEGAL CORNER (x505,y378 235×255) ── */}
      <rect x="505" y="378" width="235" height="255" fill={fl.leg}/>
      {/* Bookshelf left wall */}
      <rect x="510" y="382" width="14" height="245" fill={shelf} opacity={0.4} rx={1}/>
      {[0,1,2,3,4,5,6,7,8,9].map(i=>(
        <rect key={i} x="512" y={384+i*24} width="10" height="22"
          fill={["#8B4513","#2F4F4F","#800000","#4a4a8a","#556B2F","#8B4513","#4a0000","#2a4a6a","#6a2a2a","#2a6a4a"][i]} opacity={0.7}/>
      ))}
      {/* Main lawyer desk */}
      <rect x="538" y="400" width="115" height="18" fill={desk} opacity={0.6} rx={1}/>
      <rect x="628" y="400" width="14"  height="60" fill={desk} opacity={0.6} rx={1}/>
      {/* Chair */}
      <rect x="570" y="422" width="14"  height="13" fill={desk} opacity={0.4} rx={2}/>
      {/* Monitor */}
      <rect x="575" y="393" width="44"  height="7"  fill={gAmber} opacity={0.65}/>
      {/* Papers pile */}
      <rect x="545" y="404" width="22"  height="12" fill={night?"#1a1608":"#f0e4cc"} opacity={0.5}/>
      <rect x="549" y="408" width="18"  height="8"  fill={night?"#1a1608":"#f0e4cc"} opacity={0.4}/>
      {/* Filing cabinets */}
      {[0,1,2].map(i=>(
        <g key={i}>
          <rect x={532+i*34} y="572" width="30" height="54" fill={desk} opacity={0.4} rx={1}/>
          <rect x={532+i*34} y="586" width="30" height="1"  fill="#ffffff18"/>
          <rect x={532+i*34} y="600" width="30" height="1"  fill="#ffffff18"/>
          <rect x={532+i*34} y="614" width="30" height="1"  fill="#ffffff18"/>
        </g>
      ))}

      {/* ── MARKETING SALOON (x750,y378 235×255) ── */}
      <rect x="750" y="378" width="235" height="255" fill={fl.mkt}/>
      <rect x="750" y="378" width="235" height="255" fill="url(#rg-mkt)"/>
      {/* Mood board / inspiration wall */}
      <rect x="755" y="382" width="105" height="65" fill={night?"#1a1010":"#2a1818"} rx={1}/>
      {[
        {x:758,y:385,c:"#f97316"},{x:776,y:385,c:"#ec4899"},{x:794,y:385,c:"#fbbf24"},
        {x:812,y:385,c:"#22c55e"},{x:830,y:385,c:"#3b82f6"},{x:848,y:385,c:"#a855f7"},
        {x:758,y:403,c:"#ef4444"},{x:776,y:403,c:"#14b8a6"},{x:794,y:403,c:"#fbbf24"},
        {x:812,y:403,c:"#f97316"},{x:830,y:403,c:"#ec4899"},{x:848,y:403,c:"#6366f1"},
      ].map((p,i)=>(
        <rect key={i} x={p.x} y={p.y} width="15" height="14" fill={p.c} opacity={0.72} rx={1}/>
      ))}
      {/* Standing desks row */}
      <rect x="872" y="388" width="105" height="14" fill={night?"#1a2018":"#2a3828"} rx={1}/>
      <rect x="872" y="418" width="105" height="14" fill={night?"#1a2018":"#2a3828"} rx={1}/>
      <rect x="872" y="448" width="105" height="14" fill={night?"#1a2018":"#2a3828"} rx={1}/>
      {/* Monitors on standing desks */}
      {[0,1,2].map(i=>(
        <rect key={i} x={878} y={380+i*30} width="22" height="8" fill={gAmber} opacity={0.65}/>
      ))}
      {[0,1,2].map(i=>(
        <rect key={i} x={906} y={380+i*30} width="22" height="8" fill={gAmber} opacity={0.55}/>
      ))}
      {/* Collab round table center */}
      <rect x="790" y="490" width="130" height="85" fill={night?"#0c1c1a":"#182828"} rx={6}/>
      <rect x="800" y="500" width="110" height="65" fill={night?"#081412":"#102020"} rx={4}/>
      {[0,1,2].map(i=><rect key={i} x={800+i*38} y="478" width="14" height="9" fill={desk} opacity={0.4} rx={1}/>)}

      {/* ════════════════════ ROW 3 ════════════════════ */}

      {/* ── RECEPTION (x260,y643 480×167) ── */}
      <rect x="260" y="643" width="480" height="167" fill={fl.rec}/>
      <rect x="260" y="643" width="480" height="167" fill="url(#rg-rec)"/>
      {/* Marble tile grid */}
      {[0,1].map(i=><rect key={i} x="260" y={643+i*55} width="480" height="1" fill="#00000012"/>)}
      {[0,1,2,3,4].map(i=><rect key={i} x={260+i*96} y="643" width="1" height="167" fill="#00000012"/>)}
      {/* Back wall sign */}
      <rect x="360" y="647" width="280" height="14" fill={night?"#252018":"#e8dcc8"} rx={2}/>
      <rect x="390" y="650" width="220" height="8"  fill={night?"#b49320":"#9a7a14"} rx={1} opacity={0.75}/>
      {/* Reception desk */}
      <rect x="318" y="678" width="364" height="22" fill={desk} rx={2}/>
      <rect x="318" y="698" width="364" height="12" fill={night?"#1a1408":"#c0a860"} rx={2}/>
      {/* Desk front panel */}
      <rect x="325" y="700" width="350" height="10" fill={shelf} rx={1} opacity={0.6}/>
      {/* Monitors on desk */}
      <rect x="430" y="671" width="36" height="7"  fill={gAmber} opacity={0.6}/>
      <rect x="490" y="671" width="36" height="7"  fill={gAmber} opacity={0.6}/>
      {/* Visitor chairs left */}
      {[0,1,2].map(i=><rect key={i} x={272+i*28} y="725" width="20" height="16" fill={sofa} opacity={0.45} rx={2}/>)}
      {/* Visitor chairs right */}
      {[0,1,2].map(i=><rect key={i} x={682+i*28} y="725" width="20" height="16" fill={sofa} opacity={0.45} rx={2}/>)}
      {/* Plants at desk ends */}
      <circle cx="280" cy="692" r="9" fill={night?"#1a4010":"#2a6020"} opacity={0.6}/>
      <circle cx="723" cy="692" r="9" fill={night?"#1a4010":"#2a6020"} opacity={0.6}/>
    </svg>
  );
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
        transform: isZooming ? "scale(2.5)" : hovered ? "scale(1.015)" : "scale(1)",
        transformOrigin,
        zIndex: isZooming ? 20 : hovered ? 5 : undefined,
        transition: isZooming
          ? "transform 0.3s ease-in, box-shadow 0.2s ease"
          : "transform 0.15s ease, box-shadow 0.2s ease",
      }}
    >
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
  const [nightMode, setNightMode]         = useState(true);
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
    setTimeout(() => { router.push(href); setZoomingRoom(null); }, 320);
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

      {/* Inline SVG floor plan — full brightness, no characters */}
      <OfficeSVG night={nightMode} />

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
