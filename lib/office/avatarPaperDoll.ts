// lib/office/avatarPaperDoll.ts
// Framework-agnostic renderer for a member's AvatarConfig: builds the layered
// paper-doll as an SVG *string*. This is the single source of truth for how a
// person looks in the office — consumed by the React <AvatarPaperDoll> component
// (dangerouslySetInnerHTML) AND by the self-contained public/office/map.html
// (which has no React), so the Character Studio preview and the office floor
// always agree.
//
// Pure + deterministic: same config → same markup, no DOM, no hooks. Layers
// paint back-to-front per docs/avatars/AVATAR_SYSTEM_SPEC.md §4.1.

import {
  hairHex,
  outfitHex,
  skinHex,
  statusHex,
  type AvatarConfig,
} from "@/lib/office/avatarConfig";

/** The intrinsic coordinate box every avatar is drawn in. */
export const AVATAR_VIEWBOX = { w: 200, h: 260 } as const;

const CX = 100;

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

export interface AvatarSvgOptions {
  /** Rendered width in px; height follows the 200×260 aspect. Full-svg mode only. */
  size?: number;
  className?: string;
  showShadow?: boolean;
  showStatusRing?: boolean;
  title?: string;
  /** Return only the inner markup (no <svg> wrapper) so a host can embed it. */
  inner?: boolean;
}

// ── Layer builders (each returns an SVG markup string) ───────────────────────

function backHair(style: string, hair: string, headCy: number, headRx: number, headRy: number): string {
  const hairDark = shade(hair, -0.08);
  if (style === "long") {
    return `<path d="M ${CX - headRx - 4} ${headCy - 6} Q ${CX - headRx - 12} ${headCy + 70} ${CX - headRx + 6} ${headCy + 96} L ${CX + headRx - 6} ${headCy + 96} Q ${CX + headRx + 12} ${headCy + 70} ${CX + headRx + 4} ${headCy - 6} Z" fill="${hairDark}"/>`;
  }
  if (style === "ponytail") {
    return `<path d="M ${CX + headRx - 6} ${headCy - 16} Q ${CX + headRx + 22} ${headCy + 6} ${CX + headRx + 14} ${headCy + 54} Q ${CX + headRx + 4} ${headCy + 40} ${CX + headRx + 2} ${headCy + 6} Z" fill="${hairDark}"/>`;
  }
  if (style === "bun") {
    return `<circle cx="${CX}" cy="${headCy - headRy - 4}" r="12" fill="${hairDark}"/>`;
  }
  return "";
}

function lowerBody(
  isDress: boolean,
  waist: number,
  outfit: string,
  outfitDark: string,
  skin: string,
  skinShadow: string,
): string {
  if (isDress) {
    return (
      `<path d="M ${CX - waist} 200 L ${CX + waist} 200 L ${CX + waist + 20} 236 L ${CX - waist - 20} 236 Z" fill="${outfit}"/>` +
      `<path d="M ${CX} 202 L ${CX} 236" stroke="${outfitDark}" stroke-width="2" stroke-opacity="0.5"/>` +
      `<rect x="${CX - 16}" y="234" width="12" height="16" rx="4" fill="${skin}"/>` +
      `<rect x="${CX + 4}" y="234" width="12" height="16" rx="4" fill="${skin}"/>` +
      `<ellipse cx="${CX - 10}" cy="250" rx="10" ry="5" fill="${skinShadow}"/>` +
      `<ellipse cx="${CX + 10}" cy="250" rx="10" ry="5" fill="${skinShadow}"/>`
    );
  }
  return (
    `<path d="M ${CX - waist} 200 L ${CX - 3} 200 L ${CX - 6} 246 L ${CX - waist + 2} 246 Z" fill="${outfit}"/>` +
    `<path d="M ${CX + waist} 200 L ${CX + 3} 200 L ${CX + 6} 246 L ${CX + waist - 2} 246 Z" fill="${outfit}"/>` +
    `<path d="M ${CX} 200 L ${CX} 246" stroke="${outfitDark}" stroke-width="1.5" stroke-opacity="0.4"/>` +
    `<path d="M ${CX - waist + 2} 246 L ${CX - 6} 246 L ${CX - 8} 252 L ${CX - waist} 252 Z" fill="#1b1f27"/>` +
    `<path d="M ${CX + waist - 2} 246 L ${CX + 6} 246 L ${CX + 8} 252 L ${CX + waist} 252 Z" fill="#1b1f27"/>`
  );
}

