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
  /**
   * Body pose. "stand" (default) is the full standing figure; "sit" lowers the
   * hips to the anchor and folds the legs forward — a believable seated
   * silhouette. The bottom-center anchor is unchanged: standing anchors the
   * FEET, seated anchors the SEAT (hips) at (x, y). No walk cycle while seated.
   */
  pose?: "stand" | "sit";
  /**
   * A live webcam/video (or image) source to show as a circular head bubble in
   * place of the drawn face/head. When null/undefined (or not yet playable) the
   * normal head is drawn. drawImage is guarded, so a bad/blank source falls
   * back to the drawn head rather than throwing.
   */
  video?: CanvasImageSource | null;
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
  // shaded lower-right — the core of the semi-3D read on the face. A warm
  // mid-stop fakes subsurface scattering so the tone reads like lit flesh rather
  // than flat plastic.
  const skin = ctx.createRadialGradient(
    -A.headRx * 0.5 * H,
    -(A.headCy + A.headRy * 0.35) * H,
    A.headRx * 0.15 * H,
    -A.headRx * 0.1 * H,
    -A.headCy * H,
    A.headRy * 1.5 * H,
  );
  skin.addColorStop(0, lighten(cfg.skin, 0.3));
  skin.addColorStop(0.42, lighten(cfg.skin, 0.06));
  skin.addColorStop(0.72, mix(cfg.skin, [214, 150, 120], 0.14)); // subsurface warmth
  skin.addColorStop(1, darken(cfg.skin, 0.2));

  // Hair: a top-down sheen — bright crown, base body, darker underside.
  const hair = ctx.createLinearGradient(
    -A.headRx * 0.4 * H,
    -A.crownY * H,
    A.headRx * 0.4 * H,
    -A.chinY * H,
  );
  hair.addColorStop(0, lighten(cfg.hairColor, 0.34));
  hair.addColorStop(0.32, lighten(cfg.hairColor, 0.1));
  hair.addColorStop(0.62, cfg.hairColor);
  hair.addColorStop(1, darken(cfg.hairColor, 0.26));

  // Outfit: a diagonal light-to-shadow across the torso, with a soft central
  // body tone so tailored cloth reads with a gentle sheen and turned edges.
  const outfit = ctx.createLinearGradient(
    -A.shoulderHalf * w * H,
    -A.shoulderY * H,
    A.waistHalf * w * H,
    -A.hipY * H,
  );
  outfit.addColorStop(0, lighten(cfg.outfitColor, 0.2));
  outfit.addColorStop(0.34, lighten(cfg.outfitColor, 0.05));
  outfit.addColorStop(0.62, cfg.outfitColor);
  outfit.addColorStop(1, darken(cfg.outfitColor, 0.24));

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

// A crisp but soft ink outline — deep enough to read as a clean edge, low enough
// in alpha to stay painterly rather than cartoonish.
const OUTLINE = "rgba(14, 18, 30, 0.58)";

// ---------------------------------------------------------------------------
// Pose — everything the animation clock produces, resolved once per call.
// ---------------------------------------------------------------------------

interface Pose {
  armSwing: number;
  legSwing: number;
  bob: number;
  breathe: number;
  blink: number; // 1 = open, 0 = closed
  gaze: number; // -1..1 slow horizontal eye drift
  talk: number; // 0..1 mouth-open phase (used when in a meeting)
}

