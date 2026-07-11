"use client";

/**
 * On-device avatar generation provider.
 *
 * Everything happens in the browser: the photo is decoded to a canvas, a couple
 * of regions are sampled for skin/hair tone, and those map onto the existing
 * avatar palette. The image is NEVER uploaded — so `deleteSourceImage` just
 * revokes the object URL. Face counting uses the experimental `FaceDetector`
 * when the browser exposes it, and degrades gracefully (faceCount = null) when
 * it doesn't, rather than blocking generation.
 */
import type {
  AvatarGenerationProvider,
  AvatarImageInput,
  AvatarImageValidationResult,
  AvatarAttributeAnalysis,
  AvatarGenerationRequest,
  AvatarGenerationResult,
  AvatarVariationRequest,
  GeneratedAvatarProfile,
} from "./types";
import {
  validateImageMeta,
  rgbToHex,
  toneConfidence,
  nearestPaletteColor,
  analysisToAvatar,
  buildProfiles,
  type RGB,
} from "./heuristics";
import { SKIN_TONES, HAIR_COLORS, WARDROBES, AVATAR_ACCENTS } from "../userAvatar";

/** Decode a File/objectURL into an HTMLImageElement. */
function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error("decode_failed"));
    img.src = src;
  });
}

/** Average RGB over a rectangular region of image data. */
function averageRegion(data: Uint8ClampedArray, w: number, x0: number, y0: number, x1: number, y1: number): RGB {
  let r = 0, g = 0, b = 0, n = 0;
  for (let y = y0; y < y1; y++) {
    for (let x = x0; x < x1; x++) {
      const i = (y * w + x) * 4;
      r += data[i];
      g += data[i + 1];
      b += data[i + 2];
      n++;
    }
  }
  if (n === 0) return { r: 128, g: 128, b: 128 };
  return { r: r / n, g: g / n, b: b / n };
}

type FaceDetectorLike = { detect(source: CanvasImageSource): Promise<Array<unknown>> };

async function detectFaceCount(img: HTMLImageElement): Promise<number | null> {
  const Ctor = (globalThis as unknown as { FaceDetector?: new (o?: unknown) => FaceDetectorLike }).FaceDetector;
  if (!Ctor) return null;
  try {
    const det = new Ctor({ fastMode: true, maxDetectedFaces: 5 });
    const faces = await det.detect(img);
    return faces.length;
  } catch {
    return null;
  }
}

export const onDeviceAvatarProvider: AvatarGenerationProvider = {
  async validateImage(input: AvatarImageInput): Promise<AvatarImageValidationResult> {
    let img: HTMLImageElement;
    try {
      img = await loadImage(input.previewUrl);
    } catch {
      return { ok: false, code: "decode_failed", message: "That image couldn't be read — try another file." };
    }
    const meta = validateImageMeta({
      type: input.file.type || "",
      size: input.file.size,
      width: img.naturalWidth,
      height: img.naturalHeight,
    });
    if (!meta.ok) return meta;

    const faceCount = await detectFaceCount(img);
    if (faceCount === 0) {
      return { ok: false, code: "no_face", message: "No face detected — face the camera with your head and shoulders visible." };
    }
    if (faceCount !== null && faceCount > 1) {
      return { ok: false, code: "multiple_faces", message: "More than one face detected — use a photo of just yourself." };
    }
    return { ok: true };
  },

  async analyzeImage(input: AvatarImageInput): Promise<AvatarAttributeAnalysis> {
    const img = await loadImage(input.previewUrl);
    // Downscale to a small working canvas for a fast, stable average.
    const W = 96;
    const H = Math.max(1, Math.round((img.naturalHeight / img.naturalWidth) * W));
    const canvas = document.createElement("canvas");
    canvas.width = W;
    canvas.height = H;
    const ctx = canvas.getContext("2d");
    if (!ctx) {
      return { skinHex: "#e0a878", hairHex: "#2b2320", faceCount: null, confidence: {} };
    }
    ctx.drawImage(img, 0, 0, W, H);
    const { data } = ctx.getImageData(0, 0, W, H);

    // Skin: central box (roughly the face). Hair: a band across the top.
    const skinRgb = averageRegion(data, W, Math.round(W * 0.32), Math.round(H * 0.35), Math.round(W * 0.68), Math.round(H * 0.68));
    const hairRgb = averageRegion(data, W, Math.round(W * 0.3), Math.round(H * 0.04), Math.round(W * 0.7), Math.round(H * 0.2));

    const skinHex = rgbToHex(skinRgb);
    const hairHex = rgbToHex(hairRgb);
    const faceCount = await detectFaceCount(img);
    return {
      skinHex,
      hairHex,
      faceCount,
      confidence: {
        skin: toneConfidence(skinRgb, nearestPaletteColor(skinRgb, SKIN_TONES)),
        hair: toneConfidence(hairRgb, nearestPaletteColor(hairRgb, HAIR_COLORS)),
      },
    };
  },

  async generateAvatar(request: AvatarGenerationRequest): Promise<AvatarGenerationResult> {
    return buildProfiles(request.analysis, request.base, request.variations ?? 2);
  },

  async regenerateVariation(request: AvatarVariationRequest): Promise<GeneratedAvatarProfile> {
    const i = request.index;
    const wardrobe = WARDROBES[(i + 1) % WARDROBES.length].id;
    const accent = AVATAR_ACCENTS[(i + 1) % AVATAR_ACCENTS.length];
    return {
      id: `gen-alt-${i + 1}`,
      avatar: { ...request.from, wardrobe, accent },
      label: `Alternative ${i + 1}`,
    };
  },

  async deleteSourceImage(input: AvatarImageInput): Promise<void> {
    // Nothing was ever uploaded or stored — just release the in-browser object.
    try {
      URL.revokeObjectURL(input.previewUrl);
    } catch {
      /* already revoked */
    }
  },
};

// Re-exported so callers can map an analysis without the full provider.
export { analysisToAvatar };
