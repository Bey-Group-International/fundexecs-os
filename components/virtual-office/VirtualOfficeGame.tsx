"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import type Phaser from "phaser";
import type { OfficeSceneInitData } from "./scenes/OfficeScene";
import type { InteractiveObject, RoomAction, ZoneDef } from "./types";
import { IFRAME_ZONES, ZONE_URL_CALENDLY, CALENDLY_DEFAULT_URL } from "./types";
import { BubbleOverlay } from "./BubbleOverlay";
import { VideoTileBar } from "./VideoTileBar";
import { MediaPermissionBanner } from "./MediaPermissionBanner";

const GAME_WIDTH = 900;
const GAME_HEIGHT = 600;

// Room navigation config — matches ROOMS in types.ts
const ROOM_NAV = [
  { key: "ceo",       label: "CEO Office",      icon: "◆" },
  { key: "boardroom", label: "Boardroom",        icon: "◈" },
  { key: "trading",   label: "Trading Floor",   icon: "▲" },
  { key: "research",  label: "Research Hub",    icon: "◉" },
  { key: "office",    label: "Main Office",     icon: "⬡" },
  { key: "ops",       label: "Operations",      icon: "⚙" },
  { key: "legal",     label: "Legal Corner",    icon: "§" },
  { key: "marketing", label: "Marketing",       icon: "◬" },
  { key: "reception", label: "Reception",       icon: "⬢" },
];

// Emote bar — mirrors keys 1-4 in the scene
const EMOTE_BAR = [
  { emoji: "👋", label: "Wave",      hotkey: "1" },
  { emoji: "👍", label: "Thumbs up", hotkey: "2" },
  { emoji: "❤️", label: "Heart",     hotkey: "3" },
  { emoji: "🎉", label: "Celebrate", hotkey: "4" },
];

/** Replace sentinel URLs in IFRAME_ZONES with runtime values from overrides. */
function _resolveZones(overrides: Record<string, string>) {
  return IFRAME_ZONES.map((z) => {
    if (z.url.startsWith("{{") && z.url.endsWith("}}")) {
      const key = z.url.slice(2, -2);
      const resolved = overrides[key] ?? (key === "calendly" ? CALENDLY_DEFAULT_URL : null);
      if (!resolved) return null; // skip zones with no URL yet
      return { ...z, url: resolved };
    }
    return z;
  }).filter((z): z is NonNullable<typeof z> => z !== null);
}

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
  /**
   * Per-zone URL overrides keyed by zone id or sentinel string.
   * Sentinel values in IFRAME_ZONES (e.g. "{{calendly}}") are replaced with
   * the matching value here before being passed into the Phaser scene.
   */
  zoneUrlOverrides?: Record<string, string>;
};

