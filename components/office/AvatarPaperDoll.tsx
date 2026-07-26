// components/office/AvatarPaperDoll.tsx
// Deterministic, layered SVG "paper-doll" renderer for a member's AvatarConfig
// (lib/office/avatarConfig.ts). Pure and presentational — no hooks, no state,
// no event handlers — so it renders identically on the server and the client
// and is safe to drop into either. Every appearance choice resolves through the
// config catalogs; the same config always paints the same character.
//
// Layers paint back-to-front per docs/avatars/AVATAR_SYSTEM_SPEC.md §4.1:
//   ground shadow → back hair → legs/skirt → shoes → torso (outfit) → arms
//   → neck → head (skin) → ears → facial hair → face → front hair → accessory.

import {
  hairHex,
  outfitHex,
  skinHex,
  statusHex,
  type AvatarConfig,
} from "@/lib/office/avatarConfig";

const VB_W = 200;
const VB_H = 260;

// Shift a hex color's lightness. amt > 0 lightens, amt < 0 darkens.
function shade(hex: string, amt: number): string {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) return hex;
  const n = parseInt(m[1], 16);
  const clamp = (v: number) => Math.max(0, Math.min(255, Math.round(v)));
  const r = clamp(((n >> 16) & 255) + 255 * amt);
  const g = clamp(((n >> 8) & 255) + 255 * amt);
  const b = clamp((n & 255) + 255 * amt);
  return `#${((r << 16) | (g << 8) | b).toString(16).padStart(6, "0")}`;
}

// Body build → shoulder half-width and torso taper.
const BUILD: Record<string, { shoulder: number; waist: number }> = {
  slim: { shoulder: 34, waist: 26 },
  regular: { shoulder: 40, waist: 30 },
  broad: { shoulder: 48, waist: 36 },
};

const CX = 100;

export interface AvatarPaperDollProps {
  config: AvatarConfig;
  /** Rendered width in px; height follows the 200×260 aspect. */
  size?: number;
  className?: string;
  /** Draw the soft ground shadow under the feet. */
  showShadow?: boolean;
  /** Ring the character with its presence-status color. */
  showStatusRing?: boolean;
  title?: string;
}