function neckAndCollar(config: AvatarConfig, skin: string, skinShadow: string, outfit: string, outfitDark: string, outfitLight: string): string {
  const hasCollar = config.outfit === "suit" || config.outfit === "blazer";
  const hasTie = config.outfit === "suit";
  const isZip = config.outfit === "hoodie";
  const isTurtleneck = config.outfit === "turtleneck";
  const shirtTop = config.outfit === "shirt" || config.outfit === "turtleneck";

  let s =
    `<rect x="${CX - 9}" y="104" width="18" height="22" rx="5" fill="${skin}"/>` +
    `<rect x="${CX - 9}" y="104" width="18" height="7" rx="5" fill="${skinShadow}" opacity="0.5"/>`;
  if (isTurtleneck) {
    s += `<path d="M ${CX - 14} 124 Q ${CX} 116 ${CX + 14} 124 L ${CX + 13} 132 Q ${CX} 126 ${CX - 13} 132 Z" fill="${outfitLight}"/>`;
  }
  if (hasCollar || shirtTop) {
    s += `<path d="M ${CX - 16} 122 L ${CX} 150 L ${CX + 16} 122 Z" fill="${shade(outfit, 0.16)}"/>`;
  }
  if (hasCollar) {
    s +=
      `<path d="M ${CX - 16} 122 L ${CX} 150 L ${CX - 3} 124 Z" fill="${outfitDark}"/>` +
      `<path d="M ${CX + 16} 122 L ${CX} 150 L ${CX + 3} 124 Z" fill="${outfitDark}"/>`;
  }
  if (hasTie) {
    s += `<path d="M ${CX - 3.5} 128 L ${CX + 3.5} 128 L ${CX + 5} 160 L ${CX} 168 L ${CX - 5} 160 Z" fill="#b3402f"/>`;
  }
  if (isZip) {
    s +=
      `<path d="M ${CX} 124 L ${CX} 200" stroke="${outfitDark}" stroke-width="3"/>` +
      `<rect x="${CX - 2}" y="126" width="4" height="16" rx="2" fill="${outfitLight}"/>`;
  }
  return s;
}

function arms(shoulder: number, outfit: string, outfitDark: string, skin: string): string {
  return (
    `<path d="M ${CX - shoulder + 4} 132 Q ${CX - shoulder - 12} 160 ${CX - shoulder - 4} 196 L ${CX - shoulder + 10} 198 Q ${CX - shoulder + 6} 162 ${CX - 16} 138 Z" fill="${outfit}"/>` +
    `<path d="M ${CX + shoulder - 4} 132 Q ${CX + shoulder + 12} 160 ${CX + shoulder + 4} 196 L ${CX + shoulder - 10} 198 Q ${CX + shoulder - 6} 162 ${CX + 16} 138 Z" fill="${outfit}"/>` +
    `<path d="M ${CX - shoulder - 4} 190 L ${CX - shoulder + 10} 192" stroke="${outfitDark}" stroke-width="3" stroke-opacity="0.5"/>` +
    `<path d="M ${CX + shoulder + 4} 190 L ${CX + shoulder - 10} 192" stroke="${outfitDark}" stroke-width="3" stroke-opacity="0.5"/>` +
    `<circle cx="${CX - shoulder + 2}" cy="202" r="8" fill="${skin}"/>` +
    `<circle cx="${CX + shoulder - 2}" cy="202" r="8" fill="${skin}"/>`
  );
}

