"use client";

import { useEffect, useRef, useState } from "react";
import type Phaser from "phaser";
import type { OfficeSceneInitData } from "./scenes/OfficeScene";
import { BubbleOverlay } from "./BubbleOverlay";

// Canvas fills its container; game uses the container dimensions
const GAME_WIDTH = 900;
const GAME_HEIGHT = 600;

type VirtualOfficeGameProps = {
  /** Supabase JWT — when provided, enables multiplayer mode. */
  token?: string;
};

export function VirtualOfficeGame({ token }: VirtualOfficeGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const [bubbleMembers, setBubbleMembers] = useState<string[]>([]);

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
          banner: false,
        });

        // Bridge bubble events from Phaser scene → React state
        game.events.on("bubble:update", (members: string[]) => {
          setBubbleMembers([...members]);
        });

        if (token) {
          const initData: OfficeSceneInitData = { token };
          game.events.once("ready", () => {
            game?.scene.getScene("OfficeScene")?.scene.restart(initData);
          });
        }

        gameRef.current = game;
      });
    });

    return () => {
      game?.destroy(true);
      gameRef.current = null;
      setBubbleMembers([]);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  return (
    <div className="relative flex flex-col bg-slate-950 rounded-xl overflow-hidden border border-slate-800">
      {/* Controls hint */}
      <div className="absolute top-3 right-3 z-10 flex gap-2 text-[10px] text-slate-500 bg-slate-900/80 rounded px-2 py-1 pointer-events-none">
        <span>WASD / ↑↓←→ to move</span>
        {token && (
          <span className="text-emerald-500/60">• multiplayer</span>
        )}
      </div>

      {/* Proximity bubble overlay */}
      <BubbleOverlay members={bubbleMembers} />

      {/* Phaser canvas mount point */}
      <div
        ref={containerRef}
        style={{ width: GAME_WIDTH, height: GAME_HEIGHT, maxWidth: "100%" }}
        className="mx-auto"
      />
    </div>
  );
}