export function AvatarPaperDoll({
  config,
  size = 220,
  className,
  showShadow = true,
  showStatusRing = false,
  title,
}: AvatarPaperDollProps) {
  const skin = skinHex(config);
  const skinShadow = shade(skin, -0.09);
  const hair = hairHex(config);
  const outfit = outfitHex(config);
  const outfitDark = shade(outfit, -0.12);
  const outfitLight = shade(outfit, 0.08);
  const status = statusHex(config);

  const build = BUILD[config.body] ?? BUILD.regular;
  const { shoulder, waist } = build;

  const isDress = config.outfit === "dress";
  const shirtTops = new Set(["shirt", "turtleneck"]);
  const hasCollar = config.outfit === "suit" || config.outfit === "blazer";
  const hasTie = config.outfit === "suit";
  const isZip = config.outfit === "hoodie";

  // Head geometry (shared by many layers).
  const headCy = 74;
  const headRx = 30;
  const headRy = 33;
  const jawY = headCy + headRy - 4;

  return (
    <svg
      viewBox={`0 0 ${VB_W} ${VB_H}`}
      width={size}
      height={(size * VB_H) / VB_W}
      className={className}
      role="img"
      aria-label={title ?? `Avatar${config.displayName ? ` for ${config.displayName}` : ""}`}
      shapeRendering="geometricPrecision"
    >
      {title ? <title>{title}</title> : null}

      {showStatusRing ? (
        <circle cx={CX} cy={132} r={122} fill="none" stroke={status} strokeOpacity={0.5} strokeWidth={3} />
      ) : null}

      {showShadow ? (
        <ellipse cx={CX} cy={250} rx={54} ry={9} fill="rgba(0,0,0,0.28)" />
      ) : null}

      {/* ── Back hair (falls behind the head/shoulders) ── */}
      <BackHair style={config.hair} hair={hair} headCy={headCy} headRx={headRx} headRy={headRy} />

      {/* ── Lower body ── */}
      <LowerBody
        isDress={isDress}
        waist={waist}
        outfit={outfit}
        outfitDark={outfitDark}
        skin={skin}
        skinShadow={skinShadow}
      />

      {/* ── Torso / outfit ── */}
      <g>
        {/* Shoulders → waist silhouette */}
        <path
          d={`M ${CX - shoulder} 150
              Q ${CX - shoulder - 4} 128 ${CX - 22} 122
              L ${CX + 22} 122
              Q ${CX + shoulder + 4} 128 ${CX + shoulder} 150
              L ${CX + waist} 208
              Q ${CX} 218 ${CX - waist} 208 Z`}
          fill={outfit}
        />
        {/* Center seam / shading down the middle */}
        <path
          d={`M ${CX} 124 L ${CX} 210`}
          stroke={outfitDark}
          strokeWidth={2}
          strokeOpacity={0.55}
          fill="none"
        />
        <NeckAndCollar
          hasCollar={hasCollar}
          hasTie={hasTie}
          isZip={isZip}
          isTurtleneck={config.outfit === "turtleneck"}
          shirtTop={shirtTops.has(config.outfit)}
          skin={skin}
          skinShadow={skinShadow}
          outfit={outfit}
          outfitDark={outfitDark}
          outfitLight={outfitLight}
        />
      </g>

      {/* ── Arms (sleeves + hands) ── */}
      <Arms shoulder={shoulder} outfit={outfit} outfitDark={outfitDark} skin={skin} />

      {/* ── Head ── */}
      {/* Ears */}
      <ellipse cx={CX - headRx + 2} cy={headCy + 4} rx={6} ry={9} fill={skinShadow} />
      <ellipse cx={CX + headRx - 2} cy={headCy + 4} rx={6} ry={9} fill={skinShadow} />
      {/* Face oval */}
      <ellipse cx={CX} cy={headCy} rx={headRx} ry={headRy} fill={skin} />
      {/* Soft jaw shading */}
      <path
        d={`M ${CX - headRx + 4} ${headCy + 10} Q ${CX} ${jawY + 4} ${CX + headRx - 4} ${headCy + 10}`}
        fill="none"
        stroke={skinShadow}
        strokeOpacity={0.5}
        strokeWidth={2}
      />

      <FacialHair style={config.facialHair} hair={hair} headCy={headCy} headRx={headRx} jawY={jawY} skin={skin} />
      <Face expression={config.expression} headCy={headCy} skin={skinShadow} />
      <FrontHair style={config.hair} hair={hair} headCy={headCy} headRx={headRx} headRy={headRy} />
      <Accessory
        style={config.accessory}
        headCy={headCy}
        headRx={headRx}
        outfit={outfit}
      />
    </svg>
  );
}

// ── Sub-layers ───────────────────────────────────────────────────────────────

