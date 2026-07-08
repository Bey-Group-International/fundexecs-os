"use client";

// Canvas renderer for the Command Center world.
//
// Art direction: FundExecs dark institutional surfaces + electric-blue accents,
// dressed with Gather-2.0-style soft furniture (rounded desks, soft shadows,
// ambient room glows). Executives are procedural humanoid "trainer" sprites
// (4-direction, 2-frame walk) inspired by Pokémon Gen-II overworld motion; Earn
// renders the real /earn-coin.png as a floating orchestrator coin. No sprite
// sheets, no engine deps — every frame is drawn from the engine's avatar state.

import { useEffect, useRef } from "react";
import type { WorldEngine } from "@/lib/command-center/engine";
import { roomAt, TILE } from "@/lib/command-center/map";
import type { AvatarRuntime, Cell, RoomDef } from "@/lib/command-center/types";

const C = {
  void: "#03060d",
  floorA: "#0a1320",
  floorB: "#0c1626",
  hall: "#0e1a2c",
  wallTop: "#26405f",
  wallBody: "#162741",
  wallShadow: "#0a1322",
  door: "#1f3a5c",
  accent: "#38bdf8",
  skin: "#e7c6a4",
  text: "#f1f7ff",
  textMuted: "#7184a0",
};

export interface WorldCanvasProps {
  engine: WorldEngine;
  selectedId: string | null;
  onHover: (info: { roomId: string | null; avatarId: string | null }) => void;
  onSelect: (info: { roomId: string | null; avatarId: string | null }) => void;
}

export function WorldCanvas({ engine, selectedId, onHover, onSelect }: WorldCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const coinRef = useRef<HTMLImageElement | null>(null);
  const hoverRef = useRef<{ roomId: string | null; avatarId: string | null }>({
    roomId: null,
    avatarId: null,
  });
  const selectedRef = useRef<string | null>(selectedId);
  selectedRef.current = selectedId;
  const viewRef = useRef({ scale: 1, ox: 0, oy: 0 });

  useEffect(() => {
    const img = new Image();
    img.src = "/earn-coin.png";
    img.onload = () => {
      coinRef.current = img;
    };
  }, []);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    const map = engine.map;
    const mapW = map.cols * TILE;
    const mapH = map.rows * TILE;

    let raf = 0;
    let last = performance.now();

    const resize = () => {
      const parent = canvas.parentElement;
      if (!parent) return;
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const cw = parent.clientWidth;
      const ch = parent.clientHeight;
      canvas.width = cw * dpr;
      canvas.height = ch * dpr;
      canvas.style.width = `${cw}px`;
      canvas.style.height = `${ch}px`;
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      const scale = Math.min(cw / mapW, ch / mapH);
      viewRef.current = {
        scale,
        ox: (cw - mapW * scale) / 2,
        oy: (ch - mapH * scale) / 2,
      };
    };
    resize();
    const ro = new ResizeObserver(resize);
    if (canvas.parentElement) ro.observe(canvas.parentElement);

    const loop = (now: number) => {
      const dt = Math.min(48, now - last);
      last = now;
      engine.tick(dt);
      draw(ctx, engine, now, hoverRef.current, selectedRef.current, coinRef.current, viewRef.current);
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);

    return () => {
      cancelAnimationFrame(raf);
      ro.disconnect();
    };
  }, [engine]);

  // Pointer → map coordinates → room/avatar hit test.
  const hit = (clientX: number, clientY: number) => {
    const canvas = canvasRef.current;
    if (!canvas) return { roomId: null, avatarId: null };
    const rect = canvas.getBoundingClientRect();
    const { scale, ox, oy } = viewRef.current;
    const mx = (clientX - rect.left - ox) / scale;
    const my = (clientY - rect.top - oy) / scale;
    const cell: Cell = { x: Math.floor(mx / TILE), y: Math.floor(my / TILE) };
    let avatarId: string | null = null;
    let best = 22;
    for (const a of engine.avatars.values()) {
      const d = Math.hypot(a.px - mx, a.py - my);
      if (d < best) {
        best = d;
        avatarId = a.def.id;
      }
    }
    const room = roomAt(cell);
    return { roomId: room?.id ?? null, avatarId };
  };

  return (
    <canvas
      ref={canvasRef}
      className="h-full w-full cursor-pointer"
      onMouseMove={(e) => {
        const info = hit(e.clientX, e.clientY);
        hoverRef.current = info;
        onHover(info);
      }}
      onMouseLeave={() => {
        hoverRef.current = { roomId: null, avatarId: null };
        onHover({ roomId: null, avatarId: null });
      }}
      onClick={(e) => onSelect(hit(e.clientX, e.clientY))}
    />
  );
}

