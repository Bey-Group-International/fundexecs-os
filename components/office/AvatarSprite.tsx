"use client";

import { useEffect, useRef, useState } from "react";
import { CELL, DIR, drawAvatarFrame, type Facing } from "@/lib/office/avatarSprite";
import type { AvatarConfig } from "@/lib/office/avatarConfig";

// Live pixel-art preview of an AvatarConfig, rendered on a canvas so it reads in
// the exact 16-bit idiom the office floor uses. Animates the walk cycle and lets
// the viewer turn the character through the four facings. The office renders the
// same frames from the same generator (lib/office/avatarSprite), so what you
// build here is what walks the floor.

// The persona walk cadence (map.html WALKSEQ): a distance-based ping-pong.
const WALKSEQ = [1, 0, 1, 2];
const FRAME_MS = 190;

export function AvatarSprite({
  config,
  size = 200,
  className,
}: {
  config: AvatarConfig;
  size?: number;
  className?: string;
}) {
  const ref = useRef<HTMLCanvasElement>(null);
  const [facing, setFacing] = useState<Facing>("down");

  useEffect(() => {
    const canvas = ref.current;
    if (!canvas) return;
    const ctx = canvas.getContext("2d");
    if (!ctx) return;
    ctx.imageSmoothingEnabled = false;

    // Pre-render the three walk frames (with rim halo) once per facing/config,
    // then the RAF just blits — cheap enough for a smooth loop.
    const frames = [0, 1, 2].map((fr) => {
      const cv = document.createElement("canvas");
      cv.width = CELL;
      cv.height = CELL;
      const c = cv.getContext("2d");
      if (c) {
        c.imageSmoothingEnabled = false;
        drawAvatarFrame(c, config, facing, fr);
      }
      return cv;
    });

    let raf = 0;
    let seq = 0;
    let last = 0;
    const tick = (t: number) => {
      if (!last) last = t;
      if (t - last >= FRAME_MS) {
        last = t;
        seq = (seq + 1) % WALKSEQ.length;
      }
      ctx.clearRect(0, 0, CELL, CELL);
      ctx.drawImage(frames[WALKSEQ[seq]], 0, 0);
      raf = requestAnimationFrame(tick);
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [config, facing]);

  return (
    <div className={className}>
      <canvas
        ref={ref}
        width={CELL}
        height={CELL}
        style={{ width: size, height: size, imageRendering: "pixelated", display: "block" }}
        aria-label={`Pixel avatar${config.displayName ? ` for ${config.displayName}` : ""}`}
        role="img"
      />
      <div className="mt-2 flex items-center justify-center gap-1">
        {(Object.keys(DIR) as Facing[]).map((f) => (
          <button
            key={f}
            type="button"
            aria-pressed={facing === f}
            onClick={() => setFacing(f)}
            className={`rounded border px-2 py-0.5 font-mono text-[10px] uppercase tracking-wider transition ${
              facing === f
                ? "border-gold-500/50 bg-gold-500/10 text-gold-200"
                : "border-line text-fg-muted hover:text-fg-secondary"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
    </div>
  );
}