function LowerBody({
  isDress,
  waist,
  outfit,
  outfitDark,
  skin,
  skinShadow,
}: {
  isDress: boolean;
  waist: number;
  outfit: string;
  outfitDark: string;
  skin: string;
  skinShadow: string;
}) {
  if (isDress) {
    // A-line skirt from the waist to a hem, then bare lower legs + shoes.
    return (
      <g>
        <path
          d={`M ${CX - waist} 200 L ${CX + waist} 200 L ${CX + waist + 20} 236 L ${CX - waist - 20} 236 Z`}
          fill={outfit}
        />
        <path d={`M ${CX} 202 L ${CX} 236`} stroke={outfitDark} strokeWidth={2} strokeOpacity={0.5} />
        <rect x={CX - 16} y={234} width={12} height={16} rx={4} fill={skin} />
        <rect x={CX + 4} y={234} width={12} height={16} rx={4} fill={skin} />
        <ellipse cx={CX - 10} cy={250} rx={10} ry={5} fill={skinShadow} />
        <ellipse cx={CX + 10} cy={250} rx={10} ry={5} fill={skinShadow} />
      </g>
    );
  }
  // Trousers: two legs from the waist down, with shoes at the hem.
  return (
    <g>
      <path
        d={`M ${CX - waist} 200 L ${CX - 3} 200 L ${CX - 6} 246 L ${CX - waist + 2} 246 Z`}
        fill={outfit}
      />
      <path
        d={`M ${CX + waist} 200 L ${CX + 3} 200 L ${CX + 6} 246 L ${CX + waist - 2} 246 Z`}
        fill={outfit}
      />
      <path d={`M ${CX} 200 L ${CX} 246`} stroke={outfitDark} strokeWidth={1.5} strokeOpacity={0.4} />
      <path d={`M ${CX - waist + 2} 246 L ${CX - 6} 246 L ${CX - 8} 252 L ${CX - waist} 252 Z`} fill="#1b1f27" />
      <path d={`M ${CX + waist - 2} 246 L ${CX + 6} 246 L ${CX + 8} 252 L ${CX + waist} 252 Z`} fill="#1b1f27" />
    </g>
  );
}

function NeckAndCollar({
  hasCollar,
  hasTie,
  isZip,
  isTurtleneck,
  shirtTop,
  skin,
  skinShadow,
  outfit,
  outfitDark,
  outfitLight,
}: {
  hasCollar: boolean;
  hasTie: boolean;
  isZip: boolean;
  isTurtleneck: boolean;
  shirtTop: boolean;
  skin: string;
  skinShadow: string;
  outfit: string;
  outfitDark: string;
  outfitLight: string;
}) {
  return (
    <g>
      {/* Neck */}
      <rect x={CX - 9} y={104} width={18} height={22} rx={5} fill={skin} />
      <rect x={CX - 9} y={104} width={18} height={7} rx={5} fill={skinShadow} opacity={0.5} />

      {isTurtleneck ? (
        <path d={`M ${CX - 14} 124 Q ${CX} 116 ${CX + 14} 124 L ${CX + 13} 132 Q ${CX} 126 ${CX - 13} 132 Z`} fill={outfitLight} />
      ) : null}

      {/* Undershirt V for suit/blazer/shirt */}
      {(hasCollar || shirtTop) ? (
        <path d={`M ${CX - 16} 122 L ${CX} 150 L ${CX + 16} 122 Z`} fill={shade(outfit, 0.16)} />
      ) : null}

      {hasCollar ? (
        <g>
          {/* Lapels */}
          <path d={`M ${CX - 16} 122 L ${CX} 150 L ${CX - 3} 124 Z`} fill={outfitDark} />
          <path d={`M ${CX + 16} 122 L ${CX} 150 L ${CX + 3} 124 Z`} fill={outfitDark} />
        </g>
      ) : null}

      {hasTie ? (
        <path d={`M ${CX - 3.5} 128 L ${CX + 3.5} 128 L ${CX + 5} 160 L ${CX} 168 L ${CX - 5} 160 Z`} fill="#b3402f" />
      ) : null}

      {isZip ? (
        <g>
          <path d={`M ${CX} 124 L ${CX} 200`} stroke={outfitDark} strokeWidth={3} />
          <rect x={CX - 2} y={126} width={4} height={16} rx={2} fill={outfitLight} />
        </g>
      ) : null}
    </g>
  );
}

