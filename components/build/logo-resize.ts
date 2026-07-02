// Client-only utilities for resizing logo images in-browser via Canvas.

export const MAX_LOGO_BYTES = 600 * 1024;

export function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = reject;
    img.src = src;
  });
}

// Approximate decoded byte size of a base64 data URL.
export function estimateBytes(dataUrl: string): number {
  const i = dataUrl.indexOf(",");
  const b64 = i >= 0 ? dataUrl.slice(i + 1) : dataUrl;
  return Math.floor((b64.length * 3) / 4);
}

// Downscale an image File to ≤512px on the longest side, encode as WebP/PNG,
// and return the data URL. Throws on unreadable files; returns null if the
// result exceeds MAX_LOGO_BYTES after compression.
export async function resizeLogo(file: File): Promise<{ dataUrl: string } | { error: string }> {
  const url = URL.createObjectURL(file);
  try {
    const img = await loadImage(url);
    const longest = Math.max(img.width, img.height);
    const scale = longest > 512 ? 512 / longest : 1;
    const w = Math.max(1, Math.round(img.width * scale));
    const h = Math.max(1, Math.round(img.height * scale));
    const canvas = document.createElement("canvas");
    canvas.width = w;
    canvas.height = h;
    const ctx = canvas.getContext("2d");
    if (!ctx) return { error: "Could not process this image. Try another file." };
    ctx.drawImage(img, 0, 0, w, h);
    let dataUrl = canvas.toDataURL("image/webp", 0.85);
    if (!dataUrl.startsWith("data:image/webp")) {
      dataUrl = canvas.toDataURL("image/png");
    }
    if (estimateBytes(dataUrl) > MAX_LOGO_BYTES) {
      return { error: "That image is too large after compression (>600KB). Try a smaller or simpler image." };
    }
    return { dataUrl };
  } catch {
    return { error: "Could not read that file. Make sure it's a valid image." };
  } finally {
    URL.revokeObjectURL(url);
  }
}