function computePose(timeMs: number, moving: boolean): Pose {
  const t = timeMs / 1000;
  // A slow, wandering gaze and a fast talking oscillation are pose-independent —
  // the face drawer decides whether to use them (e.g. talk only in a meeting).
  const gaze = Math.sin(t * 0.7) * Math.cos(t * 0.23);
  const talk = Math.sin(t * 7.5) * 0.5 + 0.5;
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
      gaze,
      talk,
    };
  }
  return {
    armSwing: Math.sin(t * 1.6) * 0.04,
    legSwing: 0,
    bob: 0,
    breathe: 1 + (Math.sin(t * 1.9) + 1) * 0.5 * 0.02,
    blink: blinkAt(t),
    gaze,
    talk,
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
  const seated = opts.pose === "sit";
  // No walk cycle while seated — the legs are folded, so a stride reads wrong.
  const pose = computePose(opts.timeMs, seated ? false : opts.moving);
  const video = isLiveVideo(opts.video) ? opts.video ?? null : null;
  // Warm the per-context gradient cache for this (config, height) up front.
  gradientsFor(ctx, cfg, H);

  ctx.save();
  ctx.translate(opts.x, opts.y);

  // Soft contact shadow. Standing: a broad pool under the feet. Seated: a
  // smaller, dimmer pool a little below the seat (the chair carries the rest).
  const shW = A.shoulderHalf * BUILD_W[cfg.build] * H * (seated ? 1.05 : 1.5);
  const shY = seated ? A.hipY * H * 0.5 : 0;
  const shadow = ctx.createRadialGradient(0, shY, 0, 0, shY, shW);
  shadow.addColorStop(0, seated ? "rgba(0,0,0,0.22)" : "rgba(0,0,0,0.32)");
  shadow.addColorStop(1, "rgba(0,0,0,0)");
  ctx.fillStyle = shadow;
  ellipse(ctx, 0, shY, shW, shW * 0.28);
  ctx.fill();

  if (opts.status === "away") ctx.globalAlpha = 0.82;

  // Vertical bob (walk) lifts the whole figure a touch.
  ctx.translate(0, -pose.bob * H);
  // Seated: drop the whole feet-origin frame so the HIP line lands on the
  // anchor. Everything drawn in feet coordinates (torso, head, arms) then sits
  // above the seat, and the folded legs fall below it.
  if (seated) ctx.translate(0, A.hipY * H);

  const side = opts.facing === "left" || opts.facing === "right";
  if (opts.facing === "right") ctx.scale(-1, 1); // mirror the LEFT-facing art

  if (opts.facing === "up") {
    drawBack(ctx, cfg, H, pose, seated, video);
  } else if (side) {
    drawSide(ctx, cfg, H, pose, opts.status, seated, video);
  } else {
    drawFront(ctx, cfg, H, pose, opts.status, seated, video);
  }

  ctx.restore();
}

// ---------------------------------------------------------------------------
// Video head-bubble — a circular, cover-fit crop of a live <video>/image at the
// head position, ringed in the avatar accent with a soft drop shadow. Returns
// false (drawing nothing) if the source can't be painted, so callers fall back
// to the drawn head.
// ---------------------------------------------------------------------------

/** True unless the source is absent or a <video> that isn't playable yet. */
function isLiveVideo(v: CanvasImageSource | null | undefined): v is CanvasImageSource {
  if (!v) return false;
  const rs = (v as { readyState?: unknown }).readyState;
  // HTMLVideoElement.HAVE_CURRENT_DATA === 2; images/mocks have no readyState.
  if (typeof rs === "number") return rs >= 2;
  return true;
}

/**
 * Draw `video` as a circular head bubble at (cx, cy) with radius `r`, cover-fit
 * (fills the circle, center-cropped), a `ring`-colored rim and a soft shadow.
 * Every draw touching the source is guarded; on any failure nothing is committed
 * and it returns false so the caller can draw the normal head instead.
 */