function Arms({
  shoulder,
  outfit,
  outfitDark,
  skin,
}: {
  shoulder: number;
  outfit: string;
  outfitDark: string;
  skin: string;
}) {
  return (
    <g>
      {/* Left sleeve */}
      <path
        d={`M ${CX - shoulder + 4} 132 Q ${CX - shoulder - 12} 160 ${CX - shoulder - 4} 196 L ${CX - shoulder + 10} 198 Q ${CX - shoulder + 6} 162 ${CX - 16} 138 Z`}
        fill={outfit}
      />
      <path
        d={`M ${CX + shoulder - 4} 132 Q ${CX + shoulder + 12} 160 ${CX + shoulder + 4} 196 L ${CX + shoulder - 10} 198 Q ${CX + shoulder - 6} 162 ${CX + 16} 138 Z`}
        fill={outfit}
      />
      {/* Cuff shading */}
      <path d={`M ${CX - shoulder - 4} 190 L ${CX - shoulder + 10} 192`} stroke={outfitDark} strokeWidth={3} strokeOpacity={0.5} />
      <path d={`M ${CX + shoulder + 4} 190 L ${CX + shoulder - 10} 192`} stroke={outfitDark} strokeWidth={3} strokeOpacity={0.5} />
      {/* Hands */}
      <circle cx={CX - shoulder + 2} cy={202} r={8} fill={skin} />
      <circle cx={CX + shoulder - 2} cy={202} r={8} fill={skin} />
    </g>
  );
}

function Face({
  expression,
  headCy,
  skin,
}: {
  expression: string;
  headCy: number;
  skin: string;
}) {
  const eyeY = headCy + 2;
  const browY = headCy - 8;
  const ink = "#2a2320";
  return (
    <g>
      {/* Brows */}
      {expression === "focused" ? (
        <g stroke={ink} strokeWidth={2.4} strokeLinecap="round">
          <line x1={CX - 18} y1={browY + 2} x2={CX - 7} y2={browY - 1} />
          <line x1={CX + 18} y1={browY + 2} x2={CX + 7} y2={browY - 1} />
        </g>
      ) : (
        <g stroke={ink} strokeWidth={2.2} strokeLinecap="round">
          <line x1={CX - 18} y1={browY} x2={CX - 7} y2={browY} />
          <line x1={CX + 18} y1={browY} x2={CX + 7} y2={browY} />
        </g>
      )}
      {/* Eyes */}
      <circle cx={CX - 12} cy={eyeY} r={3} fill={ink} />
      <circle cx={CX + 12} cy={eyeY} r={3} fill={ink} />
      {/* Nose */}
      <path d={`M ${CX} ${eyeY + 4} L ${CX - 3} ${eyeY + 12} L ${CX + 2} ${eyeY + 12}`} fill="none" stroke={skin} strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" />
      {/* Mouth */}
      {expression === "smile" ? (
        <path d={`M ${CX - 10} ${eyeY + 18} Q ${CX} ${eyeY + 27} ${CX + 10} ${eyeY + 18}`} fill="none" stroke={ink} strokeWidth={2.4} strokeLinecap="round" />
      ) : expression === "focused" ? (
        <line x1={CX - 7} y1={eyeY + 20} x2={CX + 7} y2={eyeY + 20} stroke={ink} strokeWidth={2.4} strokeLinecap="round" />
      ) : (
        <path d={`M ${CX - 8} ${eyeY + 20} Q ${CX} ${eyeY + 23} ${CX + 8} ${eyeY + 20}`} fill="none" stroke={ink} strokeWidth={2.4} strokeLinecap="round" />
      )}
    </g>
  );
}