export function VirtualOfficeGame({
  token,
  displayName = "You",
  characterId,
  active = true,
  teleportTarget,
  onOccupancyChange,
  onNpcClick,
  zoneUrlOverrides = {},
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

  // Keep zone overrides current; re-emit zone config if game is already running
  const zoneUrlOverridesRef = useRef(zoneUrlOverrides);
  useEffect(() => {
    zoneUrlOverridesRef.current = zoneUrlOverrides;
    if (gameRef.current) {
      gameRef.current.events.emit("office:zone-config", _resolveZones(zoneUrlOverrides));
    }
  }, [zoneUrlOverrides]);

  // Buffer teleport targets that arrive before Phaser has loaded
  const pendingTeleportRef = useRef<string | null>(null);

  const [bubbleMembers, setBubbleMembers] = useState<string[]>([]);
  const [videoTiles, setVideoTiles] = useState<VideoTile[]>([]);
  const [localStream, setLocalStream] = useState<MediaStream | null>(null);
  const [mediaState, setMediaState] = useState<"idle" | "prompt" | "active" | "dismissed">("idle");
  const [roomActions, setRoomActions] = useState<RoomAction[]>([]);
  const [activeZone, setActiveZone] = useState<ZoneDef | null>(null);
  const [canvasFocused, setCanvasFocused] = useState(false);
  const [currentRoom, setCurrentRoom] = useState<string>("");

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

        // Room enter bridge — updates room-specific action panel + current room state
        game.events.on("office:room-enter", (key: string, actions: RoomAction[]) => {
          setRoomActions(actions);
          setCurrentRoom(key);
        });

        // Iframe zone bridge
        game.events.on("office:zone-enter", (def: ZoneDef) => setActiveZone(def));
        game.events.on("office:zone-leave", () => setActiveZone(null));

        // Interactive-object bridge — press X on a hotspot triggers its action
        game.events.on("office:interact", (obj: InteractiveObject) => {
          if (obj.href) {
            window.location.href = obj.href;
          } else if (obj.event) {
            window.dispatchEvent(new CustomEvent(obj.event, { detail: {} }));
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
          const initData: OfficeSceneInitData = { token, characterId };
          game.events.once("ready", () => {
            game?.scene.getScene("OfficeScene")?.scene.restart(initData);
          });
        }

        gameRef.current = game;

        // Send resolved zone config to the scene
        game.events.emit("office:zone-config", _resolveZones(zoneUrlOverridesRef.current));

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

  const teleportTo = (roomKey: string) => {
    gameRef.current?.events.emit("office:teleport-room", roomKey);
  };

  return (
    <div className="flex flex-col bg-[#080604] rounded-xl overflow-hidden border border-[#c9a84c22]"
      style={{ boxShadow: "0 0 40px rgba(201,168,76,0.06), inset 0 1px 0 rgba(201,168,76,0.08)" }}>

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

      {/* Iframe zone overlay */}
      {activeZone && (
        <div className="relative flex flex-col border-t border-amber-400/20 bg-[#0a0806]">
          <div className="flex items-center justify-between px-3 py-1.5 bg-[#0f0d0a] border-b border-[#c9a84c22]">
            <span className="text-[11px] font-mono text-[#c9a84c] flex items-center gap-1.5" style={{ letterSpacing: "0.12em" }}>
              <span className="w-1.5 h-1.5 rounded-full bg-[#c9a84c] animate-pulse" />
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
            className="w-full h-48 border-0 bg-[#0a0806]"
            sandbox="allow-scripts allow-same-origin allow-popups"
          />
        </div>
      )}

      {/* ── Navigation bar ── */}
      <div className="flex items-center gap-1 px-3 py-2 border-b border-[#c9a84c18] bg-[#0a0806] overflow-x-auto"
        style={{ scrollbarWidth: "none" }}>
        <span className="text-[9px] text-[#c9a84c55] uppercase tracking-widest mr-2 shrink-0"
          style={{ fontFamily: "Georgia, serif" }}>Rooms</span>
        {ROOM_NAV.map((r) => (
          <button
            key={r.key}
            onClick={() => teleportTo(r.key)}
            className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded text-[10px] transition-all duration-150"
            style={{
              fontFamily: "Georgia, serif",
              letterSpacing: "0.06em",
              color: currentRoom === r.key ? "#c9a84c" : "#94a3b8",
              background: currentRoom === r.key ? "rgba(201,168,76,0.12)" : "transparent",
              border: `1px solid ${currentRoom === r.key ? "rgba(201,168,76,0.35)" : "rgba(255,255,255,0.05)"}`,
            }}
          >
            <span className="opacity-60 text-[8px]">{r.icon}</span>
            {r.label}
          </button>
        ))}
        {/* Emote bar — mirrors keyboard shortcuts 1-4 */}
        <div className="ml-auto flex items-center gap-0.5 shrink-0 pl-2 border-l border-[#c9a84c18]">
          {EMOTE_BAR.map((e) => (
            <button
              key={e.emoji}
              title={`${e.label} (${e.hotkey})`}
              onClick={() => gameRef.current?.events.emit("office:emote", e.emoji)}
              className="px-1.5 py-0.5 rounded text-[13px] hover:bg-[#c9a84c1f] transition-colors"
            >
              {e.emoji}
            </button>
          ))}
        </div>
      </div>

      {/* Game canvas area */}
      <div className="relative">
        {/* Controls hint */}
        <div className="absolute top-2 right-2 z-10 flex items-center gap-2 text-[9px] pointer-events-none"
          style={{ fontFamily: "Georgia, serif", letterSpacing: "0.08em" }}>
          {!canvasFocused && (
            <span className="text-[#c9a84c] bg-[#0a0806cc] border border-[#c9a84c44] rounded px-2 py-1 animate-pulse">
              Click to move
            </span>
          )}
          {canvasFocused && (
            <span className="text-[#c9a84c55] bg-[#0a0806aa] rounded px-2 py-1">
              WASD / ↑↓←→ · click to walk · F follow
            </span>
          )}
          {token && <span className="text-emerald-500/50 bg-[#0a0806aa] rounded px-2 py-1">● live</span>}
        </div>

        {/* Proximity bubble overlay */}
        <BubbleOverlay members={bubbleMembers} />

        {/* Room-specific action panel */}
        {roomActions.length > 0 && (
          <div className="absolute bottom-3 left-3 z-10 flex flex-col gap-1">
            {roomActions.map((action) => (
              <button
                key={action.id}
                onClick={() => handleRoomAction(action)}
                className="flex items-center gap-2 px-3 py-1.5 text-[11px] rounded-lg transition-colors backdrop-blur-sm"
                style={{
                  fontFamily: "Georgia, serif",
                  letterSpacing: "0.06em",
                  color: "#c9a84c",
                  background: "rgba(10,8,6,0.88)",
                  border: "1px solid rgba(201,168,76,0.3)",
                }}
              >
                <span className="opacity-70 font-mono">{action.icon}</span>
                {action.label}
              </button>
            ))}
          </div>
        )}

        {/* Phaser canvas mount point */}
        <div
          ref={containerRef}
          style={{ width: GAME_WIDTH, height: GAME_HEIGHT, maxWidth: "100%" }}
          className="mx-auto cursor-pointer"
          onClick={() => {
            const canvas = containerRef.current?.querySelector("canvas");
            if (canvas) { canvas.focus(); setCanvasFocused(true); }
          }}
          onBlur={() => setCanvasFocused(false)}
          onFocus={() => setCanvasFocused(true)}
        />
      </div>
    </div>
  );
}
