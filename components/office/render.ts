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
  type OfficeRoom,
} from "@/lib/office/layout";
import {
  STATUS_COLORS,
  distance,
  type Participant,
} from "@/lib/office/presence";
import { roomTheme, type Wall, type Doorway } from "@/lib/office/walls";
import { furnishRoom } from "@/lib/office/furnish";
import { drawAvatar } from "./vectorAvatar";
import { drawProp, PROP_CATALOG } from "./officeProps";
import {
  drawFloorMaterial,
  drawRaisedWall,
  applySceneLighting,
  drawRoomPlaque,
  drawHubCrest,
  drawWordmark,
} from "./sceneEnv";

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
  participants: Participant[];
  localId: string;
  /** ms timestamp for idle animation. */
  time: number;
  /** Optional live video source (webcam) per participant id, for head bubbles. */
  videoFor?: (id: string) => CanvasImageSource | null;
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
  const { ctx, theme, rooms, walls, doorways, participants, localId, time, videoFor } =
    state;

  // Floor
  ctx.fillStyle = theme.surface0;
  ctx.fillRect(0, 0, OFFICE_WIDTH, OFFICE_HEIGHT);

  // Soft global floor sheen from the top — gives the whole floor some depth.
  const sheen = ctx.createRadialGradient(
    OFFICE_WIDTH * 0.5,
    OFFICE_HEIGHT * 0.05,
    0,
    OFFICE_WIDTH * 0.5,
    OFFICE_HEIGHT * 0.05,
    OFFICE_HEIGHT * 1.05,
  );
  sheen.addColorStop(0, "rgba(255,255,255,0.05)");
  sheen.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = sheen;
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
    drawFloorMaterial(ctx, {
      floor: rt.floor,
      x,
      y,
      w,
      h,
      accent: room.accent,
      surface: theme.surface1,
    });
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

    // Institutional signage — a brushed-brass nameplate, a hub crest, and a
    // reception wordmark.
    drawRoomPlaque(ctx, { x: x + 10, y: y + 8, label: room.label, accent: room.accent });
    if (room.type === "hub") {
      drawHubCrest(ctx, { cx: x + w - 22, cy: y + 22, r: 12, accent: room.accent });
    }
    if (room.type === "reception") {
      drawWordmark(ctx, { x: x + w / 2 - 62, y: y + h - 30, text: "FUNDEXECS OS" });
    } else {
      ctx.fillStyle = theme.fgMuted;
      ctx.font = "11px ui-sans-serif, system-ui, sans-serif";
      ctx.textBaseline = "top";
      ctx.textAlign = "left";
      ctx.fillText(room.purpose, x + 12, y + 34);
    }

    if (room.approvalGated) {
      const badge = "APPROVAL-GATED";
      ctx.font = "600 9px ui-monospace, monospace";
      ctx.textBaseline = "top";
      const bw = ctx.measureText(badge).width + 12;
      // Bottom-left so it clears the hub crest in the top-right.
      const by = y + h - 24;
      ctx.fillStyle = hexA(room.accent, 0.18);
      roundRect(ctx, x + 10, by, bw, 16, 8);
      ctx.fill();
      ctx.fillStyle = room.accent;
      ctx.textAlign = "center";
      ctx.fillText(badge, x + 10 + bw / 2, by + 4);
      ctx.textAlign = "left";
    }
  }

  // Ambient lighting — a warm accent glow pooled in each room for depth.
  for (const room of rooms) {
    const rx = room.x * TILE;
    const ry = room.y * TILE;
    const rw = room.w * TILE;
    const rh = room.h * TILE;
    const cx = rx + rw / 2;
    const cy = ry + rh * 0.42;
    const rad = Math.max(rw, rh) * 0.75;
    const glow = ctx.createRadialGradient(cx, cy, rad * 0.08, cx, cy, rad);
    glow.addColorStop(0, hexA(room.accent, 0.06));
    glow.addColorStop(1, "rgba(0,0,0,0)");
    ctx.save();
    roundRect(ctx, rx, ry, rw, rh, 10);
    ctx.clip();
    ctx.fillStyle = glow;
    ctx.fillRect(rx, ry, rw, rh);
    ctx.restore();
  }

  // Doorway thresholds (drawn under the walls so the mat sits in the gap).
  for (const d of doorways) {
    ctx.fillStyle = hexA("#c9a24a", 0.16);
    ctx.fillRect(d.x * TILE, d.y * TILE, d.w * TILE, d.h * TILE);
  }

  const local = participants.find((p) => p.id === localId);

  // Proximity ring + conversation links, painted on the floor beneath everyone.
  if (local) {
    const lx = local.x * TILE;
    const ly = local.y * TILE;
    ctx.beginPath();
    ctx.arc(lx, ly, PROXIMITY_RADIUS * TILE, 0, Math.PI * 2);
    ctx.fillStyle = hexA("#c9a24a", 0.05);
    ctx.fill();
    ctx.strokeStyle = hexA("#c9a24a", 0.35);
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
      ctx.strokeStyle = hexA("#c9a24a", 0.4 * (1 - d / PROXIMITY_RADIUS));
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }

  // Character geometry. Standing anchors the feet; seated anchors the hip line
  // (per drawAvatar), so the head/label offsets shift with the pose.
  const charHeight = (p: Participant) => TILE * (p.kind === "agent" ? 1.5 : 1.7);
  const anchorYOf = (p: Participant) =>
    p.pose === "sit" ? p.y * TILE : p.y * TILE + TILE * 0.35;

  const drawCharacter = (p: Participant) => {
    const isAgent = p.kind === "agent";
    const seated = p.pose === "sit";
    const cx = p.x * TILE;
    const height = charHeight(p);
    const anchorY = anchorYOf(p);
    const groundY = p.y * TILE + TILE * 0.42;

    if (p.busy) {
      const pulse = (Math.sin(time / 500 + p.x) + 1) / 2;
      ctx.beginPath();
      ctx.arc(cx, anchorY - height * 0.35, 14 + pulse * 5, 0, Math.PI * 2);
      ctx.strokeStyle = hexA(p.color, 0.3 * (1 - pulse));
      ctx.lineWidth = 2;
      ctx.stroke();
    }
    if (p.id === localId) {
      ctx.beginPath();
      ctx.ellipse(cx, groundY, 11, 4.4, 0, 0, Math.PI * 2);
      ctx.strokeStyle = hexA("#ffffff", 0.7);
      ctx.lineWidth = 1.5;
      ctx.stroke();
    }

    const video =
      videoFor && p.kind === "human" ? videoFor(p.id) ?? null : null;
    drawAvatar(ctx, {
      config: isAgent ? undefined : p.avatar,
      agentKey: p.agentKey,
      x: cx,
      y: anchorY,
      height,
      facing: p.facing ?? "down",
      timeMs: time,
      moving: !isAgent && !!p.moving && !seated,
      status: p.status,
      pose: seated ? "sit" : "stand",
      video,
    });
  };

  const drawLabel = (p: Participant) => {
    const isAgent = p.kind === "agent";
    const seated = p.pose === "sit";
    const cx = p.x * TILE;
    const height = charHeight(p);
    const anchorY = anchorYOf(p);
    const headY = anchorY - height * (seated ? 0.7 : 1);
    const baseY = seated ? p.y * TILE + TILE * 0.55 : anchorY + 4;
    const isLocal = p.id === localId;

    ctx.beginPath();
    ctx.arc(cx + 7, headY + 4, 3.5, 0, Math.PI * 2);
    ctx.fillStyle = STATUS_COLORS[p.status];
    ctx.strokeStyle = theme.surface0;
    ctx.lineWidth = 1.5;
    ctx.fill();
    ctx.stroke();

    const label = isAgent ? p.name : `${p.name}${isLocal ? " (you)" : ""}`;
    ctx.font = "600 10px ui-sans-serif, system-ui, sans-serif";
    const tw = ctx.measureText(label).width + 10;
    ctx.fillStyle = hexA(theme.surface2, 0.92);
    roundRect(ctx, cx - tw / 2, baseY, tw, 15, 7);
    ctx.fill();
    ctx.fillStyle = theme.fg;
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, baseY + 8);

    if (isAgent && p.busy && p.activityLabel) {
      ctx.font = "9px ui-sans-serif, system-ui, sans-serif";
      ctx.fillStyle = theme.fgMuted;
      ctx.fillText(p.activityLabel, cx, baseY + 21);
    }

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
  };

  // Depth-sorted scene — raised walls, furniture, and characters interleaved by
  // their baseline (screen-space bottom) so nearer things occlude farther ones.
  const scene: { baseY: number; draw: () => void }[] = [];

  // Glass-walled zones (focus pods, the lounge) read as framed glass partitions.
  const glassTypes = new Set(["pod", "lounge"]);
  const glassInfo = (wall: Wall): { glass: boolean; accent: string } => {
    const mx = wall.x + wall.w / 2;
    const my = wall.y + wall.h / 2;
    for (const r of rooms) {
      if (!r.type || !glassTypes.has(r.type)) continue;
      const onV =
        (Math.abs(mx - r.x) < 0.6 || Math.abs(mx - (r.x + r.w)) < 0.6) &&
        my >= r.y - 0.6 &&
        my <= r.y + r.h + 0.6;
      const onH =
        (Math.abs(my - r.y) < 0.6 || Math.abs(my - (r.y + r.h)) < 0.6) &&
        mx >= r.x - 0.6 &&
        mx <= r.x + r.w + 0.6;
      if (onV || onH) return { glass: true, accent: r.accent };
    }
    return { glass: false, accent: theme.surface3 };
  };

  for (const wall of walls) {
    const gi = glassInfo(wall);
    scene.push({
      baseY: wall.y + wall.h,
      draw: () =>
        drawRaisedWall(ctx, {
          wall,
          tile: TILE,
          color: theme.surface3,
          accent: gi.accent,
          glass: gi.glass,
          floorShadow: true,
        }),
    });
  }

  for (const room of rooms) {
    const objects =
      room.objects && room.objects.length ? room.objects : furnishRoom(room);
    for (const obj of objects) {
      const fh = obj.h ?? PROP_CATALOG[obj.kind].h;
      scene.push({
        baseY: obj.y + fh,
        draw: () =>
          drawProp(ctx, {
            kind: obj.kind,
            x: obj.x,
            y: obj.y,
            tile: TILE,
            w: obj.w,
            h: obj.h,
            rot: obj.rot,
            accent: room.accent,
            timeMs: time,
          }),
      });
    }
  }

  for (const p of participants) {
    scene.push({ baseY: p.y, draw: () => drawCharacter(p) });
  }

  scene.sort((a, b) => a.baseY - b.baseY);
  for (const item of scene) item.draw();

  // Global directional lighting + ambient occlusion overlay.
  applySceneLighting(ctx, {
    width: OFFICE_WIDTH,
    height: OFFICE_HEIGHT,
    rooms,
    tile: TILE,
  });

  // Labels on top — always readable above the lit, depth-sorted scene.
  for (const p of participants) drawLabel(p);

}
