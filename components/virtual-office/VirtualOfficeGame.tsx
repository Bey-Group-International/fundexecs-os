"use client";

import { useEffect, useMemo, useRef, useState, useCallback, type PointerEvent as ReactPointerEvent, type CSSProperties } from "react";
import type Phaser from "phaser";
import type { OfficeSceneInitData } from "./scenes/OfficeScene";
import type { InteractiveObject, RoomAction, ZoneDef } from "./types";
import { IFRAME_ZONES, ZONE_URL_CALENDLY, CALENDLY_DEFAULT_URL } from "./types";
import { BubbleOverlay } from "./BubbleOverlay";
import { VideoTileBar } from "./VideoTileBar";
import { MeetingDock } from "./MeetingDock";
import { MediaPermissionBanner } from "./MediaPermissionBanner";
import { OfficeHUD } from "./program/OfficeHUD";
import { OfficeCommandPanel } from "./program/OfficeCommandPanel";
import { ActiveWorkflowPanel } from "./program/ActiveWorkflowPanel";
import { OfficeAuditDrawer } from "./program/OfficeAuditDrawer";
import { MeetingPresenceGrid } from "./program/MeetingPresenceGrid";
import { sceneBus, shutdownOfficeProgram } from "./program/officeProgramStore";
import { AGENT_BY_ID, type AgentId } from "./program/officeProgram";
import { AgentFloorInspector } from "./program/AgentFloorInspector";
import { RichText } from "@/components/RichText";
import { text, join } from "@/lib/richtext";
import { AGENT_QUIPS } from "./program/agentQuips";
import { FloorRoster, type RosterEntry } from "./FloorRoster";
import { ScreenShareDock } from "./ScreenShareDock";
import { ExecutiveDirectory } from "./ExecutiveDirectory";
import { FloorCommandPalette } from "./FloorCommandPalette";
import { FloorShortcuts } from "./FloorShortcuts";

const GAME_WIDTH = 900;
const GAME_HEIGHT = 600;

/** The executive the player is standing next to (Gather-style proximity). */
type NearbyAgent = { agentId: string; name: string; role: string; line: string; accent: string };

// Proximity presence card: as you walk up to an executive, they greet you with
// their line — built as an Adventure-style rich-text component (name in the
// role accent, the line quoted beneath). Lingering cycles through more of their
// lines, and an inline "Ask" action hands off to the Earn copilot.
function ProximityCard({ agent }: { agent: NearbyAgent }) {
  const heading = useMemo(
    () =>
      join(
        "  ",
        text(agent.name).color(agent.accent).bold(),
        text(agent.role).color("#8a8f98").italic(),
      ),
    [agent.name, agent.role, agent.accent],
  );
  // The idle line, then any role-flavored quips — cycled while you linger.
  const lines = useMemo(
    () => [agent.line, ...(AGENT_QUIPS[agent.agentId as AgentId] ?? [])],
    [agent.agentId, agent.line],
  );
  const [idx, setIdx] = useState(0);
  useEffect(() => {
    setIdx(0);
    if (lines.length <= 1) return;
    const t = setInterval(() => setIdx((i) => (i + 1) % lines.length), 4200);
    return () => clearInterval(t);
  }, [agent.agentId, lines.length]);
  const line = useMemo(
    () => text(`"${lines[idx] ?? agent.line}"`).color("#d8dce3").build(),
    [lines, idx, agent.line],
  );

  const askEarn = () =>
    window.dispatchEvent(
      new CustomEvent("earn:open-with-context", {
        detail: {
          execName: agent.name,
          prompt: `I'm talking to ${agent.name} (${agent.role}) in the virtual office. What can they help me with right now?`,
        },
      }),
    );

  return (
    <div
      className="pointer-events-none absolute bottom-3 left-1/2 z-20 flex -translate-x-1/2 flex-col gap-1 rounded-xl px-4 py-2.5 backdrop-blur-sm"
      style={{
        background: "rgba(10,8,6,0.9)",
        border: `1px solid ${agent.accent}55`,
        boxShadow: `0 0 24px ${agent.accent}22`,
        maxWidth: "min(88%, 420px)",
        fontFamily: "Georgia, 'Times New Roman', serif",
      }}
    >
      <div className="flex items-center gap-2 text-sm">
        <span aria-hidden style={{ color: agent.accent }}>💬</span>
        <RichText component={heading} />
      </div>
      <RichText component={line} className="text-[13px] leading-snug" />
      <button
        type="button"
        onClick={askEarn}
        className="pointer-events-auto mt-1 self-start rounded-md px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] transition-colors"
        style={{ color: agent.accent, border: `1px solid ${agent.accent}55`, background: `${agent.accent}14` }}
      >
        Ask {agent.name}
      </button>
    </div>
  );
}

