"use client";

// A small, self-contained canvas that renders one pixel-art avatar from a
// config. Used by the customizer's live preview and anywhere a single character
// needs to be shown outside the office floor. Draws through the shared render
// seam so the look is identical to the office. DPR-aware for crispness.
import { useEffect, useRef } from "react";
import { drawAvatar } from "@/components/office/pixelDraw";
import { SPRITE_H, SPRITE_W } from "@/lib/office/avatarSprites";
import type { AvatarConfig, Facing } from "@/lib/office/avatarConfig";

interface AvatarPreviewProps {
  config: AvatarConfig;
  /** Rendered sprite height in CSS pixels (default 64). */
  size?: number;
  /** Facing to show (default "down"). */
  facing?: Facing;
}

export function AvatarPreview({
  config,
  size = 64,
  facing = "down",
}: AvatarPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const cssWidth = Math.round((size * SPRITE_W) / SPRITE_H);
  const cssHeight = size;

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    ctx.imageSmoothingEnabled = false;
    ctx.clearRect(0, 0, cssWidth, cssHeight);

    drawAvatar(ctx, {
      config,
      x: cssWidth / 2,
      y: cssHeight,
      height: cssHeight,
      facing,
      frame: 0,
    });
  }, [config, facing, cssWidth, cssHeight]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: cssWidth, height: cssHeight, imageRendering: "pixelated" }}
      aria-hidden
    />
  );
}

export default AvatarPreview;
