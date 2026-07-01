"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type Phaser from "phaser";
import type { OfficeSceneInitData } from "./scenes/OfficeScene";
import { BubbleOverlay } from "./BubbleOverlay";
import { VideoTileBar } from "./VideoTileBar";
import { MediaPermissionBanner } from "./MediaPermissionBanner";

const GAME_WIDTH = 900;
const GAME_HEIGHT = 600;

type VideoTile = {
  peerId: string;
  label: string;
  el: HTMLVideoElement;
};

type VirtualOfficeGameProps = {
  /** Supabase JWT — when provided, enables multiplayer mode. */
  token?: string;
  /** Display name of the local user, shown on the self video tile. */
  displayName?: string;
};

export function VirtualOfficeGame({ token, displayName = "You" }: VirtualOfficeGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);

  const [bubbleMembers, setBubbleMembers] = useState<string[]>([]);
  const [videoTiles, setVideoTiles] = useState<VideoTile[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  // "idle" = not in bubble; "prompt" = in bubble, awaiting; "active" = granted; "dismissed" = skipped
  const [mediaState, setMediaState] = useState<"idle" | "prompt" | "active" | "dismissed">("idle");

  const requestMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setMediaState("active");
      gameRef.current?.events.emit("rtc:localStream", stream);
    } catch {
      setMediaState("dismissed");
    }
  }, []);

  useEffect(() => {
    if (typeof window === "undefined" || !containerRef.current) return;
    if (gameRef.current) return;

    let game: Phaser.Game | null = null;

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

        // Bubble overlay bridge
        game.events.on("bubble:update", (members: string[]) => {
          setBubbleMembers([...members]);
          if (members.length > 0) {
            setMediaState((s) => (s === "idle" ? "prompt" : s));
          } else {
            setMediaState("idle");
          }
        });

        // Video tile bridge
        game.events.on("rtc:video", (peerId: string, el: HTMLVideoElement | null) => {
          setVideoTiles((prev) => {
            if (!el) return prev.filter((t) => t.peerId !== peerId);
            const existing = prev.find((t) => t.peerId === peerId);
            if (existing) return prev.map((t) => (t.peerId === peerId ? { ...t, el } : t));
            return [...prev, { peerId, label: peerId, el }];
          });
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
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalStream(null);
      setBubbleMembers([]);
      setVideoTiles([]);
      setMediaState("idle");
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Push local stream into MeshManager when it becomes available
  useEffect(() => {
    if (localStream && gameRef.current) {
      gameRef.current.events.emit("rtc:localStream", localStream);
    }
  }, [localStream]);

  return (
    <div className="flex flex-col bg-slate-950 rounded-xl overflow-hidden border border-slate-800">
      {/* Media permission banner */}
      {mediaState === "prompt" && (
        <MediaPermissionBanner
          onAllow={requestMedia}
          onDismiss={() => setMediaState("dismissed")}
        />
      )}

      {/* Video tile bar */}
      <VideoTileBar
        tiles={videoTiles}
        localStream={localStream}
        localLabel={displayName}
      />

      {/* Game canvas area */}
      <div className="relative">
        {/* Controls hint */}
        <div className="absolute top-3 right-3 z-10 flex gap-2 text-[10px] text-slate-500 bg-slate-900/80 rounded px-2 py-1 pointer-events-none">
          <span>WASD / ↑↓←→ to move</span>
          {token && <span className="text-emerald-500/60">• multiplayer</span>}
          {mediaState === "active" && <span className="text-blue-400/70">• on call</span>}
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
    </div>
  );
}
