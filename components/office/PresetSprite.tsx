"use client";

import { useEffect, useRef, useState } from "react";

// Animated preview of a ready-made character preset. Reads the preset's walk
// atlas (768×1024, 3 cols × 4 rows of 256px cells; rows = down/up/left/right)
// and cycles the walk frames for the chosen facing — the same atlas the office
// floor renders, so the Studio preview matches the floor exactly.

const WALKSEQ = [1, 0, 1, 2]; // gentle mid→out→mid→out cadence
const FRAME_MS = 190;
const ROW = { down: 0, up: 1, left: 2, right: 3 } as const;
type Facing = keyof typeof ROW;

export function PresetSprite({
  atlas,
  size = 200,
  className = "",
}: {
  atlas: string;
  size?: number;
  className?: string;
}) {
  const [facing, setFacing] = useState<Facing>("down");
  const [seq, setSeq] = useState(0);
  const timer = useRef<ReturnType<typeof setInterval> | null>(null);

  useEffect(() => {
    timer.current = setInterval(() => setSeq((s) => (s + 1) % WALKSEQ.length), FRAME_MS);
    return () => {
      if (timer.current) clearInterval(timer.current);
    };
  }, []);

  const col = WALKSEQ[seq]; // 0..2
  const row = ROW[facing]; // 0..3

  return (
    <div className={`flex flex-col items-center gap-2 ${className}`}>
      <div
        aria-label="Character preview"
        style={{
          width: size,
          height: size,
          backgroundImage: `url("${atlas}")`,
          backgroundSize: "300% 400%",
          backgroundPosition: `${col * 50}% ${row * (100 / 3)}%`,
          backgroundRepeat: "no-repeat",
          imageRendering: "auto",
          filter: "drop-shadow(0 3px 3px rgba(0,0,0,.45))",
        }}
      />
      <div className="flex gap-1">
        {(Object.keys(ROW) as Facing[]).map((f) => (
          <button
            key={f}
            type="button"
            onClick={() => setFacing(f)}
            aria-pressed={f === facing}
            className={`rounded px-1.5 py-0.5 font-mono text-[9px] uppercase tracking-wider transition ${
              f === facing
                ? "bg-gold-500/15 text-gold-200"
                : "text-fg-muted hover:text-fg-secondary"
            }`}
          >
            {f}
          </button>
        ))}
      </div>
    </div>
  );
}