function facialHair(style: string, hair: string, headCy: number, headRx: number, jawY: number): string {
  if (style === "none") return "";
  const mouthY = headCy + 2 + 20;
  if (style === "stubble") {
    return `<path d="M ${CX - headRx + 5} ${headCy + 8} Q ${CX} ${jawY + 6} ${CX + headRx - 5} ${headCy + 8} Q ${CX} ${jawY - 6} ${CX - headRx + 5} ${headCy + 8} Z" fill="${hair}" opacity="0.28"/>`;
  }
  if (style === "moustache") {
    return `<path d="M ${CX - 11} ${mouthY - 5} Q ${CX} ${mouthY - 1} ${CX + 11} ${mouthY - 5} Q ${CX} ${mouthY + 3} ${CX - 11} ${mouthY - 5} Z" fill="${hair}"/>`;
  }
  if (style === "goatee") {
    return (
      `<path d="M ${CX - 10} ${mouthY - 5} Q ${CX} ${mouthY - 1} ${CX + 10} ${mouthY - 5} Q ${CX} ${mouthY + 2} ${CX - 10} ${mouthY - 5} Z" fill="${hair}"/>` +
      `<path d="M ${CX - 8} ${mouthY + 6} Q ${CX} ${jawY + 2} ${CX + 8} ${mouthY + 6} Q ${CX} ${mouthY + 12} ${CX - 8} ${mouthY + 6} Z" fill="${hair}"/>`
    );
  }
  return `<path d="M ${CX - headRx + 2} ${headCy + 2} Q ${CX - headRx + 2} ${jawY + 8} ${CX} ${jawY + 10} Q ${CX + headRx - 2} ${jawY + 8} ${CX + headRx - 2} ${headCy + 2} Q ${CX + 12} ${headCy + 16} ${CX} ${headCy + 15} Q ${CX - 12} ${headCy + 16} ${CX - headRx + 2} ${headCy + 2} Z" fill="${hair}"/>`;
}

function face(expression: string, headCy: number, skinShadow: string): string {
  const eyeY = headCy + 2;
  const browY = headCy - 8;
  const ink = "#2a2320";
  let s = "";
  if (expression === "focused") {
    s +=
      `<g stroke="${ink}" stroke-width="2.4" stroke-linecap="round">` +
      `<line x1="${CX - 18}" y1="${browY + 2}" x2="${CX - 7}" y2="${browY - 1}"/>` +
      `<line x1="${CX + 18}" y1="${browY + 2}" x2="${CX + 7}" y2="${browY - 1}"/></g>`;
  } else {
    s +=
      `<g stroke="${ink}" stroke-width="2.2" stroke-linecap="round">` +
      `<line x1="${CX - 18}" y1="${browY}" x2="${CX - 7}" y2="${browY}"/>` +
      `<line x1="${CX + 18}" y1="${browY}" x2="${CX + 7}" y2="${browY}"/></g>`;
  }
  s +=
    `<circle cx="${CX - 12}" cy="${eyeY}" r="3" fill="${ink}"/>` +
    `<circle cx="${CX + 12}" cy="${eyeY}" r="3" fill="${ink}"/>` +
    `<path d="M ${CX} ${eyeY + 4} L ${CX - 3} ${eyeY + 12} L ${CX + 2} ${eyeY + 12}" fill="none" stroke="${skinShadow}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"/>`;
  if (expression === "smile") {
    s += `<path d="M ${CX - 10} ${eyeY + 18} Q ${CX} ${eyeY + 27} ${CX + 10} ${eyeY + 18}" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`;
  } else if (expression === "focused") {
    s += `<line x1="${CX - 7}" y1="${eyeY + 20}" x2="${CX + 7}" y2="${eyeY + 20}" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`;
  } else {
    s += `<path d="M ${CX - 8} ${eyeY + 20} Q ${CX} ${eyeY + 23} ${CX + 8} ${eyeY + 20}" fill="none" stroke="${ink}" stroke-width="2.4" stroke-linecap="round"/>`;
  }
  return s;
}