// Room navigation config — matches ROOMS in types.ts / PROGRAM_ROOMS
const ROOM_NAV = [
  { key: "ceo",       label: "Command Center",    icon: "◆" },
  { key: "boardroom", label: "Boardroom",          icon: "◈" },
  { key: "trading",   label: "Deal Room",         icon: "▲" },
  { key: "research",  label: "Diligence",         icon: "◉" },
  { key: "office",    label: "Underwriting",      icon: "⬡" },
  { key: "ops",       label: "Portfolio Ops",     icon: "⚙" },
  { key: "legal",     label: "Compliance & Legal", icon: "§" },
  { key: "marketing", label: "Treasury",          icon: "◬" },
  { key: "reception", label: "IR Lounge",         icon: "⬢" },
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

/**
 * On-screen 4-way directional pad for touch devices. Emits a normalized
 * movement vector via `onMove(dx, dy)` (each in [-1, 1]); `onMove(0, 0)` on
 * release. Pointer events (not touch/mouse) keep it robust across inputs.
 * Styled to match the dark/gold office UI. Desktop keyboard + click-to-walk
 * are unaffected — this only renders when a touch device is detected.
 */
function TouchDpad({ onMove }: { onMove: (dx: number, dy: number) => void }) {
  const press = useCallback(
    (dx: number, dy: number) => (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      e.currentTarget.setPointerCapture?.(e.pointerId);
      onMove(dx, dy);
    },
    [onMove],
  );
  const release = useCallback(
    (e: ReactPointerEvent<HTMLButtonElement>) => {
      e.preventDefault();
      e.stopPropagation();
      onMove(0, 0);
    },
    [onMove],
  );

  // Reset movement if the pad unmounts mid-press so the avatar never sticks.
  useEffect(() => () => onMove(0, 0), [onMove]);

  const buttonStyle: CSSProperties = {
    display: "flex",
    alignItems: "center",
    justifyContent: "center",
    width: 40,
    height: 40,
    fontSize: 16,
    lineHeight: 1,
    color: "#c9a84c",
    background: "rgba(10,8,6,0.88)",
    border: "1px solid rgba(201,168,76,0.35)",
    borderRadius: 8,
    touchAction: "none",
    userSelect: "none",
    WebkitUserSelect: "none",
    WebkitTapHighlightColor: "transparent",
  };

  const dirs: Array<{ label: string; dx: number; dy: number; col: number; row: number; aria: string }> = [
    { label: "▲", dx: 0, dy: -1, col: 2, row: 1, aria: "Move up" },
    { label: "◀", dx: -1, dy: 0, col: 1, row: 2, aria: "Move left" },
    { label: "▶", dx: 1, dy: 0, col: 3, row: 2, aria: "Move right" },
    { label: "▼", dx: 0, dy: 1, col: 2, row: 3, aria: "Move down" },
  ];

  return (
    <div
      className="absolute z-10"
      style={{
        right: 12,
        bottom: 92,
        display: "grid",
        gridTemplateColumns: "repeat(3, 40px)",
        gridTemplateRows: "repeat(3, 40px)",
        gap: 4,
        touchAction: "none",
      }}
      aria-label="Movement controls"
    >
      {dirs.map((d) => (
        <button
          key={d.aria}
          type="button"
          aria-label={d.aria}
          onPointerDown={press(d.dx, d.dy)}
          onPointerUp={release}
          onPointerCancel={release}
          onPointerLeave={release}
          onContextMenu={(e) => e.preventDefault()}
          style={{ ...buttonStyle, gridColumn: d.col, gridRow: d.row }}
        >
          {d.label}
        </button>
      ))}
    </div>
  );
}

type NpcClickPayload = { npcId: string; spriteKey: string; name: string };

type VirtualOfficeGameProps = {
  /** Supabase JWT — when provided, enables multiplayer mode. */
  token?: string;
  /** Display name of the local user, shown on the self video tile. */
  displayName?: string;
  /** Executive character id from characterConfig (e.g. "earnest-fundmaker"). */
  characterId?: string;
  /** The operator's human Executive Floor avatar (from user_metadata). */
  officeAvatar?: unknown;
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
  officeAvatar,
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
  const [isTouch, setIsTouch] = useState(false);
  // Which executive's on-floor inspector is open (null = none).
  const [inspectAgentId, setInspectAgentId] = useState<AgentId | null>(null);
  const [nearbyAgent, setNearbyAgent] = useState<NearbyAgent | null>(null);
  const [videoProximity, setVideoProximity] = useState<Record<string, number>>({});
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  // In-office meeting: an explicit real-time video session, rendered as a
  // floating dock over the canvas (reuses the floor's WebRTC video).
  const [meetingActive, setMeetingActive] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  const [devices, setDevices] = useState<{ mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] }>({ mics: [], cams: [], speakers: [] });
  const [selectedMic, setSelectedMic] = useState("");
  const [selectedCam, setSelectedCam] = useState("");
  const [selectedSpeaker, setSelectedSpeaker] = useState("");
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);

  // Detect a touch-capable device once on mount (client-only). Desktop keeps
  // keyboard + click-to-walk; touch devices additionally get an on-screen D-pad.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsTouch("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  // Emit the normalized D-pad vector to the Phaser scene's movement handler.
  const emitTouchMove = useCallback((dx: number, dy: number) => {
    gameRef.current?.events.emit("office:touch-move", { dx, dy });
  }, []);

  // Let an on-floor workflow object (a hotspot with event "office:open-directory")
  // open the Executive Directory, same as the nav-bar tool button.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const open = () => setDirectoryOpen(true);
    window.addEventListener("office:open-directory", open);
    return () => window.removeEventListener("office:open-directory", open);
  }, []);

  // ⌘K / Ctrl-K opens the floor command palette from anywhere (document-level,
  // so it works even while the Phaser canvas has keyboard focus).
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key.toLowerCase() === "k") {
        e.preventDefault();
        setPaletteOpen((v) => !v);
        return;
      }
      // "?" opens the controls cheat sheet — but not while typing in a field.
      if (e.key === "?" && !e.metaKey && !e.ctrlKey) {
        const el = document.activeElement;
        const typing = el instanceof HTMLElement && (el.tagName === "INPUT" || el.tagName === "TEXTAREA" || el.isContentEditable);
        if (typing) return;
        e.preventDefault();
        setShortcutsOpen((v) => !v);
      }
    };
    document.addEventListener("keydown", onKey);
    return () => document.removeEventListener("keydown", onKey);
  }, []);

  const requestMedia = useCallback(async () => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: true });
      localStreamRef.current = stream;
      setLocalStream(stream);
      setMediaState("active");
      setMicOn(true);
      setCamOn(true);
      gameRef.current?.events.emit("rtc:localStream", stream);
    } catch {
      setMediaState("dismissed");
    }
  }, []);

  // Start Meeting opens a real-time video session in the office (no navigating
  // away): a floating dock over the canvas, camera on. Reuses the floor RTC.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const open = () => {
      setMeetingActive(true);
      if (!localStreamRef.current) void requestMedia();
    };
    window.addEventListener("office:start-meeting", open);
    return () => window.removeEventListener("office:start-meeting", open);
  }, [requestMedia]);

  const toggleMic = useCallback(() => {
    const track = localStreamRef.current?.getAudioTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setMicOn(track.enabled);
  }, []);

  const toggleCam = useCallback(() => {
    const track = localStreamRef.current?.getVideoTracks()[0];
    if (!track) return;
    track.enabled = !track.enabled;
    setCamOn(track.enabled);
  }, []);

  const endMeeting = useCallback(() => {
    setMeetingActive(false);
    localStreamRef.current?.getTracks().forEach((t) => t.stop());
    localStreamRef.current = null;
    setLocalStream(null);
    setMediaState("idle");
  }, []);

  const refreshDevices = useCallback(async () => {
    try {
      const list = await navigator.mediaDevices.enumerateDevices();
      setDevices({
        mics: list.filter((d) => d.kind === "audioinput" && d.deviceId),
        cams: list.filter((d) => d.kind === "videoinput" && d.deviceId),
        speakers: list.filter((d) => d.kind === "audiooutput" && d.deviceId),
      });
    } catch {
      /* enumeration unavailable */
    }
  }, []);

  // Enumerate input/output devices while a meeting is live (labels are only
  // populated after a getUserMedia grant), and refresh on hot-plug.
  useEffect(() => {
    if (!meetingActive || !localStream) return;
    void refreshDevices();
    const md = navigator.mediaDevices;
    const onChange = () => void refreshDevices();
    md?.addEventListener?.("devicechange", onChange);
    return () => md?.removeEventListener?.("devicechange", onChange);
  }, [meetingActive, localStream, refreshDevices]);

  // Switch the active mic/camera in place — new track replaces the old on the
  // local stream and on every peer (replaceTrack, no renegotiation).
  const selectInputDevice = useCallback(async (kind: "audioinput" | "videoinput", deviceId: string) => {
    const isAudio = kind === "audioinput";
    try {
      const ns = await navigator.mediaDevices.getUserMedia(
        isAudio ? { audio: { deviceId: { exact: deviceId } } } : { video: { deviceId: { exact: deviceId } } },
      );
      const newTrack = isAudio ? ns.getAudioTracks()[0] : ns.getVideoTracks()[0];
      if (!newTrack) return;
      const stream = localStreamRef.current;
      if (stream) {
        const old = isAudio ? stream.getAudioTracks()[0] : stream.getVideoTracks()[0];
        if (old) { stream.removeTrack(old); old.stop(); }
        newTrack.enabled = isAudio ? micOn : camOn;
        stream.addTrack(newTrack);
        setLocalStream(new MediaStream(stream.getTracks()));
      }
      gameRef.current?.events.emit("rtc:replace-track", isAudio ? "audio" : "video", newTrack);
      if (isAudio) setSelectedMic(deviceId); else setSelectedCam(deviceId);
    } catch {
      /* device busy or denied */
    }
  }, [micOn, camOn]);

  const sendFloorInvite = useCallback(async (emails: string[]): Promise<{ ok: boolean; sent: number }> => {
    try {
      const res = await fetch("/api/office/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails }),
      });
      if (!res.ok) return { ok: false, sent: 0 };
      const data = (await res.json()) as { sent: number };
      return { ok: true, sent: data.sent };
    } catch {
      return { ok: false, sent: 0 };
    }
  }, []);

  const stopScreenShare = useCallback(() => {
    // Restore the camera feed to the bubble before dropping the screen track.
    gameRef.current?.events.emit("rtc:screen-share", null);
    screenStreamRef.current?.getTracks().forEach((t) => t.stop());
    screenStreamRef.current = null;
    setScreenStream(null);
  }, []);

  const startScreenShare = useCallback(async () => {
    if (screenStreamRef.current) {
      stopScreenShare();
      return;
    }
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({ video: true });
      screenStreamRef.current = stream;
      setScreenStream(stream);
      // Broadcast the screen to the proximity bubble (swaps the camera feed).
      gameRef.current?.events.emit("rtc:screen-share", stream.getVideoTracks()[0] ?? null);
      // Tear down when the user ends the share from the browser's own UI.
      stream.getVideoTracks()[0]?.addEventListener("ended", stopScreenShare);
    } catch {
      // User cancelled the picker or capture is unavailable — no-op
    }
  }, [stopScreenShare]);

  // ── Phaser init — deferred until first activation ─────────────────────────
  useEffect(() => {
    if (!active) return;             // don't init while hidden
    if (hasActivatedRef.current) return; // already initialised
    if (typeof window === "undefined" || !containerRef.current) return;

    hasActivatedRef.current = true;
    let game: Phaser.Game | null = null;
    let unsubscribeBus: (() => void) | null = null;

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
        // and records a role-specific interaction response in office chat.
        game.events.on("npc:click", (payload: NpcClickPayload) => {
          // Clicking an executive opens the on-floor inspector (what they own,
          // why this agent, and live actions). Ask Earn from inside the panel
          // preserves the copilot hand-off. Non-agent NPCs fall through.
          if (payload.npcId.startsWith("agent:")) {
            setInspectAgentId(payload.npcId.slice("agent:".length) as AgentId);
          } else {
            onNpcClickRef.current?.(payload);
          }
        });

        // Proximity presence bridge — the executive you're standing beside.
        game.events.on("office:nearby-agent", (agent: NearbyAgent | null) => {
          setNearbyAgent(agent);
        });

        // Proximity video bridge — per-peer opacity by avatar distance.
        game.events.on("rtc:video-proximity", (m: Record<string, number>) => {
          setVideoProximity(m);
        });

        // Floor presence roster bridge — who's on the floor + their room.
        game.events.on("office:roster", (r: RosterEntry[]) => {
          setRoster(r);
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
          const initData: OfficeSceneInitData = { token, characterId, officeAvatar };
          game.events.once("ready", () => {
            game?.scene.getScene("OfficeScene")?.scene.restart(initData);
          });
        }

        gameRef.current = game;

        // Office-program bridge: forward store scene-commands (agent moves,
        // state changes, room activity, handoffs) into the Phaser scene.
        unsubscribeBus = sceneBus.on((cmd) => {
          if (!game) return;
          switch (cmd.type) {
            case "npc-goto":
              game.events.emit("program:npc-goto", cmd.agentId, cmd.roomKey);
              break;
            case "npc-state":
              game.events.emit("program:npc-state", cmd.agentId, cmd.state, cmd.label);
              break;
            case "room-activity":
              game.events.emit("program:room-activity", cmd.roomKey, cmd.active, cmd.taskCount, cmd.tier);
              break;
            case "handoff":
              game.events.emit("program:handoff", cmd.toAgentId, cmd.fromAgentId);
              break;
            case "approval-gate":
              game.events.emit("program:approval-gate", cmd.roomKey, cmd.active, cmd.tier, cmd.title);
              break;
          }
        });

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
      unsubscribeBus?.();
      shutdownOfficeProgram();
      game?.destroy(true);
      gameRef.current = null;
      hasActivatedRef.current = false;
      localStreamRef.current?.getTracks().forEach((t) => t.stop());
      localStreamRef.current = null;
      setLocalStream(null);
      screenStreamRef.current?.getTracks().forEach((t) => t.stop());
      screenStreamRef.current = null;
      setScreenStream(null);
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

  // Live-apply character customization to the running floor — when the operator
  // saves a new look, rebuild the figure in place instead of reloading the game.
  useEffect(() => {
    gameRef.current?.events.emit("office:avatar-update", officeAvatar);
  }, [officeAvatar]);

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
    <div className="flex flex-col gap-3">
      {/* Institutional HUD — mode, workflow, stage, approvals, audit status */}
      <OfficeHUD currentRoom={currentRoom} />

      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        {/* ── Execution floor column ── */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          {/* Live agent presence for the active work session (real runtime
              status; human peer video is the VideoTileBar below). */}
          <MeetingPresenceGrid />

          <div className="flex flex-col bg-[#080604] rounded-xl overflow-hidden border border-[#c9a84c22]"
            style={{ boxShadow: "0 0 40px rgba(201,168,76,0.06), inset 0 1px 0 rgba(201,168,76,0.08)" }}>

      {/* Media permission banner */}
      {mediaState === "prompt" && (
        <MediaPermissionBanner
          onAllow={requestMedia}
          onDismiss={() => setMediaState("dismissed")}
        />
      )}

      {/* Ambient proximity video strip — hidden while an explicit in-office
          meeting is running (the floating MeetingDock takes over the video). */}
      {!meetingActive && (
        <VideoTileBar
          tiles={videoTiles}
          localStream={localStream}
          localLabel={displayName}
          proximity={videoProximity}
        />
      )}

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
        {/* Command palette — keyboard-first launcher (⌘K) for floor actions */}
        <button
          type="button"
          onClick={() => setPaletteOpen(true)}
          title="Floor actions (⌘K)"
          className="ml-auto shrink-0 flex items-center gap-1 px-2.5 py-1 rounded text-[10px] transition-all duration-150"
          style={{
            fontFamily: "Georgia, serif",
            letterSpacing: "0.06em",
            color: "#94a3b8",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <span className="opacity-60 text-[8px]">⌘K</span>
          Actions
        </button>
        {/* Executive Directory — an in-floor tool to jump to any executive */}
        <button
          type="button"
          onClick={() => setDirectoryOpen(true)}
          title="Open the executive directory"
          className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded text-[10px] transition-all duration-150"
          style={{
            fontFamily: "Georgia, serif",
            letterSpacing: "0.06em",
            color: "#94a3b8",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <span className="opacity-60 text-[8px]">☰</span>
          Directory
        </button>
        {/* Share workspace — captures the screen into a floating PiP dock */}
        <button
          type="button"
          onClick={startScreenShare}
          title={screenStream ? "Stop sharing your workspace" : "Share your workspace"}
          className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded text-[10px] transition-all duration-150"
          style={{
            fontFamily: "Georgia, serif",
            letterSpacing: "0.06em",
            color: screenStream ? "#c9a84c" : "#94a3b8",
            background: screenStream ? "rgba(201,168,76,0.12)" : "transparent",
            border: `1px solid ${screenStream ? "rgba(201,168,76,0.35)" : "rgba(255,255,255,0.05)"}`,
          }}
        >
          <span className="opacity-60 text-[8px]">▣</span>
          {screenStream ? "Sharing" : "Share screen"}
        </button>
        {/* Emote bar — mirrors keyboard shortcuts 1-4 */}
        <div className="flex items-center gap-0.5 shrink-0 pl-2 border-l border-[#c9a84c18]">
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
        {/* Live "who's on the floor" roster + invite */}
        {token && roster.length > 0 && <FloorRoster roster={roster} />}

        {/* Proximity presence — the executive you're standing beside greets you */}
        {nearbyAgent && <ProximityCard agent={nearbyAgent} />}

        {/* In-office meeting — floating real-time video dock over the canvas */}
        {meetingActive && (
          <MeetingDock
            localStream={localStream}
            tiles={videoTiles}
            localLabel={displayName}
            micOn={micOn}
            camOn={camOn}
            onToggleMic={toggleMic}
            onToggleCam={toggleCam}
            onEnd={endMeeting}
            inviteUrl={typeof window !== "undefined" ? window.location.href : ""}
            devices={devices}
            selectedMic={selectedMic}
            selectedCam={selectedCam}
            selectedSpeaker={selectedSpeaker}
            onSelectMic={(id) => selectInputDevice("audioinput", id)}
            onSelectCam={(id) => selectInputDevice("videoinput", id)}
            onSelectSpeaker={setSelectedSpeaker}
            onSendInvites={sendFloorInvite}
          />
        )}

        {/* Workspace share — floating PiP dock for the screen you're sharing */}
        {screenStream && <ScreenShareDock stream={screenStream} onStop={stopScreenShare} />}

        {/* Executive Directory — jump to any executive's room */}
        {directoryOpen && (
          <ExecutiveDirectory
            onTeleport={(roomKey) => {
              teleportTo(roomKey);
              setDirectoryOpen(false);
            }}
            onClose={() => setDirectoryOpen(false)}
          />
        )}

        {/* Command palette — ⌘K launcher for rooms, meetings, and tools */}
        {paletteOpen && (
          <FloorCommandPalette
            onRoom={(roomKey) => teleportTo(roomKey)}
            onClose={() => setPaletteOpen(false)}
          />
        )}

        {/* Controls cheat sheet — "?" */}
        {shortcutsOpen && <FloorShortcuts onClose={() => setShortcutsOpen(false)} />}

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
          <button
            type="button"
            onClick={() => setShortcutsOpen(true)}
            title="Floor controls (?)"
            aria-label="Show floor controls"
            className="pointer-events-auto grid h-[22px] w-[22px] place-items-center rounded-full text-[10px] transition-colors"
            style={{ color: "#c9a84c", background: "#0a0806aa", border: "1px solid rgba(201,168,76,0.44)" }}
          >
            ?
          </button>
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

        {/* Touch D-pad — mobile only; positioned above the in-canvas minimap */}
        {isTouch && <TouchDpad onMove={emitTouchMove} />}

        {/* On-floor agent inspector — opens when an executive is clicked */}
        {inspectAgentId && (
          <AgentFloorInspector
            agentId={inspectAgentId}
            onAskEarn={() => {
              const m = AGENT_BY_ID[inspectAgentId];
              onNpcClickRef.current?.({ npcId: `agent:${inspectAgentId}`, spriteKey: m.spriteKey, name: m.name });
            }}
            onClose={() => setInspectAgentId(null)}
          />
        )}
      </div>
          </div>

          {/* Audit-ready activity log */}
          <OfficeAuditDrawer />
        </div>

        {/* ── Command & work-visibility column ── */}
        <div className="flex w-full flex-col gap-3 xl:w-[340px] xl:shrink-0">
          <div className="flex h-[430px] flex-col">
            <OfficeCommandPanel />
          </div>
          <ActiveWorkflowPanel />
        </div>
      </div>
    </div>
  );
}
