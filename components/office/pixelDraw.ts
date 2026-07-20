// The render seam between the office canvas and the pixel-character system.
//
// `render.ts` calls `drawAvatar` once per participant with the participant's
// screen position, the pixel height to draw at, and the computed facing + walk
// frame. This module owns config resolution (agent key → bespoke look, else an
// explicit config, else the default) and the bottom-center anchoring, so the
// caller never has to know sprite dimensions. Kept React-free — plain Canvas 2D.
import { drawPixelMatrix } from "@/components/office/pixelSprite";
import { DEFAULT_AVATAR, type AvatarConfig, type Facing } from "@/lib/office/avatarConfig";
import { agentAvatar } from "@/lib/office/agentCharacters";
import {
  SPRITE_H,
  SPRITE_W,
  resolveAvatar,
  type ResolvedAvatar,
} from "@/lib/office/avatarSprites";

export interface DrawAvatarOptions {
  /** Explicit config (humans). Ignored when `agentKey` is given. */
  config?: AvatarConfig;
  /** Agent key — resolves to the agent's bespoke look. Wins over `config`. */
  agentKey?: string;
  /** Screen position of the avatar's FEET (bottom-center anchor). */
  x: number;
  y: number;
  /** Pixel height of the drawn sprite; width follows the sprite aspect ratio. */
  height: number;
  facing: Facing;
  /** 0 = idle, 1 = walk A, 2 = walk B. */
  frame: 0 | 1 | 2;
}

// Resolution is memoized inside `resolveAvatar`; this second cache keys the
// resolved result by agent key so the common (agent) path skips config rebuilds.
const agentCache = new Map<string, ResolvedAvatar>();

function resolve(opts: DrawAvatarOptions): ResolvedAvatar {
  if (opts.agentKey) {
    const hit = agentCache.get(opts.agentKey);
    if (hit) return hit;
    const resolved = resolveAvatar(agentAvatar(opts.agentKey));
    agentCache.set(opts.agentKey, resolved);
    return resolved;
  }
  return resolveAvatar(opts.config ?? DEFAULT_AVATAR);
}

/**
 * Draw one pixel-art character. The sprite is anchored BOTTOM-CENTER at (x, y)
 * — the feet sit exactly on y and the art is horizontally centered on x. Scale
 * comes from `height` (pxSize = height / SPRITE_H). The `side` art faces right,
 * so a `left` facing is drawn mirrored; `right` is drawn as-authored.
 */
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  opts: DrawAvatarOptions,
): void {
  const resolved = resolve(opts);
  const pxSize = opts.height / SPRITE_H;
  const spriteWidth = SPRITE_W * pxSize;

  const frames = resolved.frames[opts.facing];
  const rows = frames[opts.frame] ?? frames[0];

  const originX = opts.x - spriteWidth / 2;
  const originY = opts.y - opts.height; // feet on y
  const flipX = opts.facing === "left";

  drawPixelMatrix(ctx, rows, resolved.palette, originX, originY, pxSize, flipX);
}