export function drawVideoBubble(
  ctx: CanvasRenderingContext2D,
  video: CanvasImageSource,
  cx: number,
  cy: number,
  r: number,
  ring: string,
): boolean {
  const v = video as {
    videoWidth?: number;
    videoHeight?: number;
    naturalWidth?: number;
    naturalHeight?: number;
    width?: number;
    height?: number;
  };
  const sw = v.videoWidth || v.naturalWidth || v.width || 0;
  const sh = v.videoHeight || v.naturalHeight || v.height || 0;

  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.clip();
  try {
    if (sw > 0 && sh > 0) {
      // Cover-fit: scale so the shorter side fills the diameter, center-crop.
      const scale = Math.max((r * 2) / sw, (r * 2) / sh);
      const dw = sw * scale;
      const dh = sh * scale;
      ctx.drawImage(video, cx - dw / 2, cy - dh / 2, dw, dh);
    } else {
      // Unknown intrinsic size — stretch to the bounding box.
      ctx.drawImage(video, cx - r, cy - r, r * 2, r * 2);
    }
  } catch {
    ctx.restore();
    return false;
  }
  ctx.restore();

  // Accent ring with a soft drop shadow so the bubble reads as floating.
  ctx.save();
  ctx.beginPath();
  ctx.arc(cx, cy, r, 0, Math.PI * 2);
  ctx.shadowColor = "rgba(0,0,0,0.28)";
  ctx.shadowBlur = r * 0.28;
  ctx.shadowOffsetY = r * 0.12;
  ctx.lineWidth = Math.max(1.5, r * 0.09);
  ctx.strokeStyle = ring;
  ctx.stroke();
  // Inner highlight lip for a glassy edge.
  ctx.shadowColor = "transparent";
  ctx.beginPath();
  ctx.arc(cx, cy, r - ctx.lineWidth * 0.5, 0, Math.PI * 2);
  ctx.lineWidth = Math.max(1, r * 0.03);
  ctx.strokeStyle = rgba("#ffffff", 0.28);
  ctx.stroke();
  ctx.restore();
  return true;
}

/**
 * Draw the head bubble at the avatar's head position (feet-origin frame),
 * returning whether it succeeded. Shared by every facing.
 */
