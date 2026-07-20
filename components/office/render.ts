// Canvas renderer for the Virtual Office. Draws in native office-pixel space
// (OFFICE_WIDTH × OFFICE_HEIGHT); the shell scales the element to its column.
// Kept free of React so the draw loop is cheap and the geometry stays in
// lib/office. No external rendering SDK — plain Canvas 2D, per the repo's
// "native intelligence" directive.
import {
  TILE,
  OFFICE_WIDTH,
  OFFICE_HEIGHT,
  PROXIMITY_RADIUS,
  type AgentDesk,
  type OfficeRoom,
} from "@/lib/office/layout";
import {
  STATUS_COLORS,
  distance,
  type Participant,
} from "@/lib/office/presence";
import { roomTheme, type Wall, type Doorway } from "@/lib/office/walls";
import type { Facing } from "@/lib/office/avatarConfig";
import { drawAvatar } from "./vectorAvatar";

/** Emoji glyphs for MapMaker furniture kinds. */
const OBJECT_GLYPH: Record<string, string> = {
  desk: "🖥",
  plant: "🪴",
  whiteboard: "📋",
  couch: "🛋",
  table: "🍽",
  screen: "📺",
};

export interface OfficeTheme {
  surface0: string;
  surface1: string;
  surface2: string;
  surface3: string;
  grid: string;
  fg: string;
  fgMuted: string;
}

export interface DrawState {
  ctx: CanvasRenderingContext2D;
  theme: OfficeTheme;
  /** The active room set (built-in default or a persisted custom layout). */
  rooms: OfficeRoom[];
  /** Wall segments + doorways for the active layout (from buildWalls). */
  walls: Wall[];
  doorways: Doorway[];
  desks: AgentDesk[];
  participants: Participant[];
  localId: string;
  /** ms timestamp for idle animation. */
  time: number;
}

/** Per-room floor texture, drawn inside the room's clip region. */
function drawFloorPattern(
  ctx: CanvasRenderingContext2D,
  floor: "grid" | "wood" | "carpet" | "tile" | "marble",
  x: number,
  y: number,
  w: number,
  h: number,
  accent: string,
): void {
  ctx.save();
  if (floor === "wood") {
    ctx.strokeStyle = hexA(accent, 0.12);
    ctx.lineWidth = 1;
    for (let py = y + TILE * 0.7; py < y + h; py += TILE * 0.7) {
      ctx.beginPath();
      ctx.moveTo(x, py + 0.5);
      ctx.lineTo(x + w, py + 0.5);
      ctx.stroke();
    }
  } else if (floor === "tile") {
    for (let iy = 0; iy * TILE < h; iy++) {
      for (let ix = 0; ix * TILE < w; ix++) {
        if ((ix + iy) % 2 === 0) continue;
        ctx.fillStyle = hexA(accent, 0.06);
        ctx.fillRect(x + ix * TILE, y + iy * TILE, TILE, TILE);
      }
    }
  } else if (floor === "carpet") {
    ctx.fillStyle = hexA(accent, 0.08);
    for (let py = y + 4; py < y + h; py += 6) {
      for (let px = x + 4; px < x + w; px += 6) {
        ctx.fillRect(px, py, 1.5, 1.5);
      }
    }
  } else if (floor === "marble") {
    ctx.strokeStyle = hexA(accent, 0.1);
    ctx.lineWidth = 1;
    for (let d = -h; d < w; d += TILE * 1.6) {
      ctx.beginPath();
      ctx.moveTo(x + d, y);
      ctx.lineTo(x + d + h, y + h);
      ctx.stroke();
    }
  } else {
    // grid
    ctx.strokeStyle = hexA(accent, 0.1);
    ctx.lineWidth = 1;
    for (let gx = x + TILE; gx < x + w; gx += TILE) {
      ctx.beginPath();
      ctx.moveTo(gx + 0.5, y);
      ctx.lineTo(gx + 0.5, y + h);
      ctx.stroke();
    }
    for (let gy = y + TILE; gy < y + h; gy += TILE) {
      ctx.beginPath();
      ctx.moveTo(x, gy + 0.5);
      ctx.lineTo(x + w, gy + 0.5);
      ctx.stroke();
    }
  }
  ctx.restore();
}

function hexA(hex: string, alpha: number): string {
  const h = hex.replace("#", "");
  const r = parseInt(h.slice(0, 2), 16);
  const g = parseInt(h.slice(2, 4), 16);
  const b = parseInt(h.slice(4, 6), 16);
  return `rgba(${r}, ${g}, ${b}, ${alpha})`;
}

