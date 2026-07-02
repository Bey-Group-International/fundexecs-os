"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type Phaser from "phaser";
import type { OfficeSceneInitData } from "./scenes/OfficeScene";
import type { RoomAction, ZoneDef } from "./types";
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

type NpcClickPayload = { npcId: string; spriteKey: string; name: string };

type VirtualOfficeGameProps = {
  /** Supabase JWT — when provided, enables multiplayer mode. */
  token?: string;
  /** Display name of the local user, shown on the self video tile. */
  displayName?: string;
  /** Executive character id from characterConfig (e.g. "earnest-fundmaker"). */
  characterId?: string;
  /**
   * Whether this panel is currently the active/visible tab.
   * Phaser init is deferred until the first time this becomes true,
   * ensuring the canvas is measured against a visible (non-zero) container.
   */
  active?: boolean;
  /** If set, teleports the player to this virtual room key on mount / change. */
  teleportTarget?: string | null;
  /** Called whenever room occupancy counts update. */
  onOccupancyChange?: (counts: Record<string, number>) => void;
  /** Called when the user clicks an NPC sprite. */
  onNpcClick?: (payload: NpcClickPayload) => void;
};

export function VirtualOfficeGame({
  token,
  displayName = "You",
  characterId,
  active = true,
  teleportTarget,
  onOccupancyChange,
  onNpcClick,
}: VirtualOfficeGameProps) {
  const containerRef = useRef<HTMLDivElement>(null);
  const gameRef = useRef<Phaser.Game | null>(null);
  const localStreamRef = useRef<MediaStream | null>(null);
  const hasActivatedRef = useRef(false);

  // Keep callbacks current without re-creating game event listeners
  const onOccupancyChangeRef = useRef(onOccupancyChange);
  useEffect(() => { onOccupancyChangeRef.current = onOccupancyChange; }, [onOccupancyChange]);

  const onNpcClickRef = useRef(onNpcClick);
  useEffect(() => { onNpcClickRef.current = onNpcClick; }, [onNpcClick]);

  // Buffer teleport targets that arrive before Phaser has loaded
  const pendingTeleportRef = useRef<string | null>(null);

  const [bubbleMembers, setBubbleMembers] = useState<string[]>([]);
  const [videoTiles, setVideoTiles] = useState<VideoTile[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaState, setMediaState] = useState<"idle" | "prompt" | "active" | "dismissed">("idle");
  const [roomActions, setRoomActions] = useState<RoomAction[]>([]);
  const [activeZone, setActiveZone] = useState<ZoneDef | null>(null);

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

  // ── Phaser init — deferred until first activation ─────────────────────────
  useEffect(() => {
    if (!active) return;             // don't init while hidden
    if (hasActivatedRef.current) return; // already initialised
    if (typeof window === "undefined" || !containerRef.current) return;

    hasActivatedRef.current = true;
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

        // Room occupancy bridge — reads ref so prop updates are always current
        game.events.on("office:occupancy", (counts: Record<string, number>) => {
          onOccupancyChangeRef.current?.(counts);
        });

        // NPC click bridge — opens Earn AI sidebar scoped to the clicked executive
        game.events.on("npc:click", (payload: NpcClickPayload) => {
          onNpcClickRef.current?.(payload);
        });

        // Room enter bridge — updates room-specific action panel
        game.events.on("office:room-enter", (_key: string, actions: RoomAction[]) => {
          setRoomActions(actions);
        });

        // Iframe zone bridge
        game.events.on("office:zone-enter", (def: ZoneDef) => setActiveZone(def));
        game.events.on("office:zone-leave", () => setActiveZone(null));

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
          const initData: OfficeSceneInitData = { token, characterId };
          game.events.once("ready", () => {
            game?.scene.getScene("OfficeScene")?.scene.restart(initData);
          });
        }

        gameRef.current = game;

        // Flush any teleport that arrived before the game was ready
        if (pendingTeleportRef.current) {
          game.events.emit("office:teleport", pendingTeleportRef.current);
          pendingTeleportRef.current = null;
        }
      });
    });

    return () => {
      game?.destroy(true);
      gameRef.current = null;
      hasActivatedRef.current = false;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalStream(null);
      setBubbleMembers([]);
      setVideoTiles([]);
      setMediaState("idle");
      setRoomActions([]);
      setActiveZone(null);
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);

  // ── Scale refresh on every activation ────────────────────────────────────
  // When the panel transitions from hidden to visible the browser doesn't fire
  // a resize event, so Phaser's Scale Manager never re-measures the container.
  // Call scale.refresh() explicitly whenever the tab becomes active.
  useEffect(() => {
    if (!active || !gameRef.current) return;
    // Small delay ensures the DOM has painted the panel as block before we measure
    const id = setTimeout(() => {
      gameRef.current?.scale.refresh();
    }, 50);
    return () => clearTimeout(id);
  }, [active]);

  // Push local stream into MeshManager when it becomes available
  useEffect(() => {
    if (localStream && gameRef.current) {
      gameRef.current.events.emit("rtc:localStream", localStream);
    }
  }, [localStream]);

  // Teleport when target changes — buffer if game not yet loaded
  useEffect(() => {
    if (!teleportTarget) return;
    if (gameRef.current) {
      gameRef.current.events.emit("office:teleport", teleportTarget);
    } else {
      pendingTeleportRef.current = teleportTarget;
    }
  }, [teleportTarget]);

  const handleRoomAction = useCallback((action: RoomAction) => {
    if (action.href) {
      window.location.href = action.href;
    } else if (action.event) {
      window.dispatchEvent(new CustomEvent(action.event, { detail: {} }));
    }
  }, []);

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

      {/* Iframe zone overlay — slides up when player enters a zone */}
      {activeZone && (
        <div className="relative flex flex-col border-t border-amber-400/20 bg-slate-950">
          <div className="flex items-center justify-between px-3 py-1.5 bg-slate-900 border-b border-slate-800">
            <span className="text-[11px] font-mono text-amber-400 flex items-center gap-1.5">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse" />
              {activeZone.title}
            </span>
            <button
              onClick={() => setActiveZone(null)}
              className="text-slate-500 hover:text-slate-300 text-xs leading-none transition-colors"
              aria-label="Close zone"
            >
              ✕
            </button>
          </div>
          <iframe
            key={activeZone.id}
            src={activeZone.url}
            title={activeZone.title}
            className="w-full h-48 border-0 bg-slate-950"
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        </div>
      )}

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

        {/* Room-specific action panel — bottom-left, fades in on room enter */}
        {roomActions.length > 0 && (
          <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1">
            {roomActions.map((action) => (
              <button
                key={action.id}
                onClick={() => handleRoomAction(action)}
                className="flex items-center gap-2 px-3 py-1.5 text-[11px] font-medium rounded-lg bg-slate-900/90 border border-slate-700/60 text-slate-300 hover:text-amber-400 hover:border-amber-400/40 hover:bg-slate-800/90 transition-colors backdrop-blur-sm"
              >
                <span className="text-amber-400/70 font-mono">{action.icon}</span>
                {action.label}
              </button>
            ))}
          </div>
        )}

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