function FacialHair({
  style,
  hair,
  headCy,
  headRx,
  jawY,
  skin,
}: {
  style: string;
  hair: string;
  headCy: number;
  headRx: number;
  jawY: number;
  skin: string;
}) {
  if (style === "none") return null;
  const mouthY = headCy + 2 + 20;
  if (style === "stubble") {
    return (
      <path
        d={`M ${CX - headRx + 5} ${headCy + 8} Q ${CX} ${jawY + 6} ${CX + headRx - 5} ${headCy + 8} Q ${CX} ${jawY - 6} ${CX - headRx + 5} ${headCy + 8} Z`}
        fill={hair}
        opacity={0.28}
      />
    );
  }
  if (style === "moustache") {
    return (
      <path d={`M ${CX - 11} ${mouthY - 5} Q ${CX} ${mouthY - 1} ${CX + 11} ${mouthY - 5} Q ${CX} ${mouthY + 3} ${CX - 11} ${mouthY - 5} Z`} fill={hair} />
    );
  }
  if (style === "goatee") {
    return (
      <g fill={hair}>
        <path d={`M ${CX - 10} ${mouthY - 5} Q ${CX} ${mouthY - 1} ${CX + 10} ${mouthY - 5} Q ${CX} ${mouthY + 2} ${CX - 10} ${mouthY - 5} Z`} />
        <path d={`M ${CX - 8} ${mouthY + 6} Q ${CX} ${jawY + 2} ${CX + 8} ${mouthY + 6} Q ${CX} ${mouthY + 12} ${CX - 8} ${mouthY + 6} Z`} />
      </g>
    );
  }
  // Full beard: jawline mask, with a mouth gap.
  return (
    <path
      d={`M ${CX - headRx + 2} ${headCy + 2}
          Q ${CX - headRx + 2} ${jawY + 8} ${CX} ${jawY + 10}
          Q ${CX + headRx - 2} ${jawY + 8} ${CX + headRx - 2} ${headCy + 2}
          Q ${CX + 12} ${headCy + 16} ${CX} ${headCy + 15}
          Q ${CX - 12} ${headCy + 16} ${CX - headRx + 2} ${headCy + 2} Z`}
      fill={hair}
    />
  );
}

function BackHair({
  style,
  hair,
  headCy,
  headRx,
  headRy,
}: {
  style: string;
  hair: string;
  headCy: number;
  headRx: number;
  headRy: number;
}) {
  const hairDark = shade(hair, -0.08);
  if (style === "long") {
    return (
      <path
        d={`M ${CX - headRx - 4} ${headCy - 6} Q ${CX - headRx - 12} ${headCy + 70} ${CX - headRx + 6} ${headCy + 96}
            L ${CX + headRx - 6} ${headCy + 96} Q ${CX + headRx + 12} ${headCy + 70} ${CX + headRx + 4} ${headCy - 6} Z`}
        fill={hairDark}
      />
    );
  }
  if (style === "ponytail") {
    return (
      <path
        d={`M ${CX + headRx - 6} ${headCy - 16} Q ${CX + headRx + 22} ${headCy + 6} ${CX + headRx + 14} ${headCy + 54}
            Q ${CX + headRx + 4} ${headCy + 40} ${CX + headRx + 2} ${headCy + 6} Z`}
        fill={hairDark}
      />
    );
  }
  if (style === "bun") {
    return <circle cx={CX} cy={headCy - headRy - 4} r={12} fill={hairDark} />;
  }
  return null;
}

