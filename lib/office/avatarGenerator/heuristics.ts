/**
 * Pure, DOM-free heuristics for the photo → 2.5D avatar generator.
 *
 * These map inferred pixel tones onto the *existing* avatar palette and produce
 * editable {@link UserAvatar}s. No image decoding here (that lives in the
 * on-device provider) — just deterministic, unit-testable colour math and
 * profile assembly, so the mapping is verifiable without a browser.
 */
import {
  type UserAvatar,
  SKIN_TONES,
  HAIR_COLORS,
  WARDROBES,
  AVATAR_ACCENTS,
  presentationDefaults,
} from "../userAvatar";
import type { AvatarAttributeAnalysis, GeneratedAvatarProfile } from "./types";

export const ACCEPTED_IMAGE_TYPES = ["image/jpeg", "image/jpg", "image/png", "image/heic", "image/webp"];
export const MAX_IMAGE_BYTES = 12 * 1024 * 1024; // 12 MB
export const MIN_IMAGE_DIM = 200; // px, shortest side

export type RGB = { r: number; g: number; b: number };

/** Parse a `#rrggbb` (or `rrggbb`) hex string to RGB. */
export function hexToRgb(hex: string): RGB {
  const h = hex.replace("#", "");
  return { r: parseInt(h.slice(0, 2), 16), g: parseInt(h.slice(2, 4), 16), b: parseInt(h.slice(4, 6), 16) };
}

/** Format RGB (0–255, clamped/rounded) as `#rrggbb`. */
export function rgbToHex({ r, g, b }: RGB): string {
  const c = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, "0");
  return `#${c(r)}${c(g)}${c(b)}`;
}

/** Squared Euclidean distance in RGB space (cheap, good enough for nearest-swatch). */
export function colorDistance(a: RGB, b: RGB): number {
  const dr = a.r - b.r, dg = a.g - b.g, db = a.b - b.b;
  return dr * dr + dg * dg + db * db;
}

/** The palette swatch nearest to `rgb`. Returns the first on an exact tie. */
export function nearestPaletteColor(rgb: RGB, palette: readonly string[]): string {
  let best = palette[0];
  let bestD = Infinity;
  for (const hex of palette) {
    const d = colorDistance(rgb, hexToRgb(hex));
    if (d < bestD) {
      bestD = d;
      best = hex;
    }
  }
  return best;
}

/** Confidence from how close the sampled tone is to its nearest swatch (0..1). */
export function toneConfidence(rgb: RGB, chosenHex: string): number {
  const d = Math.sqrt(colorDistance(rgb, hexToRgb(chosenHex)));
  // 0 distance → 1.0; ~120 units away → ~0. Clamped.
  return Math.max(0, Math.min(1, 1 - d / 120));
}

/** Validate image metadata (type / size / dimensions). Pure. */
export function validateImageMeta(meta: {
  type: string;
  size: number;
  width: number;
  height: number;
}): { ok: true } | { ok: false; code: "unsupported_type" | "too_large" | "too_small"; message: string } {
  if (!ACCEPTED_IMAGE_TYPES.includes(meta.type.toLowerCase())) {
    return { ok: false, code: "unsupported_type", message: "Use a JPG, PNG, WebP, or HEIC image." };
  }
  if (meta.size > MAX_IMAGE_BYTES) {
    return { ok: false, code: "too_large", message: "Image is over 12 MB — please use a smaller file." };
  }
  if (Math.min(meta.width, meta.height) < MIN_IMAGE_DIM) {
    return { ok: false, code: "too_small", message: `Image is too small — at least ${MIN_IMAGE_DIM}px on the short side.` };
  }
  return { ok: true };
}

/**
 * Map an inferred skin/hair analysis onto an editable avatar, preserving the
 * seed's identity (name, role, presentation). Skin and hair snap to the nearest
 * existing palette swatch so the figure reads as part of the team.
 */
export function analysisToAvatar(analysis: AvatarAttributeAnalysis, base: UserAvatar): UserAvatar {
  const skin = nearestPaletteColor(hexToRgb(analysis.skinHex), SKIN_TONES);
  const hair = nearestPaletteColor(hexToRgb(analysis.hairHex), HAIR_COLORS);
  const preset = presentationDefaults(base.genderStyle);
  return {
    ...base,
    skin,
    hair,
    hairStyle: base.hairStyle ?? preset.hairStyle,
    build: base.build ?? preset.build,
  };
}

/**
 * Build a primary interpretation plus `count` alternatives. The primary is the
 * faithful mapping; alternatives vary only the wardrobe and accent (deterministic,
 * no randomness) so the operator can pick a vibe without re-analysing.
 */
export function buildProfiles(
  analysis: AvatarAttributeAnalysis,
  base: UserAvatar,
  count: number,
): { primary: GeneratedAvatarProfile; alternatives: GeneratedAvatarProfile[] } {
  const primaryAvatar = analysisToAvatar(analysis, base);
  const primary: GeneratedAvatarProfile = { id: "gen-primary", avatar: primaryAvatar, label: "Primary" };

  const alternatives: GeneratedAvatarProfile[] = [];
  for (let i = 0; i < Math.max(0, count); i++) {
    const wardrobe = WARDROBES[(i + 1) % WARDROBES.length].id;
    const accent = AVATAR_ACCENTS[(i + 1) % AVATAR_ACCENTS.length];
    alternatives.push({
      id: `gen-alt-${i + 1}`,
      avatar: { ...primaryAvatar, wardrobe, accent },
      label: `Alternative ${i + 1}`,
    });
  }
  return { primary, alternatives };
}
