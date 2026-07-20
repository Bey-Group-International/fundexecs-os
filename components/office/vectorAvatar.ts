// The smooth-vector character engine + render seam for the Virtual Office.
//
// `render.ts` calls `drawAvatar` once per participant with a screen position, a
// pixel height, the computed facing, a clock (`timeMs`) and whether the figure
// is moving. This module owns config resolution (agent key → bespoke look, else
// an explicit config, else the default), bottom-center anchoring, and the whole
// lit, semi-3D figure: gradients for skin/hair/outfit, ambient-occlusion
// shadows, a soft rim light, tweened walk / idle breathing / blink — all drawn
// with Canvas 2D paths, no image or binary assets. Kept React-free so the draw
// loop stays cheap enough to run ~20 figures inside a rAF.
import {
  DEFAULT_AVATAR,
  type AvatarConfig,
  type Build,
  type Facing,
  type OutfitStyle,
} from "@/lib/office/avatarConfig";
import { agentAvatar } from "@/lib/office/agentCharacters";
import type { PresenceStatus } from "@/lib/office/presence";

export interface DrawAvatarOptions {
  /** Explicit config (humans). Ignored when `agentKey` is given. */
  config?: AvatarConfig;
  /** Agent key — resolves to the agent's bespoke look. Wins over `config`. */
  agentKey?: string;
  /** Screen position of the avatar's FEET (bottom-center anchor). */
  x: number;
  y: number;
  /** Total pixel height of the drawn figure (feet on y, centered on x). */
  height: number;
  facing: Facing;
  /** Clock in ms; drives all continuous animation (walk / breathe / blink). */
  timeMs: number;
  /** Whether the character is walking (tweened arm & leg swing + a bob). */
  moving: boolean;
  /** Optional presence status; softens the expression when set. */
  status?: PresenceStatus;
}

// ---------------------------------------------------------------------------
// Color helpers — all operate on "#rrggbb" hex.
// ---------------------------------------------------------------------------

function hexToRgb(hex: string): [number, number, number] {
  const h = hex.replace("#", "");
  const v =
    h.length === 3
      ? h
          .split("")
          .map((c) => c + c)
          .join("")
      : h;
  return [
    parseInt(v.slice(0, 2), 16),
    parseInt(v.slice(2, 4), 16),
    parseInt(v.slice(4, 6), 16),
  ];
}

function mix(hex: string, target: [number, number, number], amt: number): string {
  const [r, g, b] = hexToRgb(hex);
  const t = Math.max(0, Math.min(1, amt));
  const m = (a: number, bb: number) => Math.round(a + (bb - a) * t);
  const toHex = (n: number) => n.toString(16).padStart(2, "0");
  return `#${toHex(m(r, target[0]))}${toHex(m(g, target[1]))}${toHex(m(b, target[2]))}`;
}

const lighten = (hex: string, amt: number) => mix(hex, [255, 255, 255], amt);
const darken = (hex: string, amt: number) => mix(hex, [0, 0, 0], amt);

