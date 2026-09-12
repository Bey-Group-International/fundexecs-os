// Client-only: turn a picked image File into the JPEG the server stores.
//
// Mirrors components/build/logo-resize.ts (the brand-logo equivalent) but
// always lands on JPEG, because avatars are photographs -- a 512px JPEG
// portrait is ~40-80KB where the same image as PNG is several hundred.
//
// Aspect ratio is preserved; the round frames on screen use object-cover, so
// the crop the operator sees is the one the browser does at render time.

import { AVATAR_MAX_EDGE, MAX_AVATAR_BYTES } from "@/lib/avatar";

const JPEG_QUALITY = 0.85;

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

function toBlob(canvas: HTMLCanvasElement): Promise<Blob | null> {
  return new Promise((resolve) => {
    canvas.toBlob((blob) => resolve(blob), "image/jpeg", JPEG_QUALITY);
  });
}

export interface EncodedAvatar {
  /** The bytes to upload. Always image/jpeg. */
  file: File;
  /** Object URL for an immediate local preview. Caller revokes it. */
  previewUrl: string;
}

/**
 * Downscale `file` to at most AVATAR_MAX_EDGE on its longest side and re-encode
 * it as JPEG. Returns `{ error }` for anything the browser cannot decode (a
 * corrupt file, or a HEIC the browser has no decoder for) or that is still over
 * the size ceiling afterwards.
 */
export async function encodeAvatar(file: File): Promise<EncodedAvatar | { error: string }> {
  const sourceUrl = URL.createObjectURL(file);
  try {
    const img = await loadImage(sourceUrl);
    const longest = Math.max(img.width, img.height);
    const scale = longest > AVATAR_MAX_EDGE ? AVATAR_MAX_EDGE / longest : 1;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));

    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { error: "Could not process this image. Try another file." };

    // JPEG has no alpha. Paint white first so a transparent PNG does not come
    // out with a black halo around the subject.
    ctx.fillStyle = "#ffffff";
    ctx.fillRect(0, 0, w, h);
    ctx.drawImage(img, 0, 0, w, h);

    const blob = await toBlob(canvas);
    if (!blob) return { error: "Could not process this image. Try another file." };
    if (blob.size > MAX_AVATAR_BYTES) {
      return { error: "That image is too large after compression. Try a smaller file." };
    }

    return {
      file: new File([blob], "avatar.jpg", { type: "image/jpeg" }),
      previewUrl: URL.createObjectURL(blob),
    };
  } catch {
    return { error: "Could not read that file. Make sure it's a valid PNG or JPEG." };
  } finally {
    URL.revokeObjectURL(sourceUrl);
  }
}