function frontHair(style: string, hair: string, headCy: number, headRx: number, headRy: number): string {
  if (style === "bald") return "";
  const topY = headCy - headRy;
  const hairLight = shade(hair, 0.06);
  const cap = `<path d="M ${CX - headRx - 1} ${headCy - 2} Q ${CX - headRx - 1} ${topY - 8} ${CX} ${topY - 8} Q ${CX + headRx + 1} ${topY - 8} ${CX + headRx + 1} ${headCy - 2} Q ${CX + headRx - 6} ${headCy - 18} ${CX} ${headCy - 20} Q ${CX - headRx + 6} ${headCy - 18} ${CX - headRx - 1} ${headCy - 2} Z" fill="${hair}"/>`;

  if (style === "buzz") {
    return `<path d="M ${CX - headRx + 1} ${headCy - 4} Q ${CX} ${topY - 4} ${CX + headRx - 1} ${headCy - 4} Q ${CX} ${headCy - 14} ${CX - headRx + 1} ${headCy - 4} Z" fill="${hair}" opacity="0.85"/>`;
  }
  if (style === "short") return cap;
  if (style === "side") {
    return (
      cap +
      `<path d="M ${CX - 4} ${headCy - 16} Q ${CX + 26} ${headCy - 20} ${CX + headRx - 2} ${headCy - 2} Q ${CX + 10} ${headCy - 10} ${CX - 4} ${headCy - 16} Z" fill="${hairLight}"/>`
    );
  }
  if (style === "curly") {
    let s = cap;
    const bumps = [-26, -14, 0, 14, 26];
    bumps.forEach((dx, i) => {
      s += `<circle cx="${CX + dx}" cy="${topY - 2 + (i % 2 === 0 ? 2 : -2)}" r="9" fill="${hair}"/>`;
    });
    s += `<circle cx="${CX - headRx + 2}" cy="${headCy - 6}" r="8" fill="${hair}"/>`;
    s += `<circle cx="${CX + headRx - 2}" cy="${headCy - 6}" r="8" fill="${hair}"/>`;
    return s;
  }
  return cap; // bun, ponytail, long share the front cap
}

function accessory(style: string, headCy: number, headRx: number, outfit: string): string {
  const eyeY = headCy + 2;
  if (style === "glasses") {
    return (
      `<g fill="none" stroke="#2a2320" stroke-width="2">` +
      `<rect x="${CX - 20}" y="${eyeY - 6}" width="14" height="12" rx="4"/>` +
      `<rect x="${CX + 6}" y="${eyeY - 6}" width="14" height="12" rx="4"/>` +
      `<line x1="${CX - 6}" y1="${eyeY}" x2="${CX + 6}" y2="${eyeY}"/></g>`
    );
  }
  if (style === "sunglasses") {
    return (
      `<rect x="${CX - 21}" y="${eyeY - 7}" width="16" height="13" rx="4" fill="#15181f"/>` +
      `<rect x="${CX + 5}" y="${eyeY - 7}" width="16" height="13" rx="4" fill="#15181f"/>` +
      `<line x1="${CX - 5}" y1="${eyeY - 3}" x2="${CX + 5}" y2="${eyeY - 3}" stroke="#15181f" stroke-width="3"/>`
    );
  }
  if (style === "headset") {
    return (
      `<path d="M ${CX - headRx - 3} ${headCy} Q ${CX} ${headCy - headRx - 16} ${CX + headRx + 3} ${headCy}" fill="none" stroke="#20242e" stroke-width="4" stroke-linecap="round"/>` +
      `<rect x="${CX - headRx - 8}" y="${headCy - 4}" width="9" height="16" rx="4" fill="#20242e"/>` +
      `<rect x="${CX + headRx - 1}" y="${headCy - 4}" width="9" height="16" rx="4" fill="#20242e"/>` +
      `<path d="M ${CX - headRx - 3} ${headCy + 10} Q ${CX - headRx + 4} ${headCy + 26} ${CX - 10} ${headCy + 26}" fill="none" stroke="#20242e" stroke-width="3" stroke-linecap="round"/>`
    );
  }
  if (style === "lanyard") {
    return (
      `<path d="M ${CX - 12} 126 L ${CX - 4} 168" stroke="#c94b3b" stroke-width="3" fill="none"/>` +
      `<path d="M ${CX + 12} 126 L ${CX + 4} 168" stroke="#c94b3b" stroke-width="3" fill="none"/>` +
      `<rect x="${CX - 10}" y="166" width="20" height="26" rx="3" fill="#e8edf5" stroke="${outfit}" stroke-width="1.5"/>` +
      `<rect x="${CX - 6}" y="171" width="12" height="4" rx="2" fill="#98a2b3"/>` +
      `<rect x="${CX - 6}" y="178" width="9" height="3" rx="1.5" fill="#c3ccda"/>`
    );
  }
  return "";
}