// --------------------------------------------------------------------------
// Drawing
// --------------------------------------------------------------------------

function draw(
  ctx: CanvasRenderingContext2D,
  engine: WorldEngine,
  now: number,
  hover: { roomId: string | null; avatarId: string | null },
  selectedId: string | null,
  coin: HTMLImageElement | null,
  view: { scale: number; ox: number; oy: number },
) {
  const map = engine.map;
  const cw = ctx.canvas.clientWidth;
  const ch = ctx.canvas.clientHeight;
  ctx.clearRect(0, 0, cw, ch);

  // Backdrop
  ctx.fillStyle = C.void;
  ctx.fillRect(0, 0, cw, ch);

  ctx.save();
  ctx.translate(view.ox, view.oy);
  ctx.scale(view.scale, view.scale);

  // 1) Tiles
  for (let y = 0; y < map.rows; y++) {
    for (let x = 0; x < map.cols; x++) {
      const t = map.tiles[y][x];
      const px = x * TILE;
      const py = y * TILE;
      if (t === "void") continue;
      if (t === "floor" || t === "rug") {
        ctx.fillStyle = (x + y) % 2 === 0 ? C.floorA : C.floorB;
        ctx.fillRect(px, py, TILE, TILE);
      } else if (t === "hall" || t === "door") {
        ctx.fillStyle = C.hall;
        ctx.fillRect(px, py, TILE, TILE);
      } else if (t === "wall") {
        // Soft 3D wall: shadow base, body, lit top edge.
        ctx.fillStyle = C.wallShadow;
        ctx.fillRect(px, py, TILE, TILE);
        ctx.fillStyle = C.wallBody;
        ctx.fillRect(px, py, TILE, TILE - 5);
        ctx.fillStyle = C.wallTop;
        ctx.fillRect(px, py, TILE, 3);
      } else if (t === "screen") {
        ctx.fillStyle = C.wallBody;
        ctx.fillRect(px, py, TILE, TILE);
        const g = ctx.createLinearGradient(px, py, px, py + TILE);
        g.addColorStop(0, "rgba(56,189,248,0.55)");
        g.addColorStop(1, "rgba(56,189,248,0.08)");
        ctx.fillStyle = g;
        ctx.fillRect(px + 2, py + 4, TILE - 4, TILE - 12);
      }
    }
  }

  // 2) Per-room dressing: ambient glow, rug accent, label, soft furniture.
  for (const room of map.rooms) {
    drawRoom(ctx, room, now, hover.roomId === room.id || selectedId === room.id);
  }

  // 3) Avatars, depth-sorted by y so lower sprites overlap upper ones.
  const avatars = [...engine.avatars.values()].sort((a, b) => a.py - b.py);
  for (const a of avatars) {
    const isHover = hover.avatarId === a.def.id;
    const isSel = selectedId === a.def.id;
    if (a.def.isEarn) drawEarn(ctx, a, now, coin, isHover || isSel);
    else drawExec(ctx, a, now, isHover || isSel);
  }

  ctx.restore();
}