function roundRect(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
  r: number,
): void {
  const radius = Math.min(r, w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + radius, y);
  ctx.arcTo(x + w, y, x + w, y + h, radius);
  ctx.arcTo(x + w, y + h, x, y + h, radius);
  ctx.arcTo(x, y + h, x, y, radius);
  ctx.arcTo(x, y, x + w, y, radius);
  ctx.closePath();
}

export function drawOffice(state: DrawState): void {
  const { ctx, theme, rooms, walls, doorways, desks, participants, localId, time } =
    state;

  // Floor
  ctx.fillStyle = theme.surface0;
  ctx.fillRect(0, 0, OFFICE_WIDTH, OFFICE_HEIGHT);

  // Tile grid
  ctx.strokeStyle = theme.grid;
  ctx.lineWidth = 1;
  for (let c = 0; c <= OFFICE_WIDTH / TILE; c++) {
    ctx.beginPath();
    ctx.moveTo(c * TILE + 0.5, 0);
    ctx.lineTo(c * TILE + 0.5, OFFICE_HEIGHT);
    ctx.stroke();
  }
  for (let r = 0; r <= OFFICE_HEIGHT / TILE; r++) {
    ctx.beginPath();
    ctx.moveTo(0, r * TILE + 0.5);
    ctx.lineTo(OFFICE_WIDTH, r * TILE + 0.5);
    ctx.stroke();
  }

  // Rooms — themed floor, border, label
  for (const room of rooms) {
    const x = room.x * TILE;
    const y = room.y * TILE;
    const w = room.w * TILE;
    const h = room.h * TILE;
    const rt = roomTheme(room);

    // Themed floor (clipped to the room)
    ctx.save();
    roundRect(ctx, x, y, w, h, 10);
    ctx.clip();
    ctx.fillStyle = hexA(room.accent, 0.07);
    ctx.fillRect(x, y, w, h);
    drawFloorPattern(ctx, rt.floor, x, y, w, h, room.accent);
    if (rt.rug) {
      ctx.fillStyle = hexA(room.accent, 0.12);
      roundRect(ctx, x + w * 0.28, y + h * 0.5, w * 0.44, h * 0.38, 10);
      ctx.fill();
    }
    ctx.restore();

    ctx.strokeStyle = hexA(room.accent, 0.5);
    ctx.lineWidth = 1.5;
    roundRect(ctx, x, y, w, h, 10);
    ctx.stroke();

    // Label bar
    ctx.fillStyle = room.accent;
    ctx.font = "600 13px ui-sans-serif, system-ui, sans-serif";
    ctx.textBaseline = "top";
    ctx.textAlign = "left";
    ctx.fillText(room.label.toUpperCase(), x + 10, y + 8);

    ctx.fillStyle = theme.fgMuted;
    ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
    ctx.fillText(room.purpose, x + 10, y + 26);

    if (room.approvalGated) {
      const badge = "APPROVAL-GATED";
      ctx.font = "600 9px ui-monospace, monospace";
      const bw = ctx.measureText(badge).width + 12;
      ctx.fillStyle = hexA(room.accent, 0.18);
      roundRect(ctx, x + w - bw - 8, y + 8, bw, 16, 8);
      ctx.fill();
      ctx.fillStyle = room.accent;
      ctx.textAlign = "center";
      ctx.fillText(badge, x + w - bw / 2 - 8, y + 12);
      ctx.textAlign = "left";
    }
  }

  // Desks
  for (const desk of desks) {
    const x = desk.x * TILE;
    const y = desk.y * TILE;
    ctx.fillStyle = hexA(desk.room.accent, 0.22);
    roundRect(ctx, x - TILE * 0.6, y - TILE * 0.28, TILE * 1.2, TILE * 0.56, 4);
    ctx.fill();
  }

  // Doorway thresholds (drawn under the walls so the mat sits in the gap).
  for (const d of doorways) {
    ctx.fillStyle = hexA("#d4a82a", 0.16);
    ctx.fillRect(d.x * TILE, d.y * TILE, d.w * TILE, d.h * TILE);
  }

  // Walls — thin stone segments with a soft top edge.
  for (const wall of walls) {
    const wx = wall.x * TILE;
    const wy = wall.y * TILE;
    const ww = wall.w * TILE;
    const wh = wall.h * TILE;
    ctx.fillStyle = theme.surface3;
    ctx.fillRect(wx, wy, ww, wh);
    ctx.fillStyle = hexA("#ffffff", 0.06);
    ctx.fillRect(wx, wy, ww, Math.min(3, wh));
    ctx.strokeStyle = hexA("#000000", 0.22);
    ctx.lineWidth = 1;
    ctx.strokeRect(wx + 0.5, wy + 0.5, ww, wh);
  }

  // Furniture / objects placed via the MapMaker.
  for (const room of rooms) {
    if (!room.objects) continue;
    for (const obj of room.objects) {
      ctx.font = "16px ui-sans-serif, system-ui, sans-serif";
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(OBJECT_GLYPH[obj.kind] ?? "▪", obj.x * TILE, obj.y * TILE);
    }
  }

  const local = participants.find((p) => p.id === localId);

  // Proximity ring + spatial-conversation links for the local avatar
  if (local) {
    const lx = local.x * TILE;
    const ly = local.y * TILE;
    ctx.beginPath();
    ctx.arc(lx, ly, PROXIMITY_RADIUS * TILE, 0, Math.PI * 2);
    ctx.fillStyle = hexA("#d4a82a", 0.05);
    ctx.fill();
    ctx.strokeStyle = hexA("#d4a82a", 0.35);
    ctx.setLineDash([5, 5]);
    ctx.lineWidth = 1.5;
    ctx.stroke();
    ctx.setLineDash([]);

    for (const p of participants) {
      if (p.id === localId || p.status === "away") continue;
      const d = distance(local, p);
      if (d > PROXIMITY_RADIUS) continue;
      ctx.beginPath();
      ctx.moveTo(lx, ly);
      ctx.lineTo(p.x * TILE, p.y * TILE);
      ctx.strokeStyle = hexA("#d4a82a", 0.4 * (1 - d / PROXIMITY_RADIUS));
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Avatars (agents first so humans sit on top)
  const ordered = [...participants].sort((a, b) => {
    if (a.id === localId) return 1;
    if (b.id === localId) return -1;
    return a.kind === b.kind ? 0 : a.kind === "agent" ? -1 : 1;
  });

  for (const p of ordered) {
    const isAgent = p.kind === "agent";
    const cx = p.x * TILE;
    // Feet sit slightly below the tile centre so the character "stands" on it.
    const feetY = p.y * TILE + TILE * 0.35;
    const height = TILE * (isAgent ? 1.5 : 1.7);
    const headY = feetY - height;
    const isLocal = p.id === localId;
    const facing: Facing = p.facing ?? "down";

    // Busy pulse — a soft ring for agents actively working.
    if (p.busy) {
      const pulse = (Math.sin(time / 500 + p.x) + 1) / 2;
      ctx.beginPath();
      ctx.arc(cx, feetY - height * 0.4, 14 + pulse * 5, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(p.color, 0.3 * (1 - pulse));
      ctx.lineWidth = 2;
      ctx.stroke();
    }

    // Local highlight ring on the floor (the sprite draws its own shadow).
    if (isLocal) {
      ctx.beginPath();
      ctx.ellipse(cx, feetY, 11, 4.4, 0, 0, Math.PI * 2);
      ctx.strokeStyle = hexA("#ffffff", 0.7);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    // Smooth-vector character (agents resolve by key; humans by their config).
    drawAvatar(ctx, {
      config: isAgent ? undefined : p.avatar,
      agentKey: p.agentKey,
      x: cx,
      y: feetY,
      height,
      facing,
      timeMs: time,
      moving: !isAgent && !!p.moving,
      status: p.status,
    });

    // Status dot near the head
    ctx.beginPath();
    ctx.arc(cx + 7, headY + 4, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = STATUS_COLORS[p.status];
    ctx.strokeStyle = theme.surface0;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    // Name tag below the feet
    const label = isAgent ? p.name : `${p.name}${isLocal ? " (you)" : ""}`;
    ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = hexA(theme.surface2, 0.92);
    roundRect(ctx, cx - tw / 2, feetY + 4, tw, 15, 7);
    ctx.fill();
    ctx.fillStyle = theme.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, feetY + 12);

    // Live activity line for busy agents
    if (isAgent && p.busy && p.activityLabel) {
      ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = theme.fgMuted;
      ctx.fillText(p.activityLabel, cx, feetY + 25);
    }

    // Emote bubble above the head
    if (p.emote) {
      ctx.font = "16px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexA(theme.surface3, 0.95);
      ctx.beginPath();
      ctx.arc(cx, headY - 6, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.fillText(p.emote, cx, headY - 5);
    }
  }
}