/** Build just the layered avatar markup (no <svg> wrapper). */
export function avatarInnerSvg(config: AvatarConfig, opts: Pick<AvatarSvgOptions, "showShadow" | "showStatusRing"> = {}): string {
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

  const headCy = 74;
  const headRx = 30;
  const headRy = 33;
  const jawY = headCy + headRy - 4;

  let s = "";
  if (opts.showStatusRing) {
    s += `<circle cx="${CX}" cy="132" r="122" fill="none" stroke="${status}" stroke-opacity="0.5" stroke-width="3"/>`;
  }
  if (opts.showShadow) {
    s += `<ellipse cx="${CX}" cy="250" rx="54" ry="9" fill="rgba(0,0,0,0.28)"/>`;
  }
  s += backHair(config.hair, hair, headCy, headRx, headRy);
  s += lowerBody(isDress, waist, outfit, outfitDark, skin, skinShadow);
  s += `<path d="M ${CX - shoulder} 150 Q ${CX - shoulder - 4} 128 ${CX - 22} 122 L ${CX + 22} 122 Q ${CX + shoulder + 4} 128 ${CX + shoulder} 150 L ${CX + waist} 208 Q ${CX} 218 ${CX - waist} 208 Z" fill="${outfit}"/>`;
  s += `<path d="M ${CX} 124 L ${CX} 210" stroke="${outfitDark}" stroke-width="2" stroke-opacity="0.55" fill="none"/>`;
  s += neckAndCollar(config, skin, skinShadow, outfit, outfitDark, outfitLight);
  s += arms(shoulder, outfit, outfitDark, skin);
  s += `<ellipse cx="${CX - headRx + 2}" cy="${headCy + 4}" rx="6" ry="9" fill="${skinShadow}"/>`;
  s += `<ellipse cx="${CX + headRx - 2}" cy="${headCy + 4}" rx="6" ry="9" fill="${skinShadow}"/>`;
  s += `<ellipse cx="${CX}" cy="${headCy}" rx="${headRx}" ry="${headRy}" fill="${skin}"/>`;
  s += `<path d="M ${CX - headRx + 4} ${headCy + 10} Q ${CX} ${jawY + 4} ${CX + headRx - 4} ${headCy + 10}" fill="none" stroke="${skinShadow}" stroke-opacity="0.5" stroke-width="2"/>`;
  s += facialHair(config.facialHair, hair, headCy, headRx, jawY);
  s += face(config.expression, headCy, skinShadow);
  s += frontHair(config.hair, hair, headCy, headRx, headRy);
  s += accessory(config.accessory, headCy, headRx, outfit);
  return s;
}

/**
 * Full standalone SVG string for an avatar. Pass `inner:true` to get just the
 * layered markup (for embedding inside a host's own <svg>, e.g. map.html).
 */
export function renderAvatarPaperDollSvg(config: AvatarConfig, opts: AvatarSvgOptions = {}): string {
  const inner = avatarInnerSvg(config, opts);
  if (opts.inner) return inner;
  const size = opts.size ?? 220;
  const height = (size * AVATAR_VIEWBOX.h) / AVATAR_VIEWBOX.w;
  const label = opts.title ?? `Avatar${config.displayName ? ` for ${config.displayName}` : ""}`;
  const cls = opts.className ? ` class="${opts.className}"` : "";
  const titleEl = opts.title ? `<title>${escapeXml(opts.title)}</title>` : "";
  return (
    `<svg viewBox="0 0 ${AVATAR_VIEWBOX.w} ${AVATAR_VIEWBOX.h}" width="${size}" height="${height}"${cls} role="img" aria-label="${escapeXml(label)}" shape-rendering="geometricPrecision" xmlns="http://www.w3.org/2000/svg">${titleEl}${inner}</svg>`
  );
}

function escapeXml(s: string): string {
  return s.replace(/[<>&"']/g, (c) =>
    c === "<" ? "&lt;" : c === ">" ? "&gt;" : c === "&" ? "&amp;" : c === '"' ? "&quot;" : "&#39;",
  );
}
