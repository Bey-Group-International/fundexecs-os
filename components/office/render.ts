// Canvas renderer for the Virtual Office. Draws in native office-pixel space
// (OFFICE_WIDTH × OFFICE_HEIGHT); the shell scales the element to its column.
// Kept free of React so the draw loop is cheap and the geometry stays in
// lib/office. No external rendering SDK — plain Canvas 2D, per the repo's
// "native intelligence" directive.
import {
  ROOMS,
  TILE,
  OFFICE_WIDTH,
  OFFICE_HEIGHT,
  PROXIMITY_RADIUS,
  type AgentDesk,
} from "@/lib/office/layout";
import {
  STATUS_COLORS,
  distance,
  type Participant,
} from "@/lib/office/presence";

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
  desks: AgentDesk[];
  participants: Participant[];
  localId: string;
  /** ms timestamp for idle animation. */
  time: number;
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
  const { ctx, theme, desks, participants, localId, time } = state;

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

  // Rooms
  for (const room of ROOMS) {
    const x = room.x * TILE;
    const y = room.y * TILE;
    const w = room.w * TILE;
    const h = room.h * TILE;

    ctx.fillStyle = hexA(room.accent, 0.07);
    roundRect(ctx, x, y, w, h, 10);
    ctx.fill();
    ctx.strokeStyle = hexA(room.accent, 0.5);
    ctx.lineWidth = 1.5;
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
    // Agents bob gently; humans stay put.
    const bob = isAgent ? Math.sin(time / 600 + p.x + p.y) * 1.2 : 0;
    const x = p.x * TILE;
    const y = p.y * TILE + bob;
    const radius = isAgent ? 9 : 11;
    const isLocal = p.id === localId;

    // Shadow
    ctx.beginPath();
    ctx.ellipse(x, y + radius + 3, radius * 0.8, radius * 0.35, 0, 0, Math.PI * 2);
    ctx.fillStyle = "rgba(0,0,0,0.28)";
    ctx.fill();

    // Body
    ctx.beginPath();
    ctx.arc(x, y, radius, 0, Math.PI * 2);
    ctx.fillStyle = p.color;
    ctx.fill();
    ctx.lineWidth = isLocal ? 3 : 2;
    ctx.strokeStyle = isLocal ? "#ffffff" : hexA(p.color, 0.9);
    ctx.stroke();

    // Initial
    ctx.fillStyle = "#0a111f";
    ctx.font = `700 ${isAgent ? 9 : 11}px ui-sans-serif, system-ui, sans-serif`;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText((p.name[0] ?? "?").toUpperCase(), x, y + 0.5);

    // Status dot
    ctx.beginPath();
    ctx.arc(x + radius * 0.75, y - radius * 0.75, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = STATUS_COLORS[p.status];
    ctx.strokeStyle = theme.surface0;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    // Name tag
    const label = isAgent ? p.name : `${p.name}${isLocal ? " (you)" : ""}`;
    ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = hexA(theme.surface2, 0.92);
    roundRect(ctx, x - tw / 2, y + radius + 5, tw, 15, 7);
    ctx.fill();
    ctx.fillStyle = theme.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, x, y + radius + 13);

    // Emote bubble
    if (p.emote) {
      ctx.font = "16px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = hexA(theme.surface3, 0.95);
      ctx.beginPath();
      ctx.arc(x, y - radius - 12, 12, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillText(p.emote, x, y - radius - 11);
    }
  }
}
