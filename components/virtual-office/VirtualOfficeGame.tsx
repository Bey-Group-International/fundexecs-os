"use client";

import { useEffect, useRef } from "react";
import type Phaser from "phaser";
import { WORLD_W, WORLD_H } from "./types";

// Canvas fills its container; game uses the container dimensions
const GAME_WIDTH = 900;
const GAME_HEIGHT = 600;

export function VirtualOfficeGame() {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;
    if (gameRef.current) return; // already mounted

    let game: Phaser.Game | null = null;

    // Dynamic import keeps Phaser out of the SSR bundle
    import("phaser").then((PhaserModule) => {
      const PhaserLib = PhaserModule.default;

      import("./scenes/OfficeScene").then(({ OfficeScene }) => {
        if (!containerRef.current) return;

        game = new PhaserLib.Game({
          type: PhaserLib.AUTO,
          width: GAME_WIDTH,
          height: GAME_HEIGHT,
          backgroundColor: "#0f172a",
          parent: containerRef.current,
          physics: {
            default: "arcade",
            arcade: { gravity: { x: 0, y: 0 }, debug: false },
          },
          scene: [OfficeScene],
          scale: {
            mode: PhaserLib.Scale.FIT,
            autoCenter: PhaserLib.Scale.CENTER_BOTH,
          },
          // Suppress Phaser banner in console
          banner: false,
        });

        gameRef.current = game;
      });
    });

    return () => {
      game?.destroy(true);
      gameRef.current = null;
    };
  }, []);

  return (
    <div className="relative flex flex-col bg-slate-950 rounded-xl overflow-hidden border border-slate-800">
      {/* Controls hint */}
      <div className="absolute top-3 right-3 z-10 flex gap-2 text-[10px] text-slate-500 bg-slate-900/80 rounded px-2 py-1 pointer-events-none">
        <span>WASD / ↑↓←→ to move</span>
      </div>

      {/* Phaser canvas mount point */}
      <div
        ref={containerRef}
        style={{ width: GAME_WIDTH, height: GAME_HEIGHT, maxWidth: "100%" }}
        className="mx-auto"
      />
    </div>
  );
}