function rgba(hex: string, a: number): string {
  const [r, g, b] = hexToRgb(hex);
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

// ---------------------------------------------------------------------------
// Anatomy — all measurements are fractions of the total figure height H, in a
// feet-origin frame: y = 0 is the floor, the head sits at negative y (up).
// Horizontal widths are additionally scaled by the build multiplier.
// ---------------------------------------------------------------------------

const A = {
  hipY: 0.47,
  shoulderY: 0.7,
  chinY: 0.76,
  headCy: 0.855,
  headRx: 0.086,
  headRy: 0.1,
  crownY: 0.955,
  shoulderHalf: 0.15,
  waistHalf: 0.115,
  hipHalf: 0.11,
  armW: 0.05,
  armLen: 0.24,
  legW: 0.064,
  legLen: 0.47,
};

const BUILD_W: Record<Build, number> = {
  slim: 0.86,
  regular: 1,
  broad: 1.2,
};

// Outfit → sleeve length + neckline treatment.
const OUTFIT_META: Record<
  OutfitStyle,
  { sleeve: "short" | "long"; neck: "crew" | "vee" | "turtle" | "collar" | "hood" }
> = {
  tee: { sleeve: "short", neck: "crew" },
  vneck: { sleeve: "short", neck: "vee" },
  blazer: { sleeve: "long", neck: "collar" },
  turtleneck: { sleeve: "long", neck: "turtle" },
  dress_shirt: { sleeve: "long", neck: "collar" },
  hoodie: { sleeve: "long", neck: "hood" },
};

// ---------------------------------------------------------------------------
// Gradient memo — gradients are the per-figure cost worth caching. Keyed by the
// colors + build + height that shape them, and scoped per-context (a gradient
// belongs to the context that created it). Coordinates live in the feet-origin
// local frame; because gradient coords are resolved through the CTM at paint
// time, the same cached object tracks the figure wherever it's translated.
// ---------------------------------------------------------------------------

interface GradBundle {
  skin: CanvasGradient;
  hair: CanvasGradient;
  outfit: CanvasGradient;
}

const gradCaches = new WeakMap<
  CanvasRenderingContext2D,
  Map<string, GradBundle>
>();

function gradKey(cfg: AvatarConfig, height: number): string {
  return `${cfg.skin}|${cfg.hairColor}|${cfg.outfitColor}|${cfg.build}|${Math.round(
    height,
  )}`;
}

function buildGradients(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
): GradBundle {
  const w = BUILD_W[cfg.build];

  // Skin: a soft radial highlight from the upper-left of the head falling to a
  // shaded lower-right — the core of the semi-3D read on the face.
  const skin = ctx.createRadialGradient(
    -A.headRx * 0.5 * H,
    -(A.headCy + A.headRy * 0.35) * H,
    A.headRx * 0.15 * H,
    -A.headRx * 0.1 * H,
    -A.headCy * H,
    A.headRy * 1.5 * H,
  );
  skin.addColorStop(0, lighten(cfg.skin, 0.26));
  skin.addColorStop(0.55, cfg.skin);
  skin.addColorStop(1, darken(cfg.skin, 0.16));

  // Hair: a top-down sheen — bright crown, base body, darker underside.
  const hair = ctx.createLinearGradient(
    -A.headRx * 0.4 * H,
    -A.crownY * H,
    A.headRx * 0.4 * H,
    -A.chinY * H,
  );
  hair.addColorStop(0, lighten(cfg.hairColor, 0.3));
  hair.addColorStop(0.4, cfg.hairColor);
  hair.addColorStop(1, darken(cfg.hairColor, 0.22));

  // Outfit: a diagonal light-to-shadow across the torso.
  const outfit = ctx.createLinearGradient(
    -A.shoulderHalf * w * H,
    -A.shoulderY * H,
    A.waistHalf * w * H,
    -A.hipY * H,
  );
  outfit.addColorStop(0, lighten(cfg.outfitColor, 0.16));
  outfit.addColorStop(0.5, cfg.outfitColor);
  outfit.addColorStop(1, darken(cfg.outfitColor, 0.2));

  return { skin, hair, outfit };
}

function gradientsFor(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
): GradBundle {
  let perCtx = gradCaches.get(ctx);
  if (!perCtx) {
    perCtx = new Map();
    gradCaches.set(ctx, perCtx);
  }
  const key = gradKey(cfg, H);
  const hit = perCtx.get(key);
  if (hit) return hit;
  const bundle = buildGradients(ctx, cfg, H);
  perCtx.set(key, bundle);
  return bundle;
}

// ---------------------------------------------------------------------------
// Path helpers.
// ---------------------------------------------------------------------------

function capsule(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  w: number,
  h: number,
): void {
  const r = Math.min(w / 2, h / 2);
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function ellipse(
  ctx: CanvasRenderingContext2D,
  cx: number,
  cy: number,
  rx: number,
  ry: number,
): void {
  ctx.beginPath();
  ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
}

// Trace the front/back torso outline onto the current path (no Path2D so it
// runs anywhere, including the node test env). Call before fill/stroke/clip.
function traceTorso(
  ctx: CanvasRenderingContext2D,
  shoulderY: number,
  hipY: number,
  shoulderHalf: number,
  hipHalf: number,
  H: number,
): void {
  ctx.beginPath();
  ctx.moveTo(-shoulderHalf, shoulderY);
  ctx.quadraticCurveTo(-shoulderHalf * 1.02, (shoulderY + hipY) / 2, -hipHalf, hipY);
  ctx.lineTo(hipHalf, hipY);
  ctx.quadraticCurveTo(shoulderHalf * 1.02, (shoulderY + hipY) / 2, shoulderHalf, shoulderY);
  ctx.quadraticCurveTo(0, shoulderY - 0.02 * H, -shoulderHalf, shoulderY);
  ctx.closePath();
}

const OUTLINE = "rgba(17, 22, 34, 0.5)";

// ---------------------------------------------------------------------------
// Pose — everything the animation clock produces, resolved once per call.
// ---------------------------------------------------------------------------

interface Pose {
  armSwing: number;
  legSwing: number;
  bob: number;
  breathe: number;
  blink: number; // 1 = open, 0 = closed
}

function computePose(timeMs: number, moving: boolean): Pose {
  const t = timeMs / 1000;
  // ~1.9 strides/sec while walking.
  const phase = t * Math.PI * 3.8;
  if (moving) {
    const swing = Math.sin(phase);
    return {
      armSwing: -swing * 0.55,
      legSwing: swing * 0.5,
      bob: Math.abs(Math.cos(phase)) * 0.012,
      breathe: 1,
      blink: blinkAt(t),
    };
  }
  return {
    armSwing: Math.sin(t * 1.6) * 0.04,
    legSwing: 0,
    bob: 0,
    breathe: 1 + (Math.sin(t * 1.9) + 1) * 0.5 * 0.02,
    blink: blinkAt(t),
  };
}

// A blink every ~4.2s lasting ~140ms, eased.
function blinkAt(t: number): number {
  const period = 4.2;
  const local = t % period;
  const dur = 0.14;
  if (local > dur) return 1;
  const p = local / dur; // 0..1
  // down then up
  return Math.abs(Math.cos(p * Math.PI)) < 0.001 ? 0 : Math.abs(Math.cos(p * Math.PI));
}

// ---------------------------------------------------------------------------
// Config resolution.
// ---------------------------------------------------------------------------

function resolveConfig(opts: DrawAvatarOptions): AvatarConfig {
  if (opts.agentKey) return agentAvatar(opts.agentKey);
  return opts.config ?? DEFAULT_AVATAR;
}

// ---------------------------------------------------------------------------
// Public seam.
// ---------------------------------------------------------------------------

/**
 * Draw one smooth-vector character, anchored BOTTOM-CENTER at (x, y): the feet
 * sit on y, the figure is centered on x, and its total pixel height is
 * `height`. Continuous animation comes from `timeMs` (no discrete frames).
 *
 * Facing: `down` is the front view, `up` the back, and `left`/`right` the
 * profile. The profile art is authored facing LEFT; `right` is that same art
 * mirrored via a horizontal flip.
 */
export function drawAvatar(
  ctx: CanvasRenderingContext2D,
  opts: DrawAvatarOptions,
): void {
  const cfg = resolveConfig(opts);
  const H = opts.height;
  const pose = computePose(opts.timeMs, opts.moving);
  // Warm the per-context gradient cache for this (config, height) up front.
  gradientsFor(ctx, cfg, H);

  ctx.save();
  ctx.translate(opts.x, opts.y);

  // Soft contact shadow on the floor (drawn in untransformed feet frame).
  const shW = A.shoulderHalf * BUILD_W[cfg.build] * H * 1.5;
  const shadow = ctx.createRadialGradient(0, 0, 0, 0, 0, shW);
  shadow.addColorStop(0, "rgba(0,0,0,0.32)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ellipse(ctx, 0, 0, shW, shW * 0.28);
  ctx.fill();

  if (opts.status === "away") ctx.globalAlpha = 0.82;

  // Vertical bob (walk) lifts the whole figure a touch.
  ctx.translate(0, -pose.bob * H);

  const side = opts.facing === "left" || opts.facing === "right";
  if (opts.facing === "right") ctx.scale(-1, 1); // mirror the LEFT-facing art

  if (opts.facing === "up") {
    drawBack(ctx, cfg, H, pose);
  } else if (side) {
    drawSide(ctx, cfg, H, pose, opts.status);
  } else {
    drawFront(ctx, cfg, H, pose, opts.status);
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Shared limb drawing. Origin is the pivot (shoulder / hip); the limb extends
// downward (+y) and is rotated by `angle`. Shaded with a light edge (rim) and a
// shadow edge for the semi-3D read.
// ---------------------------------------------------------------------------

function drawLimb(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  angle: number,
  len: number,
  w: number,
  color: string,
  handColor: string | null,
  handR: number,
): void {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);

  capsule(ctx, -w / 2, 0, w, len);
  ctx.fillStyle = color;
  ctx.fill();
  ctx.lineWidth = Math.max(1, w * 0.12);
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // Rim light on the left edge, shadow on the right.
  capsule(ctx, -w / 2, 0, w * 0.4, len);
  ctx.fillStyle = rgba("#ffffff", 0.14);
  ctx.fill();
  capsule(ctx, w * 0.1, 0, w * 0.4, len);
  ctx.fillStyle = "rgba(0,0,0,0.14)";
  ctx.fill();

  if (handColor) {
    ellipse(ctx, 0, len, handR, handR);
    ctx.fillStyle = handColor;
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  ctx.restore();
}

function drawFoot(
  ctx: CanvasRenderingContext2D,
  px: number,
  py: number,
  angle: number,
  w: number,
  dir: number,
): void {
  ctx.save();
  ctx.translate(px, py);
  ctx.rotate(angle);
  ellipse(ctx, dir * w * 0.35, 0, w * 0.85, w * 0.5);
  ctx.fillStyle = "#26313f";
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// FRONT (facing "down").
// ---------------------------------------------------------------------------

function drawFront(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  pose: Pose,
  status?: PresenceStatus,
): void {
  const w = BUILD_W[cfg.build];
  const grads = gradientsFor(ctx, cfg, H);
  const meta = OUTFIT_META[cfg.outfit];

  const hipY = -A.hipY * H;
  const shoulderY = -A.shoulderY * H;
  const hipHalf = A.hipHalf * w * H;
  const shoulderHalf = A.shoulderHalf * w * H;
  const legLen = A.legLen * H;
  const legW = A.legW * w * H;
  const armLen = A.armLen * H;
  const armW = A.armW * w * H;
  const sleeveColor = cfg.outfitColor;

  // ---- Legs (behind torso) ----
  const legX = hipHalf * 0.55;
  const trouser = darken(cfg.outfitColor, 0.35);
  for (const s of [-1, 1] as const) {
    const ang = s * pose.legSwing;
    drawFoot(ctx, s * legX + Math.sin(ang) * legLen, hipY + Math.cos(ang) * legLen, ang, legW, s);
    drawLimb(ctx, s * legX, hipY, ang, legLen, legW, trouser, null, 0);
  }

  // ---- Back arm hint drawn before torso for depth (right side) ----
  // (handled with front arms below; front view keeps both arms at the sides)

  // ---- Torso / outfit ----
  ctx.save();
  // Subtle idle breathing: scale the torso vertically about the hips.
  ctx.translate(0, hipY);
  ctx.scale(1, pose.breathe);
  ctx.translate(0, -hipY);
  traceTorso(ctx, shoulderY, hipY, shoulderHalf, hipHalf, H);
  ctx.fillStyle = grads.outfit;
  ctx.fill();
  ctx.lineWidth = Math.max(1, 0.01 * H);
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();

  // Rim light down the left seam.
  ctx.save();
  traceTorso(ctx, shoulderY, hipY, shoulderHalf, hipHalf, H);
  ctx.clip();
  ctx.beginPath();
  ctx.moveTo(-shoulderHalf * 0.96, shoulderY);
  ctx.lineTo(-hipHalf * 0.9, hipY);
  ctx.lineWidth = 0.02 * H;
  ctx.strokeStyle = rgba("#ffffff", 0.16);
  ctx.stroke();
  // Ambient occlusion under the arms / sides and along the hem.
  ctx.beginPath();
  ctx.moveTo(hipHalf * 0.4, hipY);
  ctx.lineTo(-hipHalf * 0.4, hipY);
  ctx.lineWidth = 0.05 * H;
  ctx.strokeStyle = "rgba(0,0,0,0.16)";
  ctx.stroke();
  ctx.restore();

  drawOutfitDetail(ctx, cfg, H, w, shoulderY, hipY, shoulderHalf);
  ctx.restore();

  // ---- Arms (over the torso sides) ----
  const shoulderX = shoulderHalf * 0.88;
  for (const s of [-1, 1] as const) {
    const ang = s * pose.armSwing;
    if (meta.sleeve === "short") {
      // Upper arm in the outfit color, forearm + hand in skin.
      const upper = armLen * 0.42;
      drawLimb(ctx, s * shoulderX, shoulderY + 0.01 * H, ang, upper, armW, sleeveColor, null, 0);
      drawLimb(
        ctx,
        s * shoulderX + Math.sin(ang) * upper,
        shoulderY + 0.01 * H + Math.cos(ang) * upper,
        ang,
        armLen - upper,
        armW * 0.86,
        cfg.skin,
        cfg.skin,
        armW * 0.55,
      );
    } else {
      drawLimb(
        ctx,
        s * shoulderX,
        shoulderY + 0.01 * H,
        ang,
        armLen,
        armW,
        sleeveColor,
        cfg.skin,
        armW * 0.55,
      );
    }
  }

  // ---- Neck + head group (lifted with the breath so it stays attached) ----
  const lift = (pose.breathe - 1) * (A.shoulderY - A.hipY) * H;
  ctx.save();
  ctx.translate(0, -lift);
  drawNeck(ctx, cfg, H, w, grads);
  drawHairBack(ctx, cfg, H, grads);
  drawHead(ctx, cfg, H, grads);
  drawEars(ctx, cfg, H);
  drawFace(ctx, cfg, H, pose, "front", status);
  drawHairFront(ctx, cfg, H, grads);
  drawAccessory(ctx, cfg, H, "front");
  drawTurtleneckCollar(ctx, cfg, H, w);
  ctx.restore();
}

function drawNeck(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  w: number,
  grads: GradBundle,
): void {
  const neckW = A.headRx * 1.05 * H;
  const top = -A.chinY * H;
  const bottom = -(A.shoulderY - 0.01) * H;
  ctx.beginPath();
  ctx.moveTo(-neckW / 2, top);
  ctx.lineTo(neckW / 2, top);
  ctx.lineTo(neckW / 2, bottom);
  ctx.lineTo(-neckW / 2, bottom);
  ctx.closePath();
  ctx.fillStyle = grads.skin;
  ctx.fill();
  // AO under the chin.
  ellipse(ctx, 0, top + 0.006 * H, neckW * 0.6, 0.02 * H);
  ctx.fillStyle = "rgba(0,0,0,0.22)";
  ctx.fill();
}

function drawHead(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  grads: GradBundle,
): void {
  const cy = -A.headCy * H;
  ctx.save();
  ellipse(ctx, 0, cy, A.headRx * H, A.headRy * H);
  ctx.fillStyle = grads.skin;
  ctx.fill();
  ctx.lineWidth = Math.max(1, 0.008 * H);
  ctx.strokeStyle = OUTLINE;
  ctx.stroke();
  // Rim light on the right cheek.
  ctx.clip();
  ctx.beginPath();
  ctx.ellipse(A.headRx * 0.7 * H, cy, A.headRx * 0.4 * H, A.headRy * 0.8 * H, 0, 0, Math.PI * 2);
  ctx.fillStyle = rgba("#ffffff", 0.1);
  ctx.fill();
  ctx.restore();
}

function drawEars(ctx: CanvasRenderingContext2D, cfg: AvatarConfig, H: number): void {
  const cy = -(A.headCy - 0.005) * H;
  for (const s of [-1, 1] as const) {
    ellipse(ctx, s * A.headRx * H, cy, 0.018 * H, 0.026 * H);
    ctx.fillStyle = darken(cfg.skin, 0.04);
    ctx.fill();
    ctx.strokeStyle = OUTLINE;
    ctx.lineWidth = 1;
    ctx.stroke();
  }
  if (cfg.accessory === "earrings") {
    for (const s of [-1, 1] as const) {
      ellipse(ctx, s * A.headRx * H, cy + 0.03 * H, 0.008 * H, 0.008 * H);
      ctx.fillStyle = "#e7c65b";
      ctx.fill();
    }
  }
}

// ---------------------------------------------------------------------------
// Face — eyes, brows, nose, mouth, facial hair. `view` is "front" or "side".
// ---------------------------------------------------------------------------

function drawFace(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  pose: Pose,
  view: "front" | "side",
  status?: PresenceStatus,
): void {
  const eyeY = -(A.headCy - 0.012) * H;
  const eyeDX = (view === "side" ? 0.028 : 0.036) * H;
  const eyeRx = 0.015 * H;
  const eyeRy = 0.019 * H * pose.blink;
  const positions = view === "side" ? [eyeDX * 0.7] : [-eyeDX, eyeDX];

  drawFacialHairUnder(ctx, cfg, H);

  for (const ex of positions) {
    // Brow.
    ctx.beginPath();
    ctx.moveTo(ex - eyeRx, eyeY - 0.03 * H);
    ctx.quadraticCurveTo(ex, eyeY - 0.038 * H, ex + eyeRx, eyeY - 0.03 * H);
    ctx.lineWidth = Math.max(1, 0.008 * H);
    ctx.strokeStyle = darken(cfg.hairColor, 0.1);
    ctx.lineCap = "round";
    ctx.stroke();

    if (pose.blink < 0.15) {
      // Closed lid.
      ctx.beginPath();
      ctx.moveTo(ex - eyeRx, eyeY);
      ctx.lineTo(ex + eyeRx, eyeY);
      ctx.lineWidth = Math.max(1, 0.006 * H);
      ctx.strokeStyle = darken(cfg.skin, 0.4);
      ctx.stroke();
      continue;
    }
    // Sclera.
    ellipse(ctx, ex, eyeY, eyeRx, Math.max(0.001, eyeRy));
    ctx.fillStyle = "#f6f7f9";
    ctx.fill();
    // Iris.
    ellipse(ctx, ex, eyeY, eyeRx * 0.6, Math.max(0.001, eyeRy * 0.85));
    ctx.fillStyle = cfg.eyes;
    ctx.fill();
    // Pupil + catch light.
    ellipse(ctx, ex, eyeY, eyeRx * 0.28, Math.max(0.001, eyeRy * 0.5));
    ctx.fillStyle = "#12161f";
    ctx.fill();
    ellipse(ctx, ex - eyeRx * 0.25, eyeY - eyeRy * 0.3, eyeRx * 0.14, eyeRx * 0.14);
    ctx.fillStyle = rgba("#ffffff", 0.9);
    ctx.fill();
  }

  // Nose.
  const noseY = -(A.headCy - 0.05) * H;
  const noseX = view === "side" ? 0.03 * H : 0;
  ctx.beginPath();
  ctx.moveTo(noseX, noseY - 0.015 * H);
  if (view === "side") {
    ctx.lineTo(noseX + 0.02 * H, noseY);
    ctx.lineTo(noseX, noseY + 0.006 * H);
  } else {
    ctx.quadraticCurveTo(noseX + 0.012 * H, noseY, noseX, noseY + 0.008 * H);
  }
  ctx.lineWidth = Math.max(1, 0.006 * H);
  ctx.strokeStyle = darken(cfg.skin, 0.22);
  ctx.stroke();

  // Mouth — softened by status.
  const mouthY = -(A.headCy - 0.078) * H;
  const mouthW = (view === "side" ? 0.028 : 0.04) * H;
  const smile =
    status === "away" ? -0.004 : status === "in_meeting" || status === "focusing" ? 0.002 : 0.01;
  const mx = view === "side" ? 0.012 * H : 0;
  ctx.beginPath();
  ctx.moveTo(mx - mouthW / 2, mouthY);
  ctx.quadraticCurveTo(mx, mouthY + smile * H, mx + mouthW / 2, mouthY);
  ctx.lineWidth = Math.max(1, 0.008 * H);
  ctx.strokeStyle = darken(cfg.skin, 0.35);
  ctx.lineCap = "round";
  ctx.stroke();

  drawFacialHairOver(ctx, cfg, H, view);
}

function drawFacialHairUnder(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
): void {
  if (cfg.facialHair === "stubble") {
    ctx.save();
    ellipse(ctx, 0, -(A.headCy - 0.055) * H, A.headRx * 0.95 * H, A.headRy * 0.62 * H);
    ctx.clip();
    ellipse(ctx, 0, -(A.chinY - 0.005) * H, A.headRx * 1.1 * H, A.headRy * 0.6 * H);
    ctx.fillStyle = rgba(darken(cfg.hairColor, 0.1), 0.28);
    ctx.fill();
    ctx.restore();
  }
}

function drawFacialHairOver(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  view: "front" | "side",
): void {
  if (cfg.facialHair === "beard") {
    const chin = -(A.chinY - 0.01) * H;
    ctx.beginPath();
    ctx.moveTo(-A.headRx * 0.95 * H, -(A.headCy - 0.02) * H);
    ctx.quadraticCurveTo(-A.headRx * H, chin - 0.02 * H, 0, chin);
    ctx.quadraticCurveTo(A.headRx * H, chin - 0.02 * H, A.headRx * 0.95 * H, -(A.headCy - 0.02) * H);
    ctx.quadraticCurveTo(0, -(A.headCy - 0.06) * H, -A.headRx * 0.95 * H, -(A.headCy - 0.02) * H);
    ctx.closePath();
    ctx.fillStyle = cfg.hairColor;
    ctx.fill();
    ctx.fillStyle = rgba("#ffffff", 0.06);
    ctx.fill();
  } else if (cfg.facialHair === "mustache") {
    const my = -(A.headCy - 0.066) * H;
    const mw = (view === "side" ? 0.026 : 0.042) * H;
    const mx = view === "side" ? 0.012 * H : 0;
    ctx.beginPath();
    ctx.moveTo(mx - mw / 2, my);
    ctx.quadraticCurveTo(mx, my + 0.014 * H, mx + mw / 2, my);
    ctx.quadraticCurveTo(mx, my + 0.006 * H, mx - mw / 2, my);
    ctx.closePath();
    ctx.fillStyle = cfg.hairColor;
    ctx.fill();
  }
}

// ---------------------------------------------------------------------------
// Hair — split into a back layer (behind the head) and a front layer (fringe /
// top), so styles read with volume. 8 styles implemented.
// ---------------------------------------------------------------------------

function drawHairBack(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  grads: GradBundle,
): void {
  const cy = -A.headCy * H;
  const rx = A.headRx * H;
  const ry = A.headRy * H;
  ctx.fillStyle = grads.hair;

  switch (cfg.hair) {
    case "long": {
      ctx.beginPath();
      ctx.moveTo(-rx * 1.15, cy - ry * 0.4);
      ctx.quadraticCurveTo(-rx * 1.5, cy + ry * 2.4, -rx * 0.7, -A.shoulderY * H);
      ctx.lineTo(rx * 0.7, -A.shoulderY * H);
      ctx.quadraticCurveTo(rx * 1.5, cy + ry * 2.4, rx * 1.15, cy - ry * 0.4);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "ponytail": {
      ellipse(ctx, rx * 0.1, cy - ry * 0.4, rx * 0.28, ry * 0.55);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(rx * 0.2, cy - ry * 0.2);
      ctx.quadraticCurveTo(rx * 1.6, cy + ry * 1.2, rx * 1.0, cy + ry * 2.6);
      ctx.quadraticCurveTo(rx * 0.7, cy + ry * 1.4, rx * 0.1, cy);
      ctx.closePath();
      ctx.fill();
      break;
    }
    case "bun": {
      ellipse(ctx, 0, cy - ry * 1.0, rx * 0.42, rx * 0.42);
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1;
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}

function drawHairFront(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  grads: GradBundle,
): void {
  if (cfg.hair === "bald") return;
  const cy = -A.headCy * H;
  const rx = A.headRx * H;
  const ry = A.headRy * H;
  ctx.fillStyle = grads.hair;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, 0.006 * H);

  const capLow = () => {
    // Close-cropped cap hugging the skull.
    ctx.beginPath();
    ctx.ellipse(0, cy - ry * 0.12, rx * 1.02, ry * 0.95, 0, Math.PI, 0);
    ctx.quadraticCurveTo(rx * 0.9, cy - ry * 0.3, rx * 0.86, cy);
    ctx.quadraticCurveTo(0, cy - ry * 0.55, -rx * 0.86, cy);
    ctx.quadraticCurveTo(-rx * 0.9, cy - ry * 0.3, -rx * 1.02, cy - ry * 0.12);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
  };

  switch (cfg.hair) {
    case "buzz": {
      ctx.save();
      ctx.globalAlpha = 0.85;
      ctx.beginPath();
      ctx.ellipse(0, cy - ry * 0.1, rx * 0.98, ry * 0.85, 0, Math.PI, 0);
      ctx.quadraticCurveTo(0, cy - ry * 0.35, -rx * 0.98, cy - ry * 0.1);
      ctx.closePath();
      ctx.fill();
      ctx.restore();
      break;
    }
    case "short": {
      ctx.beginPath();
      ctx.ellipse(0, cy - ry * 0.05, rx * 1.05, ry * 1.02, 0, Math.PI, 0);
      // Fringe sweeping across the brow.
      ctx.quadraticCurveTo(rx * 1.0, cy - ry * 0.2, rx * 0.75, cy - ry * 0.05);
      ctx.quadraticCurveTo(rx * 0.2, cy - ry * 0.5, -rx * 0.2, cy - ry * 0.3);
      ctx.quadraticCurveTo(-rx * 0.7, cy - ry * 0.6, -rx * 1.05, cy - ry * 0.05);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "mohawk": {
      // Shaved sides (skin shows), a raised central strip.
      ctx.beginPath();
      ctx.moveTo(-rx * 0.22, cy);
      ctx.lineTo(-rx * 0.28, cy - ry * 1.55);
      ctx.quadraticCurveTo(0, cy - ry * 1.85, rx * 0.28, cy - ry * 1.55);
      ctx.lineTo(rx * 0.22, cy);
      ctx.quadraticCurveTo(0, cy - ry * 0.4, -rx * 0.22, cy);
      ctx.closePath();
      ctx.fill();
      ctx.stroke();
      break;
    }
    case "curly": {
      // A ring of overlapping puffs for volume.
      const puffs = 9;
      for (let i = 0; i <= puffs; i++) {
        const a = Math.PI + (Math.PI * i) / puffs;
        const px = Math.cos(a) * rx * 1.02;
        const py = cy + Math.sin(a) * ry * 1.02 - ry * 0.1;
        ellipse(ctx, px, py, rx * 0.32, rx * 0.32);
        ctx.fill();
      }
      ellipse(ctx, 0, cy - ry * 0.4, rx * 0.85, ry * 0.7);
      ctx.fill();
      break;
    }
    case "long":
    case "ponytail":
    case "bun":
    default: {
      capLow();
      break;
    }
  }

  // Hair sheen streak.
  ctx.save();
  ctx.beginPath();
  ctx.moveTo(-rx * 0.5, cy - ry * 0.6);
  ctx.quadraticCurveTo(0, cy - ry * 0.85, rx * 0.2, cy - ry * 0.55);
  ctx.lineWidth = Math.max(1, 0.01 * H);
  ctx.strokeStyle = rgba("#ffffff", 0.18);
  ctx.lineCap = "round";
  ctx.stroke();
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Outfit detail — necklines, plackets, lapels, hoods.
// ---------------------------------------------------------------------------

function drawOutfitDetail(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  w: number,
  shoulderY: number,
  hipY: number,
  shoulderHalf: number,
): void {
  const meta = OUTFIT_META[cfg.outfit];
  const neckHalf = A.headRx * 0.6 * H;

  if (meta.neck === "vee") {
    ctx.beginPath();
    ctx.moveTo(-neckHalf, shoulderY);
    ctx.lineTo(0, shoulderY + 0.06 * H);
    ctx.lineTo(neckHalf, shoulderY);
    ctx.closePath();
    ctx.fillStyle = darken(cfg.outfitColor, 0.25);
    ctx.fill();
  } else if (meta.neck === "crew") {
    ctx.beginPath();
    ctx.ellipse(0, shoulderY + 0.004 * H, neckHalf, 0.014 * H, 0, 0, Math.PI);
    ctx.strokeStyle = darken(cfg.outfitColor, 0.28);
    ctx.lineWidth = Math.max(1, 0.008 * H);
    ctx.stroke();
  } else if (meta.neck === "collar") {
    if (cfg.outfit === "blazer") {
      // Shirt triangle + lapels.
      ctx.beginPath();
      ctx.moveTo(-neckHalf * 1.1, shoulderY + 0.005 * H);
      ctx.lineTo(0, shoulderY + 0.11 * H);
      ctx.lineTo(neckHalf * 1.1, shoulderY + 0.005 * H);
      ctx.closePath();
      ctx.fillStyle = "#e9edf3";
      ctx.fill();
      // Tie hint.
      ctx.beginPath();
      ctx.moveTo(-0.012 * H, shoulderY + 0.02 * H);
      ctx.lineTo(0.012 * H, shoulderY + 0.02 * H);
      ctx.lineTo(0.02 * H, hipY * 0.7 + shoulderY * 0.3);
      ctx.lineTo(-0.02 * H, hipY * 0.7 + shoulderY * 0.3);
      ctx.closePath();
      ctx.fillStyle = darken(cfg.outfitColor, 0.35);
      ctx.fill();
      for (const s of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(s * neckHalf * 1.1, shoulderY + 0.005 * H);
        ctx.lineTo(s * shoulderHalf * 0.8, shoulderY + 0.02 * H);
        ctx.lineTo(s * 0.02 * H, shoulderY + 0.13 * H);
        ctx.closePath();
        ctx.fillStyle = darken(cfg.outfitColor, 0.12);
        ctx.fill();
      }
    } else {
      // Dress shirt: collar wings + button placket.
      for (const s of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(0, shoulderY + 0.01 * H);
        ctx.lineTo(s * neckHalf * 1.3, shoulderY + 0.01 * H);
        ctx.lineTo(s * 0.01 * H, shoulderY + 0.06 * H);
        ctx.closePath();
        ctx.fillStyle = lighten(cfg.outfitColor, 0.12);
        ctx.fill();
        ctx.strokeStyle = darken(cfg.outfitColor, 0.2);
        ctx.lineWidth = 1;
        ctx.stroke();
      }
      ctx.beginPath();
      ctx.moveTo(0, shoulderY + 0.05 * H);
      ctx.lineTo(0, hipY);
      ctx.strokeStyle = darken(cfg.outfitColor, 0.22);
      ctx.lineWidth = Math.max(1, 0.006 * H);
      ctx.stroke();
    }
  } else if (meta.neck === "hood") {
    // Hood behind the neck + kangaroo pocket + drawstrings.
    ctx.beginPath();
    ctx.moveTo(-neckHalf * 1.5, shoulderY + 0.01 * H);
    ctx.quadraticCurveTo(0, shoulderY - 0.05 * H, neckHalf * 1.5, shoulderY + 0.01 * H);
    ctx.quadraticCurveTo(0, shoulderY + 0.05 * H, -neckHalf * 1.5, shoulderY + 0.01 * H);
    ctx.closePath();
    ctx.fillStyle = darken(cfg.outfitColor, 0.18);
    ctx.fill();
    for (const s of [-1, 1] as const) {
      ctx.beginPath();
      ctx.moveTo(s * 0.01 * H, shoulderY + 0.03 * H);
      ctx.lineTo(s * 0.012 * H, shoulderY + 0.14 * H);
      ctx.strokeStyle = lighten(cfg.outfitColor, 0.2);
      ctx.lineWidth = Math.max(1, 0.006 * H);
      ctx.stroke();
    }
    const py = (shoulderY + hipY) / 2 + 0.04 * H;
    ctx.beginPath();
    ctx.moveTo(-0.07 * H * w, py);
    ctx.lineTo(0.07 * H * w, py);
    ctx.lineTo(0.06 * H * w, hipY - 0.02 * H);
    ctx.lineTo(-0.06 * H * w, hipY - 0.02 * H);
    ctx.closePath();
    ctx.strokeStyle = darken(cfg.outfitColor, 0.22);
    ctx.lineWidth = 1;
    ctx.stroke();
  }
}

// Turtleneck collar wraps the lower head; drawn in the head group so it sits
// over the neck and under the chin.
function drawTurtleneckCollar(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  w: number,
): void {
  if (cfg.outfit !== "turtleneck") return;
  const top = -(A.chinY - 0.01) * H;
  const neckW = A.headRx * 1.5 * H;
  capsule(ctx, -neckW / 2, top, neckW, 0.055 * H);
  ctx.fillStyle = lighten(cfg.outfitColor, 0.04);
  ctx.fill();
  ctx.strokeStyle = darken(cfg.outfitColor, 0.2);
  ctx.lineWidth = 1;
  ctx.stroke();
}

// ---------------------------------------------------------------------------
// Accessories — glasses, sunglasses, headset, cap, beanie (earrings live in
// drawEars). Drawn over the face/hair.
// ---------------------------------------------------------------------------

function drawAccessory(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  view: "front" | "side" | "back",
): void {
  const cy = -A.headCy * H;
  const rx = A.headRx * H;
  const ry = A.headRy * H;

  switch (cfg.accessory) {
    case "glasses":
    case "sunglasses": {
      if (view === "back") break;
      const eyeY = -(A.headCy - 0.012) * H;
      const eyeDX = (view === "side" ? 0.028 : 0.036) * H;
      const lensR = 0.024 * H;
      const dark = cfg.accessory === "sunglasses";
      const lenses = view === "side" ? [eyeDX * 0.7] : [-eyeDX, eyeDX];
      for (const ex of lenses) {
        ellipse(ctx, ex, eyeY, lensR, lensR * 0.85);
        if (dark) {
          ctx.fillStyle = "rgba(20,24,32,0.9)";
          ctx.fill();
          ellipse(ctx, ex - lensR * 0.3, eyeY - lensR * 0.3, lensR * 0.3, lensR * 0.22);
          ctx.fillStyle = rgba("#ffffff", 0.35);
          ctx.fill();
        } else {
          ctx.fillStyle = "rgba(180,210,235,0.22)";
          ctx.fill();
        }
        ctx.strokeStyle = "#1b1f28";
        ctx.lineWidth = Math.max(1, 0.006 * H);
        ctx.stroke();
      }
      if (lenses.length === 2) {
        ctx.beginPath();
        ctx.moveTo(-eyeDX + lensR, eyeY);
        ctx.lineTo(eyeDX - lensR, eyeY);
        ctx.strokeStyle = "#1b1f28";
        ctx.lineWidth = Math.max(1, 0.006 * H);
        ctx.stroke();
      }
      break;
    }
    case "cap": {
      const brimDir = view === "side" ? 1 : 0;
      ctx.beginPath();
      ctx.ellipse(0, cy - ry * 0.15, rx * 1.05, ry * 0.9, 0, Math.PI, 0);
      ctx.closePath();
      ctx.fillStyle = darken(cfg.outfitColor, 0.1);
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1;
      ctx.stroke();
      // Brim.
      ctx.beginPath();
      if (brimDir) {
        ctx.ellipse(rx * 0.9, cy - ry * 0.35, rx * 0.7, ry * 0.18, 0, Math.PI, 0);
      } else {
        ctx.ellipse(0, cy - ry * 0.55, rx * 0.85, ry * 0.2, 0, 0, Math.PI);
      }
      ctx.closePath();
      ctx.fillStyle = darken(cfg.outfitColor, 0.2);
      ctx.fill();
      break;
    }
    case "beanie": {
      ctx.beginPath();
      ctx.ellipse(0, cy - ry * 0.05, rx * 1.08, ry * 1.0, 0, Math.PI, 0);
      ctx.quadraticCurveTo(rx * 1.08, cy - ry * 0.1, rx * 1.02, cy - ry * 0.25);
      ctx.lineTo(-rx * 1.02, cy - ry * 0.25);
      ctx.quadraticCurveTo(-rx * 1.08, cy - ry * 0.1, -rx * 1.08, cy - ry * 0.05);
      ctx.closePath();
      ctx.fillStyle = cfg.outfitColor;
      ctx.fill();
      ctx.strokeStyle = OUTLINE;
      ctx.lineWidth = 1;
      ctx.stroke();
      // Folded brim.
      capsule(ctx, -rx * 1.04, cy - ry * 0.34, rx * 2.08, 0.03 * H);
      ctx.fillStyle = lighten(cfg.outfitColor, 0.12);
      ctx.fill();
      break;
    }
    case "headset": {
      // Band over the crown.
      ctx.beginPath();
      ctx.ellipse(0, cy - ry * 0.2, rx * 1.02, ry * 0.95, 0, Math.PI * 1.05, Math.PI * 1.95);
      ctx.strokeStyle = "#2a2f3a";
      ctx.lineWidth = Math.max(2, 0.014 * H);
      ctx.stroke();
      // Ear cups.
      const cups = view === "side" ? [-1] : [-1, 1];
      for (const s of cups) {
        ellipse(ctx, s * rx * 1.0, cy - ry * 0.02, 0.024 * H, 0.03 * H);
        ctx.fillStyle = "#2a2f3a";
        ctx.fill();
      }
      // Mic boom to the mouth.
      ctx.beginPath();
      ctx.moveTo(-rx * 1.0, cy);
      ctx.quadraticCurveTo(-rx * 0.9, -(A.headCy - 0.07) * H, -rx * 0.2, -(A.headCy - 0.075) * H);
      ctx.strokeStyle = "#2a2f3a";
      ctx.lineWidth = Math.max(1, 0.008 * H);
      ctx.stroke();
      break;
    }
    default:
      break;
  }
}

// ---------------------------------------------------------------------------
// BACK (facing "up") — no face; hair/cap fill the crown.
// ---------------------------------------------------------------------------

function drawBack(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  pose: Pose,
): void {
  const w = BUILD_W[cfg.build];
  const grads = gradientsFor(ctx, cfg, H);
  const meta = OUTFIT_META[cfg.outfit];

  const hipY = -A.hipY * H;
  const shoulderY = -A.shoulderY * H;
  const hipHalf = A.hipHalf * w * H;
  const shoulderHalf = A.shoulderHalf * w * H;
  const legLen = A.legLen * H;
  const legW = A.legW * w * H;
  const armLen = A.armLen * H;
  const armW = A.armW * w * H;

  const legX = hipHalf * 0.55;
  const trouser = darken(cfg.outfitColor, 0.35);
  for (const s of [-1, 1] as const) {
    const ang = -s * pose.legSwing;
    drawFoot(ctx, s * legX + Math.sin(ang) * legLen, hipY + Math.cos(ang) * legLen, ang, legW, s);
    drawLimb(ctx, s * legX, hipY, ang, legLen, legW, trouser, null, 0);
  }

  traceTorso(ctx, shoulderY, hipY, shoulderHalf, hipHalf, H);
  ctx.fillStyle = grads.outfit;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, 0.01 * H);
  ctx.stroke();
  // Center seam + hood pucker for depth.
  ctx.beginPath();
  ctx.moveTo(0, shoulderY + 0.02 * H);
  ctx.lineTo(0, hipY);
  ctx.strokeStyle = "rgba(0,0,0,0.14)";
  ctx.lineWidth = Math.max(1, 0.006 * H);
  ctx.stroke();
  if (meta.neck === "hood") {
    ctx.beginPath();
    ctx.ellipse(0, shoulderY + 0.01 * H, A.headRx * 1.2 * H, 0.05 * H, 0, 0, Math.PI);
    ctx.fillStyle = darken(cfg.outfitColor, 0.2);
    ctx.fill();
  }

  const shoulderX = shoulderHalf * 0.88;
  const sleeveColor = meta.sleeve === "short" ? cfg.skin : cfg.outfitColor;
  for (const s of [-1, 1] as const) {
    const ang = -s * pose.armSwing;
    drawLimb(ctx, s * shoulderX, shoulderY + 0.01 * H, ang, armLen, armW, sleeveColor, cfg.skin, armW * 0.55);
  }

  // Back of the head + hair.
  const cy = -A.headCy * H;
  ellipse(ctx, 0, cy, A.headRx * H, A.headRy * H);
  ctx.fillStyle = grads.skin;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, 0.008 * H);
  ctx.stroke();

  drawHairBack(ctx, cfg, H, grads);
  if (cfg.hair !== "bald") {
    // Full crown cover from behind.
    ctx.beginPath();
    ctx.ellipse(0, cy, A.headRx * 1.02 * H, A.headRy * 1.0 * H, 0, 0, Math.PI * 2);
    ctx.fillStyle = grads.hair;
    if (cfg.hair === "mohawk") {
      ctx.save();
      capsule(ctx, -A.headRx * 0.28 * H, -A.crownY * H, A.headRx * 0.56 * H, (A.crownY - A.headCy + A.headRy) * H);
      ctx.fillStyle = grads.hair;
      ctx.fill();
      ctx.restore();
    } else {
      ctx.fill();
    }
  }
  drawAccessory(ctx, cfg, H, "back");
}

// ---------------------------------------------------------------------------
// SIDE (facing "left"; "right" is this mirrored). Profile figure.
// ---------------------------------------------------------------------------

function drawSide(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  pose: Pose,
  status?: PresenceStatus,
): void {
  const w = BUILD_W[cfg.build];
  const grads = gradientsFor(ctx, cfg, H);
  const meta = OUTFIT_META[cfg.outfit];

  const hipY = -A.hipY * H;
  const shoulderY = -A.shoulderY * H;
  const bodyHalf = A.waistHalf * w * H * 0.8; // narrower in profile
  const legLen = A.legLen * H;
  const legW = A.legW * w * H;
  const armLen = A.armLen * H;
  const armW = A.armW * w * H;

  // Back leg first, then front leg (opposite swing when walking).
  const trouser = darken(cfg.outfitColor, 0.35);
  const backAng = -pose.legSwing;
  drawFoot(ctx, Math.sin(backAng) * legLen, hipY + Math.cos(backAng) * legLen, backAng, legW, 1);
  drawLimb(ctx, 0, hipY, backAng, legLen, legW, darken(trouser, 0.12), null, 0);

  // Back arm.
  const backArm = -pose.armSwing;
  const sleeveColor = meta.sleeve === "short" ? cfg.skin : cfg.outfitColor;
  drawLimb(ctx, 0, shoulderY + 0.01 * H, backArm, armLen, armW, darken(sleeveColor, 0.12), cfg.skin, armW * 0.5);

  // Torso (profile capsule).
  const traceSideTorso = () => {
    ctx.beginPath();
    ctx.moveTo(-bodyHalf * 1.1, shoulderY);
    ctx.quadraticCurveTo(bodyHalf * 1.3, shoulderY - 0.01 * H, bodyHalf * 1.1, shoulderY + 0.02 * H);
    ctx.quadraticCurveTo(bodyHalf * 1.2, (shoulderY + hipY) / 2, bodyHalf, hipY);
    ctx.lineTo(-bodyHalf, hipY);
    ctx.quadraticCurveTo(-bodyHalf * 1.3, (shoulderY + hipY) / 2, -bodyHalf * 1.1, shoulderY);
    ctx.closePath();
  };
  ctx.save();
  ctx.translate(0, hipY);
  ctx.scale(1, pose.breathe);
  ctx.translate(0, -hipY);
  traceSideTorso();
  ctx.fillStyle = grads.outfit;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, 0.01 * H);
  ctx.stroke();
  ctx.restore();

  // Front leg.
  const frontAng = pose.legSwing;
  drawFoot(ctx, Math.sin(frontAng) * legLen, hipY + Math.cos(frontAng) * legLen, frontAng, legW, 1);
  drawLimb(ctx, 0, hipY, frontAng, legLen, legW, trouser, null, 0);

  // Head group.
  const lift = (pose.breathe - 1) * (A.shoulderY - A.hipY) * H;
  ctx.save();
  ctx.translate(0, -lift);
  drawNeck(ctx, cfg, H, w, grads);

  const cy = -A.headCy * H;
  // Profile head: rounder back, a small nose bump at the front (+x).
  ctx.beginPath();
  ctx.moveTo(0, cy - A.headRy * H);
  ctx.bezierCurveTo(
    A.headRx * 1.3 * H,
    cy - A.headRy * H,
    A.headRx * 1.15 * H,
    cy + A.headRy * 0.9 * H,
    0,
    cy + A.headRy * H,
  );
  ctx.bezierCurveTo(
    -A.headRx * 1.25 * H,
    cy + A.headRy * H,
    -A.headRx * 1.25 * H,
    cy - A.headRy * H,
    0,
    cy - A.headRy * H,
  );
  ctx.closePath();
  ctx.fillStyle = grads.skin;
  ctx.fill();
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, 0.008 * H);
  ctx.stroke();

  // One ear toward the back.
  ellipse(ctx, -A.headRx * 0.5 * H, cy + 0.005 * H, 0.016 * H, 0.024 * H);
  ctx.fillStyle = darken(cfg.skin, 0.05);
  ctx.fill();
  if (cfg.accessory === "earrings") {
    ellipse(ctx, -A.headRx * 0.5 * H, cy + 0.032 * H, 0.008 * H, 0.008 * H);
    ctx.fillStyle = "#e7c65b";
    ctx.fill();
  }

  drawHairSide(ctx, cfg, H, grads);
  drawFace(ctx, cfg, H, pose, "side", status);
  drawAccessory(ctx, cfg, H, "side");
  drawTurtleneckCollar(ctx, cfg, H, w);

  // Front arm (over torso).
  ctx.restore();
  const frontArm = pose.armSwing;
  drawLimb(ctx, 0, shoulderY + 0.01 * H, frontArm, armLen, armW, sleeveColor, cfg.skin, armW * 0.55);
}

function drawHairSide(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  grads: GradBundle,
): void {
  if (cfg.hair === "bald") return;
  const cy = -A.headCy * H;
  const rx = A.headRx * H;
  const ry = A.headRy * H;
  ctx.fillStyle = grads.hair;
  ctx.strokeStyle = OUTLINE;
  ctx.lineWidth = Math.max(1, 0.006 * H);

  if (cfg.hair === "mohawk") {
    ctx.beginPath();
    ctx.moveTo(-rx * 0.3, cy);
    ctx.quadraticCurveTo(-rx * 0.2, cy - ry * 1.7, rx * 0.2, cy - ry * 1.55);
    ctx.quadraticCurveTo(rx * 0.1, cy - ry * 0.3, -rx * 0.3, cy);
    ctx.closePath();
    ctx.fill();
    return;
  }

  // Cap hugging back + crown, front hairline near the brow.
  ctx.beginPath();
  ctx.moveTo(rx * 0.6, cy - ry * 0.4);
  ctx.bezierCurveTo(rx * 1.1, cy - ry * 1.1, -rx * 1.3, cy - ry * 1.1, -rx * 1.15, cy + ry * 0.2);
  ctx.quadraticCurveTo(-rx * 1.0, cy - ry * 0.3, -rx * 0.4, cy - ry * 0.55);
  ctx.quadraticCurveTo(rx * 0.2, cy - ry * 0.75, rx * 0.6, cy - ry * 0.4);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  if (cfg.hair === "long") {
    ctx.beginPath();
    ctx.moveTo(-rx * 1.1, cy - ry * 0.2);
    ctx.quadraticCurveTo(-rx * 1.4, cy + ry * 2.2, -rx * 0.8, -A.shoulderY * H);
    ctx.quadraticCurveTo(-rx * 0.5, cy + ry * 1.2, -rx * 0.5, cy);
    ctx.closePath();
    ctx.fill();
  } else if (cfg.hair === "ponytail") {
    ctx.beginPath();
    ctx.moveTo(-rx * 0.9, cy - ry * 0.3);
    ctx.quadraticCurveTo(-rx * 1.8, cy + ry * 0.8, -rx * 1.3, cy + ry * 2.4);
    ctx.quadraticCurveTo(-rx * 0.7, cy + ry * 1.0, -rx * 0.5, cy);
    ctx.closePath();
    ctx.fill();
  } else if (cfg.hair === "bun") {
    ellipse(ctx, -rx * 0.9, cy - ry * 0.6, rx * 0.4, rx * 0.4);
    ctx.fill();
    ctx.stroke();
  }
}