function drawHeadBubble(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  video: CanvasImageSource,
): boolean {
  const cx = 0;
  const cy = -A.headCy * H;
  const r = A.headRy * H * 1.12;
  return drawVideoBubble(ctx, video, cx, cy, r, cfg.outfitColor);
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
  seated = false,
  video: CanvasImageSource | null = null,
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
  if (seated) {
    drawSeatedLegsFront(ctx, cfg, H, w);
  } else {
    for (const s of [-1, 1] as const) {
      const ang = s * pose.legSwing;
      drawFoot(ctx, s * legX + Math.sin(ang) * legLen, hipY + Math.cos(ang) * legLen, ang, legW, s);
      drawLimb(ctx, s * legX, hipY, ang, legLen, legW, trouser, null, 0);
    }
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
  // Soft tailoring folds — a shaded drape sweeping from each armhole toward the
  // waist and a faint highlighted fold catching the light, so the cloth reads
  // as fabric with give rather than a flat panel.
  const midY = (shoulderY + hipY) / 2;
  ctx.lineCap = "round";
  ctx.beginPath();
  ctx.moveTo(shoulderHalf * 0.72, shoulderY + 0.03 * H);
  ctx.quadraticCurveTo(hipHalf * 0.7, midY, hipHalf * 0.5, hipY - 0.02 * H);
  ctx.lineWidth = 0.02 * H;
  ctx.strokeStyle = "rgba(0,0,0,0.1)";
  ctx.stroke();
  ctx.beginPath();
  ctx.moveTo(-shoulderHalf * 0.5, shoulderY + 0.05 * H);
  ctx.quadraticCurveTo(-hipHalf * 0.3, midY + 0.02 * H, -hipHalf * 0.2, hipY - 0.02 * H);
  ctx.lineWidth = 0.014 * H;
  ctx.strokeStyle = rgba("#ffffff", 0.08);
  ctx.stroke();
  ctx.restore();

  drawOutfitDetail(ctx, cfg, H, w, shoulderY, hipY, shoulderHalf);
  ctx.restore();

  // ---- Arms (over the torso sides) ----
  // Seated: bring the forearms inward so the hands settle in the lap.
  const shoulderX = shoulderHalf * 0.88;
  for (const s of [-1, 1] as const) {
    const ang = seated ? -s * 0.4 : s * pose.armSwing;
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
  // A live video bubble replaces the whole drawn head; if it can't paint, fall
  // through to the normal head so the figure is never faceless.
  if (video && drawHeadBubble(ctx, cfg, H, video)) {
    drawTurtleneckCollar(ctx, cfg, H, w);
    ctx.restore();
    return;
  }
  drawHairBack(ctx, cfg, H, grads);
  drawHead(ctx, cfg, H, grads);
  drawEars(ctx, cfg, H);
  drawFace(ctx, cfg, H, pose, "front", status);
  drawHairFront(ctx, cfg, H, grads);
  drawAccessory(ctx, cfg, H, "front");
  drawTurtleneckCollar(ctx, cfg, H, w);
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Seated legs — the hips already sit at the anchor (drawAvatar dropped the
// frame), so these are drawn in the same feet-origin coordinates as the
// standing figure; the folded thighs + shins simply fall below the seat.
// ---------------------------------------------------------------------------

function drawSeatedLegsFront(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  w: number,
): void {
  const hipY = -A.hipY * H;
  const hipHalf = A.hipHalf * w * H;
  const legX = hipHalf * 0.6;
  const legW = A.legW * w * H;
  const thighLen = 0.17 * H; // foreshortened toward the viewer
  const shinLen = 0.3 * H;
  const trouser = darken(cfg.outfitColor, 0.35);
  for (const s of [-1, 1] as const) {
    const hipX = s * legX;
    const thighAng = s * 0.4; // splay the knees outward
    // Thigh (slightly thicker, foreshortened).
    drawLimb(ctx, hipX, hipY, thighAng, thighLen, legW * 1.2, trouser, null, 0);
    const kneeX = hipX + Math.sin(thighAng) * thighLen;
    const kneeY = hipY + Math.cos(thighAng) * thighLen;
    // Shin drops nearly straight down; foot at the ankle.
    const shinAng = -s * 0.12;
    drawFoot(
      ctx,
      kneeX + Math.sin(shinAng) * shinLen,
      kneeY + Math.cos(shinAng) * shinLen,
      shinAng,
      legW,
      s,
    );
    drawLimb(ctx, kneeX, kneeY, shinAng, shinLen, legW, darken(trouser, 0.06), null, 0);
  }
}

function drawSeatedLegsSide(
  ctx: CanvasRenderingContext2D,
  cfg: AvatarConfig,
  H: number,
  w: number,
): void {
  const hipY = -A.hipY * H;
  const legW = A.legW * w * H;
  const thighLen = 0.26 * H;
  const shinLen = 0.3 * H;
  const trouser = darken(cfg.outfitColor, 0.35);
  // Two legs: a darker back leg for depth, then the front leg. The profile art
  // faces LEFT, so the thighs reach forward toward -x then the shins drop.
  const legs = [
    { thigh: 1.2, off: 0.02 * H, color: darken(trouser, 0.12) },
    { thigh: 1.28, off: -0.02 * H, color: trouser },
  ];
  for (const leg of legs) {
    const hipX = leg.off;
    drawLimb(ctx, hipX, hipY, leg.thigh, thighLen, legW * 1.15, leg.color, null, 0);
    const kneeX = hipX - Math.sin(leg.thigh) * thighLen;
    const kneeY = hipY + Math.cos(leg.thigh) * thighLen;
    const shinAng = 0.05;
    drawFoot(
      ctx,
      kneeX - Math.sin(shinAng) * shinLen,
      kneeY + Math.cos(shinAng) * shinLen,
      shinAng,
      legW,
      -1,
    );
    drawLimb(ctx, kneeX, kneeY, shinAng, shinLen, legW, leg.color, null, 0);
  }
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
  // Soft forehead/upper-cheek highlight from the key light for a rounded brow.
  ellipse(ctx, -A.headRx * 0.28 * H, -(A.headCy + A.headRy * 0.4) * H, A.headRx * 0.55 * H, A.headRy * 0.34 * H);
  ctx.fillStyle = rgba("#ffffff", 0.08);
  ctx.fill();
  // Gentle temple shadow on the shaded side to turn the form.
  ellipse(ctx, A.headRx * 0.78 * H, -(A.headCy + A.headRy * 0.1) * H, A.headRx * 0.3 * H, A.headRy * 0.5 * H);
  ctx.fillStyle = rgba(darken(cfg.skin, 0.5), 0.1);
  ctx.fill();
  // Soft jaw/chin ambient occlusion — grounds the lower face and reads as a
  // gentle jawline rather than a flat oval.
  ellipse(ctx, 0, -(A.chinY + 0.008) * H, A.headRx * 0.78 * H, A.headRy * 0.42 * H);
  ctx.fillStyle = rgba(darken(cfg.skin, 0.5), 0.16);
  ctx.fill();
  // Warm cheeks for a touch of life.
  for (const s of [-1, 1] as const) {
    ellipse(ctx, s * A.headRx * 0.55 * H, -(A.headCy - 0.052) * H, A.headRx * 0.3 * H, A.headRy * 0.22 * H);
    ctx.fillStyle = rgba("#e8896b", 0.12);
    ctx.fill();
  }
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
  // "away" reads as resting with the eyes shut; otherwise follow the blink clock.
  const openness = status === "away" ? 0 : pose.blink;
  const eyeRy = 0.019 * H * openness;
  // A subtle, slow gaze shift so the eyes feel alive (clamped to the sclera).
  const gaze = pose.gaze * eyeRx * 0.4;
  const positions = view === "side" ? [eyeDX * 0.7] : [-eyeDX, eyeDX];

  drawFacialHairUnder(ctx, cfg, H);

  for (const ex of positions) {
    // Brow. Focusing furrows it a touch lower and flatter.
    const browLift = status === "focusing" ? 0.024 : 0.03;
    ctx.beginPath();
    ctx.moveTo(ex - eyeRx, eyeY - browLift * H);
    ctx.quadraticCurveTo(ex, eyeY - (browLift + 0.008) * H, ex + eyeRx, eyeY - browLift * H);
    ctx.lineWidth = Math.max(1, 0.008 * H);
    ctx.strokeStyle = darken(cfg.hairColor, 0.1);
    ctx.lineCap = "round";
    ctx.stroke();

    if (openness < 0.15) {
      // Closed lid — a soft downward-curved lash line.
      ctx.beginPath();
      ctx.moveTo(ex - eyeRx, eyeY);
      ctx.quadraticCurveTo(ex, eyeY + 0.004 * H, ex + eyeRx, eyeY);
      ctx.lineWidth = Math.max(1, 0.006 * H);
      ctx.strokeStyle = darken(cfg.skin, 0.4);
      ctx.lineCap = "round";
      ctx.stroke();
      continue;
    }
    // Sclera.
    ellipse(ctx, ex, eyeY, eyeRx, Math.max(0.001, eyeRy));
    ctx.fillStyle = "#f6f7f9";
    ctx.fill();
    // Iris (shifted by the gaze).
    ellipse(ctx, ex + gaze, eyeY, eyeRx * 0.6, Math.max(0.001, eyeRy * 0.85));
    ctx.fillStyle = cfg.eyes;
    ctx.fill();
    // Pupil + catch light.
    ellipse(ctx, ex + gaze, eyeY, eyeRx * 0.28, Math.max(0.001, eyeRy * 0.5));
    ctx.fillStyle = "#12161f";
    ctx.fill();
    ellipse(ctx, ex + gaze - eyeRx * 0.25, eyeY - eyeRy * 0.3, eyeRx * 0.14, eyeRx * 0.14);
    ctx.fillStyle = rgba("#ffffff", 0.9);
    ctx.fill();
    // Upper lash line for a softer, more human eye.
    ctx.beginPath();
    ctx.moveTo(ex - eyeRx, eyeY - eyeRy * 0.6);
    ctx.quadraticCurveTo(ex, eyeY - eyeRy, ex + eyeRx, eyeY - eyeRy * 0.6);
    ctx.lineWidth = Math.max(1, 0.004 * H);
    ctx.strokeStyle = rgba(darken(cfg.skin, 0.5), 0.55);
    ctx.lineCap = "round";
    ctx.stroke();
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

  // Mouth — expression driven by status. In a meeting the mouth animates open
  // and closed (talking); otherwise it's a curved line whose bow reflects mood:
  // available = faint smile, focusing = neutral/slightly down, away = soft rest.
  const mouthY = -(A.headCy - 0.078) * H;
  const mouthW = (view === "side" ? 0.028 : 0.04) * H;
  const mx = view === "side" ? 0.012 * H : 0;
  if (status === "in_meeting") {
    // Open, talking mouth — an oral cavity with a lip line, height on the clock.
    const open = (0.006 + pose.talk * 0.014) * H;
    ellipse(ctx, mx, mouthY + open * 0.35, mouthW * 0.42, open);
    ctx.fillStyle = darken(cfg.skin, 0.55);
    ctx.fill();
    // Lower lip catch.
    ctx.beginPath();
    ctx.moveTo(mx - mouthW * 0.42, mouthY + open * 0.35);
    ctx.quadraticCurveTo(mx, mouthY + open * 1.5, mx + mouthW * 0.42, mouthY + open * 0.35);
    ctx.lineWidth = Math.max(1, 0.006 * H);
    ctx.strokeStyle = darken(cfg.skin, 0.28);
    ctx.lineCap = "round";
    ctx.stroke();
  } else {
    const smile = status === "away" ? -0.002 : status === "focusing" ? 0.001 : 0.011;
    ctx.beginPath();
    ctx.moveTo(mx - mouthW / 2, mouthY);
    ctx.quadraticCurveTo(mx, mouthY + smile * H, mx + mouthW / 2, mouthY);
    ctx.lineWidth = Math.max(1, 0.008 * H);
    ctx.strokeStyle = darken(cfg.skin, 0.35);
    ctx.lineCap = "round";
    ctx.stroke();
    // A faint upper-lip highlight adds dimension without a hard second line.
    if (smile > 0.006) {
      ctx.beginPath();
      ctx.moveTo(mx - mouthW * 0.4, mouthY - 0.003 * H);
      ctx.quadraticCurveTo(mx, mouthY - 0.006 * H, mx + mouthW * 0.4, mouthY - 0.003 * H);
      ctx.lineWidth = Math.max(1, 0.004 * H);
      ctx.strokeStyle = rgba(lighten(cfg.skin, 0.25), 0.5);
      ctx.lineCap = "round";
      ctx.stroke();
    }
  }

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

  // Layered strands + sheen — a few flowing strokes give the hair internal
  // structure and a glossy top-light instead of a single solid blob. Skipped for
  // the shaved styles where a strand read would look wrong.
  ctx.save();
  ctx.lineCap = "round";
  if (cfg.hair !== "buzz" && cfg.hair !== "mohawk") {
    // Darker parting strands for depth.
    ctx.strokeStyle = rgba(darken(cfg.hairColor, 0.22), 0.4);
    ctx.lineWidth = Math.max(1, 0.006 * H);
    for (const sx of [-0.62, -0.24, 0.16, 0.5]) {
      ctx.beginPath();
      ctx.moveTo(rx * sx, cy - ry * 0.72);
      ctx.quadraticCurveTo(rx * (sx + 0.12), cy - ry * 0.2, rx * (sx + 0.18), cy + ry * 0.1);
      ctx.stroke();
    }
  }
  // Primary sheen streak.
  ctx.beginPath();
  ctx.moveTo(-rx * 0.5, cy - ry * 0.6);
  ctx.quadraticCurveTo(0, cy - ry * 0.85, rx * 0.2, cy - ry * 0.55);
  ctx.lineWidth = Math.max(1, 0.01 * H);
  ctx.strokeStyle = rgba("#ffffff", 0.2);
  ctx.stroke();
  // Finer secondary sheen just below it.
  ctx.beginPath();
  ctx.moveTo(-rx * 0.32, cy - ry * 0.45);
  ctx.quadraticCurveTo(rx * 0.05, cy - ry * 0.62, rx * 0.34, cy - ry * 0.4);
  ctx.lineWidth = Math.max(1, 0.004 * H);
  ctx.strokeStyle = rgba("#ffffff", 0.12);
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
      // A tailored suit jacket over a dress shirt: shirt V, a knotted tie,
      // peaked lapels with a lit top plane, jacket buttons and a breast-pocket
      // square. All coordinates sit in the torso's feet-origin frame.
      const shirt = "#eef1f6";
      const collarY = shoulderY + 0.008 * H;
      const vDepth = shoulderY + 0.12 * H;
      const tieBottom = shoulderY * 0.32 + hipY * 0.68;

      // Shirt triangle behind everything.
      ctx.beginPath();
      ctx.moveTo(-neckHalf * 1.15, collarY);
      ctx.lineTo(0, vDepth);
      ctx.lineTo(neckHalf * 1.15, collarY);
      ctx.closePath();
      ctx.fillStyle = shirt;
      ctx.fill();
      // Shirt-collar band shading at the throat.
      ctx.beginPath();
      ctx.moveTo(-neckHalf * 1.15, collarY);
      ctx.lineTo(0, collarY + 0.03 * H);
      ctx.lineTo(neckHalf * 1.15, collarY);
      ctx.lineWidth = Math.max(1, 0.006 * H);
      ctx.strokeStyle = darken(shirt, 0.14);
      ctx.stroke();

      // Tie — a knot then a tapering blade to mid-torso.
      const tieColor = darken(cfg.outfitColor, 0.36);
      ctx.beginPath();
      ctx.moveTo(-0.014 * H, collarY + 0.016 * H);
      ctx.lineTo(0.014 * H, collarY + 0.016 * H);
      ctx.lineTo(0.01 * H, collarY + 0.04 * H);
      ctx.lineTo(-0.01 * H, collarY + 0.04 * H);
      ctx.closePath();
      ctx.fillStyle = lighten(tieColor, 0.08);
      ctx.fill();
      ctx.beginPath();
      ctx.moveTo(-0.01 * H, collarY + 0.04 * H);
      ctx.lineTo(0.01 * H, collarY + 0.04 * H);
      ctx.lineTo(0.022 * H, tieBottom);
      ctx.lineTo(0, tieBottom + 0.02 * H);
      ctx.lineTo(-0.022 * H, tieBottom);
      ctx.closePath();
      ctx.fillStyle = tieColor;
      ctx.fill();
      // Tie sheen.
      ctx.beginPath();
      ctx.moveTo(-0.004 * H, collarY + 0.05 * H);
      ctx.lineTo(-0.006 * H, tieBottom - 0.01 * H);
      ctx.lineWidth = Math.max(1, 0.004 * H);
      ctx.strokeStyle = rgba("#ffffff", 0.12);
      ctx.stroke();

      // Peaked lapels — a filled panel each side with a lit outer edge.
      for (const s of [-1, 1] as const) {
        ctx.beginPath();
        ctx.moveTo(s * neckHalf * 1.15, collarY);
        ctx.lineTo(s * shoulderHalf * 0.82, collarY + 0.016 * H);
        ctx.lineTo(s * shoulderHalf * 0.5, shoulderY + 0.075 * H);
        ctx.lineTo(s * 0.022 * H, vDepth + 0.008 * H);
        ctx.closePath();
        ctx.fillStyle = darken(cfg.outfitColor, 0.14);
        ctx.fill();
        // Lit lapel roll.
        ctx.beginPath();
        ctx.moveTo(s * neckHalf * 1.1, collarY + 0.004 * H);
        ctx.lineTo(s * 0.02 * H, vDepth);
        ctx.lineWidth = Math.max(1, 0.005 * H);
        ctx.strokeStyle = rgba("#ffffff", 0.12);
        ctx.stroke();
        // Lapel notch nick.
        ctx.beginPath();
        ctx.moveTo(s * shoulderHalf * 0.82, collarY + 0.016 * H);
        ctx.lineTo(s * shoulderHalf * 0.6, shoulderY + 0.05 * H);
        ctx.lineWidth = Math.max(1, 0.004 * H);
        ctx.strokeStyle = darken(cfg.outfitColor, 0.3);
        ctx.stroke();
      }

      // Jacket front seam + two buttons below the tie knot.
      ctx.beginPath();
      ctx.moveTo(0, vDepth + 0.01 * H);
      ctx.lineTo(0, hipY - 0.01 * H);
      ctx.lineWidth = Math.max(1, 0.005 * H);
      ctx.strokeStyle = darken(cfg.outfitColor, 0.26);
      ctx.stroke();
      for (const by of [0.55, 0.78]) {
        ellipse(ctx, 0.004 * H, shoulderY + (hipY - shoulderY) * by, 0.007 * H, 0.007 * H);
        ctx.fillStyle = darken(cfg.outfitColor, 0.4);
        ctx.fill();
      }
      // Breast-pocket square — a small folded accent on the wearer's left chest.
      ctx.beginPath();
      ctx.moveTo(-shoulderHalf * 0.62, shoulderY + 0.06 * H);
      ctx.lineTo(-shoulderHalf * 0.38, shoulderY + 0.06 * H);
      ctx.lineTo(-shoulderHalf * 0.5, shoulderY + 0.045 * H);
      ctx.closePath();
      ctx.fillStyle = lighten(cfg.outfitColor, 0.42);
      ctx.fill();
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
      // Placket buttons down the front for a crisp, pressed read.
      for (const by of [0.12, 0.34, 0.56, 0.78]) {
        ellipse(
          ctx,
          0,
          shoulderY + 0.05 * H + (hipY - (shoulderY + 0.05 * H)) * by,
          0.006 * H,
          0.006 * H,
        );
        ctx.fillStyle = darken(cfg.outfitColor, 0.28);
        ctx.fill();
      }
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
  seated = false,
  video: CanvasImageSource | null = null,
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
  if (seated) {
    // Seated-from-behind approximation: reuse the folded front legs.
    drawSeatedLegsFront(ctx, cfg, H, w);
  } else {
    for (const s of [-1, 1] as const) {
      const ang = -s * pose.legSwing;
      drawFoot(ctx, s * legX + Math.sin(ang) * legLen, hipY + Math.cos(ang) * legLen, ang, legW, s);
      drawLimb(ctx, s * legX, hipY, ang, legLen, legW, trouser, null, 0);
    }
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
    const ang = seated ? -s * 0.4 : -s * pose.armSwing;
    drawLimb(ctx, s * shoulderX, shoulderY + 0.01 * H, ang, armLen, armW, sleeveColor, cfg.skin, armW * 0.55);
  }

  // A live video bubble takes the head position even from behind.
  if (video && drawHeadBubble(ctx, cfg, H, video)) return;

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
  seated = false,
  video: CanvasImageSource | null = null,
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

  // Back leg first, then front leg (opposite swing when walking). Seated draws
  // both folded legs up front (behind the torso).
  const trouser = darken(cfg.outfitColor, 0.35);
  const sleeveColor = meta.sleeve === "short" ? cfg.skin : cfg.outfitColor;
  if (seated) {
    drawSeatedLegsSide(ctx, cfg, H, w);
  } else {
    const backAng = -pose.legSwing;
    drawFoot(ctx, Math.sin(backAng) * legLen, hipY + Math.cos(backAng) * legLen, backAng, legW, 1);
    drawLimb(ctx, 0, hipY, backAng, legLen, legW, darken(trouser, 0.12), null, 0);
  }

  // Back arm — seated rests it forward over the lap/desk.
  const backArm = seated ? 0.5 : -pose.armSwing;
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

  // Front leg (standing only; seated legs were drawn up front).
  if (!seated) {
    const frontAng = pose.legSwing;
    drawFoot(ctx, Math.sin(frontAng) * legLen, hipY + Math.cos(frontAng) * legLen, frontAng, legW, 1);
    drawLimb(ctx, 0, hipY, frontAng, legLen, legW, trouser, null, 0);
  }

  // Head group.
  const lift = (pose.breathe - 1) * (A.shoulderY - A.hipY) * H;
  ctx.save();
  ctx.translate(0, -lift);
  drawNeck(ctx, cfg, H, w, grads);

  // Live video bubble replaces the profile head; restore + draw the front arm
  // so the composition still closes cleanly.
  if (video && drawHeadBubble(ctx, cfg, H, video)) {
    drawTurtleneckCollar(ctx, cfg, H, w);
    ctx.restore();
    drawLimb(
      ctx,
      0,
      shoulderY + 0.01 * H,
      seated ? 0.55 : pose.armSwing,
      armLen,
      armW,
      sleeveColor,
      cfg.skin,
      armW * 0.55,
    );
    return;
  }

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

  // Front arm (over torso) — seated rests it forward over the lap/desk.
  ctx.restore();
  const frontArm = seated ? 0.55 : pose.armSwing;
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