function rrect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number) {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function drawRoom(ctx: CanvasRenderingContext2D, room: RoomDef, now: number, active: boolean) {
  const { x, y, w, h } = room.rect;
  const px = (x + 1) * TILE;
  const py = (y + 1) * TILE;
  const pw = (w - 2) * TILE;
  const ph = (h - 2) * TILE;

  // Ambient room glow (Gather-2.0 soft light), brighter when active.
  const cx = px + pw / 2;
  const cy = py + ph / 2;
  const glow = ctx.createRadialGradient(cx, cy, 8, cx, cy, Math.max(pw, ph) * 0.7);
  const baseA = active ? 0.22 : 0.1;
  glow.addColorStop(0, hexA(room.accent, baseA));
  glow.addColorStop(1, hexA(room.accent, 0));
  ctx.fillStyle = glow;
  ctx.fillRect(px - TILE, py - TILE, pw + TILE * 2, ph + TILE * 2);

  // Soft furniture: each desk is a rounded workstation with a glowing monitor.
  for (const d of room.desks) {
    const dx = d.x * TILE;
    const dy = d.y * TILE;
    ctx.fillStyle = "rgba(0,0,0,0.35)";
    rrect(ctx, dx + 3, dy + TILE - 7, TILE - 6, 6, 3);
    ctx.fill();
    ctx.fillStyle = "#16243a";
    rrect(ctx, dx + 3, dy + 8, TILE - 6, TILE - 12, 5);
    ctx.fill();
    // Monitor
    ctx.fillStyle = hexA(room.accent, 0.85);
    rrect(ctx, dx + 8, dy + 10, TILE - 16, 8, 2);
    ctx.fill();
  }

  // Floor label (mono, faint) centered in the room.
  ctx.save();
  ctx.fillStyle = hexA(room.accent, active ? 0.9 : 0.45);
  ctx.font = "600 9px ui-monospace, monospace";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  ctx.fillText(room.short, cx, py + 8);
  ctx.restore();

  // Active room border pulse.
  if (active) {
    const a = 0.4 + 0.3 * Math.sin(now / 320);
    ctx.strokeStyle = hexA(room.accent, a);
    ctx.lineWidth = 2;
    rrect(ctx, px - 2, py - 2, pw + 4, ph + 4, 8);
    ctx.stroke();
  }
}

function drawShadow(ctx: CanvasRenderingContext2D, x: number, y: number, rx = 9) {
  ctx.fillStyle = "rgba(0,0,0,0.4)";
  ctx.beginPath();
  ctx.ellipse(x, y + 9, rx, 3.2, 0, 0, Math.PI * 2);
  ctx.fill();
}

function drawExec(ctx: CanvasRenderingContext2D, a: AvatarRuntime, now: number, focus: boolean) {
  const { px, py } = a;
  const walking = a.state === "walk";
  const frame = walking ? Math.floor(a.animClock / 140) % 2 : 0;
  const bob = walking ? 0 : Math.sin(now / 600 + px) * 0.8;
  const y = py + bob;
  const color = a.def.color;
  const dark = shade(color, -0.35);

  drawShadow(ctx, px, py);

  // Legs (2-frame alternating step).
  const step = walking ? (frame === 0 ? 2 : -2) : 0;
  ctx.fillStyle = dark;
  ctx.fillRect(px - 4, y + 2 + Math.max(0, step), 3, 6);
  ctx.fillRect(px + 1, y + 2 + Math.max(0, -step), 3, 6);

  // Torso (agent color, rounded).
  ctx.fillStyle = color;
  rrect(ctx, px - 6, y - 6, 12, 10, 3);
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.lineWidth = 1;
  ctx.stroke();

  // Head with directional face.
  ctx.fillStyle = C.skin;
  ctx.beginPath();
  ctx.arc(px, y - 10, 4.2, 0, Math.PI * 2);
  ctx.fill();
  ctx.strokeStyle = dark;
  ctx.stroke();
  // Hair cap
  ctx.fillStyle = dark;
  ctx.beginPath();
  ctx.arc(px, y - 11, 4.2, Math.PI, Math.PI * 2);
  ctx.fill();
  // Eyes by facing
  ctx.fillStyle = "#0b1320";
  const ey = y - 9.5;
  if (a.facing === "down") {
    ctx.fillRect(px - 2.4, ey, 1.4, 1.6);
    ctx.fillRect(px + 1, ey, 1.4, 1.6);
  } else if (a.facing === "left") {
    ctx.fillRect(px - 2.6, ey, 1.4, 1.6);
  } else if (a.facing === "right") {
    ctx.fillRect(px + 1.2, ey, 1.4, 1.6);
  }
  // facing "up" → no eyes (back of head)

  // Working / handoff cues.
  if (a.state === "work") drawWorkCue(ctx, px, y - 18, a.progress, color, now);
  if (a.pulse > 0) drawPulse(ctx, px, y - 6, a.pulse, color);

  if (focus || a.state === "work") drawNameTag(ctx, px, y + 14, a.def.name);
}

function drawEarn(
  ctx: CanvasRenderingContext2D,
  a: AvatarRuntime,
  now: number,
  coin: HTMLImageElement | null,
  focus: boolean,
) {
  const bob = Math.sin(now / 520) * 1.6;
  const px = a.px;
  const py = a.py + bob;
  const r = 13;

  drawShadow(ctx, a.px, a.py, 11);

  // Neural-green halo
  const halo = ctx.createRadialGradient(px, py, 4, px, py, r + 10);
  halo.addColorStop(0, "rgba(199,255,107,0.55)");
  halo.addColorStop(1, "rgba(199,255,107,0)");
  ctx.fillStyle = halo;
  ctx.beginPath();
  ctx.arc(px, py, r + 10, 0, Math.PI * 2);
  ctx.fill();

  // Coin asset clipped to a circle (fallback to a minted disc if not loaded).
  ctx.save();
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.closePath();
  ctx.clip();
  if (coin && coin.complete && coin.naturalWidth) {
    ctx.drawImage(coin, px - r, py - r, r * 2, r * 2);
  } else {
    ctx.fillStyle = "#0d1407";
    ctx.fillRect(px - r, py - r, r * 2, r * 2);
    ctx.fillStyle = "#c7ff6b";
    ctx.font = "700 14px ui-sans-serif, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText("E", px, py);
  }
  ctx.restore();
  ctx.strokeStyle = "rgba(199,255,107,0.7)";
  ctx.lineWidth = 1.4;
  ctx.beginPath();
  ctx.arc(px, py, r, 0, Math.PI * 2);
  ctx.stroke();

  // Delegate burst — expanding rings while Earn issues tasks.
  if (a.state === "delegate" || a.pulse > 0) {
    const t = a.state === "delegate" ? (now % 900) / 900 : 1 - a.pulse;
    ctx.strokeStyle = `rgba(199,255,107,${0.6 * (1 - t)})`;
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(px, py, r + t * 22, 0, Math.PI * 2);
    ctx.stroke();
  }

  if (focus || a.state === "delegate") drawNameTag(ctx, px, py + 20, "Earn · COO");
}

function drawWorkCue(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  progress: number,
  color: string,
  now: number,
) {
  // Three bouncing activity dots.
  for (let i = 0; i < 3; i++) {
    const off = Math.sin(now / 200 + i * 1.1) * 1.6;
    ctx.fillStyle = color;
    ctx.beginPath();
    ctx.arc(x - 4 + i * 4, y + off, 1.4, 0, Math.PI * 2);
    ctx.fill();
  }
  // Thin progress arc beneath the dots.
  ctx.strokeStyle = "rgba(255,255,255,0.18)";
  ctx.lineWidth = 1.6;
  ctx.beginPath();
  ctx.arc(x, y + 6, 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2);
  ctx.stroke();
  ctx.strokeStyle = color;
  ctx.beginPath();
  ctx.arc(x, y + 6, 5, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * Math.max(0.02, progress));
  ctx.stroke();
}

function drawPulse(ctx: CanvasRenderingContext2D, x: number, y: number, p: number, color: string) {
  ctx.strokeStyle = hexA(color, 0.5 * p);
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(x, y, (1 - p) * 18 + 6, 0, Math.PI * 2);
  ctx.stroke();
}

function drawNameTag(ctx: CanvasRenderingContext2D, x: number, y: number, label: string) {
  ctx.font = "600 9px ui-sans-serif, system-ui, sans-serif";
  ctx.textAlign = "center";
  ctx.textBaseline = "middle";
  const w = ctx.measureText(label).width + 10;
  ctx.fillStyle = "rgba(3,6,13,0.82)";
  rrect(ctx, x - w / 2, y - 7, w, 14, 7);
  ctx.fill();
  ctx.strokeStyle = "rgba(56,189,248,0.35)";
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.fillStyle = C.text;
  ctx.fillText(label, x, y);
}

// --- color helpers ---------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const n = parseInt(
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h,
    16,
  );
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function hexA(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r},${g},${b},${a})`;
}

function shade(hex: string, amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const f = (v: number) =>
    Math.max(0, Math.min(255, Math.round(v + (amt < 0 ? v : 255 - v) * amt)));
  return `rgb(${f(r)},${f(g)},${f(b)})`;
}