function FrontHair({
  style,
  hair,
  headCy,
  headRx,
  headRy,
}: {
  style: string;
  hair: string;
  headCy: number;
  headRx: number;
  headRy: number;
}) {
  if (style === "bald") return null;
  const topY = headCy - headRy;
  const hairLight = shade(hair, 0.06);

  // A scalp cap shared by most styles.
  const cap = (
    <path
      d={`M ${CX - headRx - 1} ${headCy - 2}
          Q ${CX - headRx - 1} ${topY - 8} ${CX} ${topY - 8}
          Q ${CX + headRx + 1} ${topY - 8} ${CX + headRx + 1} ${headCy - 2}
          Q ${CX + headRx - 6} ${headCy - 18} ${CX} ${headCy - 20}
          Q ${CX - headRx + 6} ${headCy - 18} ${CX - headRx - 1} ${headCy - 2} Z`}
      fill={hair}
    />
  );

  if (style === "buzz") {
    return (
      <path
        d={`M ${CX - headRx + 1} ${headCy - 4} Q ${CX} ${topY - 4} ${CX + headRx - 1} ${headCy - 4} Q ${CX} ${headCy - 14} ${CX - headRx + 1} ${headCy - 4} Z`}
        fill={hair}
        opacity={0.85}
      />
    );
  }

  if (style === "short") {
    return cap;
  }

  if (style === "side") {
    return (
      <g>
        {cap}
        {/* Sweep across the forehead from the part */}
        <path d={`M ${CX - 4} ${headCy - 16} Q ${CX + 26} ${headCy - 20} ${CX + headRx - 2} ${headCy - 2} Q ${CX + 10} ${headCy - 10} ${CX - 4} ${headCy - 16} Z`} fill={hairLight} />
      </g>
    );
  }

  if (style === "curly") {
    return (
      <g fill={hair}>
        {cap}
        {[-26, -14, 0, 14, 26].map((dx, i) => (
          <circle key={i} cx={CX + dx} cy={topY - 2 + (i % 2 === 0 ? 2 : -2)} r={9} />
        ))}
        <circle cx={CX - headRx + 2} cy={headCy - 6} r={8} />
        <circle cx={CX + headRx - 2} cy={headCy - 6} r={8} />
      </g>
    );
  }

  // bun, ponytail, long all share a smooth front cap.
  return cap;
}

function Accessory({
  style,
  headCy,
  headRx,
  outfit,
}: {
  style: string;
  headCy: number;
  headRx: number;
  outfit: string;
}) {
  const eyeY = headCy + 2;
  if (style === "glasses") {
    return (
      <g fill="none" stroke="#2a2320" strokeWidth={2}>
        <rect x={CX - 20} y={eyeY - 6} width={14} height={12} rx={4} />
        <rect x={CX + 6} y={eyeY - 6} width={14} height={12} rx={4} />
        <line x1={CX - 6} y1={eyeY} x2={CX + 6} y2={eyeY} />
      </g>
    );
  }
  if (style === "sunglasses") {
    return (
      <g>
        <rect x={CX - 21} y={eyeY - 7} width={16} height={13} rx={4} fill="#15181f" />
        <rect x={CX + 5} y={eyeY - 7} width={16} height={13} rx={4} fill="#15181f" />
        <line x1={CX - 5} y1={eyeY - 3} x2={CX + 5} y2={eyeY - 3} stroke="#15181f" strokeWidth={3} />
      </g>
    );
  }
  if (style === "headset") {
    return (
      <g>
        <path d={`M ${CX - headRx - 3} ${headCy} Q ${CX} ${headCy - headRx - 16} ${CX + headRx + 3} ${headCy}`} fill="none" stroke="#20242e" strokeWidth={4} strokeLinecap="round" />
        <rect x={CX - headRx - 8} y={headCy - 4} width={9} height={16} rx={4} fill="#20242e" />
        <rect x={CX + headRx - 1} y={headCy - 4} width={9} height={16} rx={4} fill="#20242e" />
        {/* Mic boom */}
        <path d={`M ${CX - headRx - 3} ${headCy + 10} Q ${CX - headRx + 4} ${headCy + 26} ${CX - 10} ${headCy + 26}`} fill="none" stroke="#20242e" strokeWidth={3} strokeLinecap="round" />
      </g>
    );
  }
  if (style === "lanyard") {
    return (
      <g>
        <path d={`M ${CX - 12} 126 L ${CX - 4} 168`} stroke="#c94b3b" strokeWidth={3} fill="none" />
        <path d={`M ${CX + 12} 126 L ${CX + 4} 168`} stroke="#c94b3b" strokeWidth={3} fill="none" />
        <rect x={CX - 10} y={166} width={20} height={26} rx={3} fill="#e8edf5" stroke={outfit} strokeWidth={1.5} />
        <rect x={CX - 6} y={171} width={12} height={4} rx={2} fill="#98a2b3" />
        <rect x={CX - 6} y={178} width={9} height={3} rx={1.5} fill="#c3ccda" />
      </g>
    );
  }
  return null;
}
