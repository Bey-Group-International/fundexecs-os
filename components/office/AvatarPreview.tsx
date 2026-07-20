"use client";

// A small, self-contained canvas that renders one smooth-vector avatar from a
// config through the shared render seam, so the look is identical to the office
// floor. DPR-aware for retina crispness. By default it paints a single static
// frame; pass `animate` to run a rAF for idle breathing + blink.
import { useEffect, useRef } from "react";
import { drawAvatar } from "@/components/office/vectorAvatar";
import type { AvatarConfig, Facing } from "@/lib/office/avatarConfig";

interface AvatarPreviewProps {
  config: AvatarConfig;
  /** Rendered figure height in CSS pixels (default 96). */
  size?: number;
  /** Facing to show (default "down"). */
  facing?: Facing;
  /** Run a rAF loop for idle breathing/blink (default static). */
  animate?: boolean;
}

export function AvatarPreview({
  config,
  size = 96,
  facing = "down",
  animate = false,
}: AvatarPreviewProps) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  // The figure is centered in a square a touch wider than it is tall.
  const cssHeight = size;
  const cssWidth = Math.round(size * 0.8);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;

    const dpr = typeof window !== "undefined" ? window.devicePixelRatio || 1 : 1;
    canvas.width = Math.round(cssWidth * dpr);
    canvas.height = Math.round(cssHeight * dpr);

    let raf = 0;
    const paint = (t: number) => {
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      ctx.clearRect(0, 0, cssWidth, cssHeight);
      drawAvatar(ctx, {
        config,
        x: cssWidth / 2,
        // Leave headroom for hair; feet a hair above the bottom edge.
        y: cssHeight - 2,
        height: cssHeight - 6,
        facing,
        timeMs: t,
        moving: false,
      });
      if (animate) raf = requestAnimationFrame(paint);
    };

    if (animate) {
      raf = requestAnimationFrame(paint);
    } else {
      paint(0);
    }
    return () => {
      if (raf) cancelAnimationFrame(raf);
    };
  }, [config, facing, animate, cssWidth, cssHeight]);

  return (
    <canvas
      ref={canvasRef}
      style={{ width: cssWidth, height: cssHeight }}
      aria-hidden
    />
  );
}

export default AvatarPreview;
