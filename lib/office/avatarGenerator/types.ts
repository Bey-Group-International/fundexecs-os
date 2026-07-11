/**
 * Photo → 2.5D avatar generation — provider contract and data shapes.
 *
 * The generator is abstracted behind {@link AvatarGenerationProvider} so the
 * implementation can evolve (today: a fully on-device provider that never
 * uploads the photo; later, optionally, a server/model-backed one) without the
 * UI changing. All generated attributes map into the existing
 * {@link import("../userAvatar").UserAvatar} schema and stay editable.
 */
import type { UserAvatar } from "../userAvatar";

/** A user-provided source image, as an in-browser object (never a remote URL). */
export type AvatarImageInput = {
  /** The raw file the user selected or captured. */
  file: File;
  /** Object URL for preview; the caller revokes it when done. */
  previewUrl: string;
};

/** Result of validating an image before analysis. */
export type AvatarImageValidationResult =
  | { ok: true }
  | { ok: false; code: AvatarValidationCode; message: string };

export type AvatarValidationCode =
  | "unsupported_type"
  | "too_large"
  | "too_small"
  | "no_face"
  | "multiple_faces"
  | "too_blurry"
  | "decode_failed";

/**
 * Visual attributes inferred from the photo. Deliberately limited to what an
 * avatar needs — never ethnicity, health, or any sensitive characteristic. All
 * fields are best-effort and every one is editable downstream.
 */
export type AvatarAttributeAnalysis = {
  /** Dominant skin tone as `#rrggbb`. */
  skinHex: string;
  /** Dominant hair tone as `#rrggbb`. */
  hairHex: string;
  /** How many faces were detected (when detection is available; else null). */
  faceCount: number | null;
  /** Per-attribute confidence 0..1 for what was inferred. */
  confidence: Record<string, number>;
};

/** A single generated avatar interpretation. */
export type GeneratedAvatarProfile = {
  id: string;
  /** The editable avatar this interpretation maps to. */
  avatar: UserAvatar;
  /** Short label, e.g. "Primary" / "Alternative 1". */
  label: string;
};

export type AvatarGenerationRequest = {
  analysis: AvatarAttributeAnalysis;
  /** Seed name/role so the generated avatars carry the operator's identity. */
  base: UserAvatar;
  /** How many alternatives to produce alongside the primary. */
  variations?: number;
};

export type AvatarGenerationResult = {
  primary: GeneratedAvatarProfile;
  alternatives: GeneratedAvatarProfile[];
};

export type AvatarVariationRequest = {
  from: UserAvatar;
  index: number;
};

/** Async job lifecycle the UI reflects (never a blank spinner). */
export type AvatarJobState =
  | "idle"
  | "consent"
  | "upload"
  | "validating"
  | "analyzing"
  | "generating"
  | "ready"
  | "failed";

/**
 * The pluggable generation provider. An implementation must never transmit the
 * source image anywhere the user hasn't consented to; the on-device provider
 * keeps everything in the browser and `deleteSourceImage` simply drops it.
 */
export interface AvatarGenerationProvider {
  validateImage(input: AvatarImageInput): Promise<AvatarImageValidationResult>;
  analyzeImage(input: AvatarImageInput): Promise<AvatarAttributeAnalysis>;
  generateAvatar(request: AvatarGenerationRequest): Promise<AvatarGenerationResult>;
  regenerateVariation(request: AvatarVariationRequest): Promise<GeneratedAvatarProfile>;
  deleteSourceImage(input: AvatarImageInput): Promise<void>;
}
