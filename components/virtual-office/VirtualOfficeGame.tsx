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
import { MarketplacePanel, type PublicListing } from "./program/MarketplacePanel";
import { MarketplaceListingDetail } from "./program/MarketplaceListingDetail";
import { MarketplaceCreateListing } from "./program/MarketplaceCreateListing";
import { AgentDelegateComposer } from "./program/AgentDelegateComposer";
import { DealRoomBanner } from "./program/DealRoomBanner";
import { BackgroundProcessor, backgroundBlurSupported } from "@/lib/office/backgroundEffect";
import { FloorActivityFeed } from "./program/FloorActivityFeed";
import { emitFloorActivity, FLOOR_ACTIVITY_EVENT, type FloorEvent, type FloorActivityKind } from "@/lib/office/floor-activity";
import { MeetingPresenceGrid } from "./program/MeetingPresenceGrid";
import { sceneBus, shutdownOfficeProgram, getOfficeProgramState } from "./program/officeProgramStore";
import { AGENT_BY_ID, type AgentId } from "./program/officeProgram";
import { AgentFloorInspector } from "./program/AgentFloorInspector";
import { RichText } from "@/components/RichText";
import { text, join } from "@/lib/richtext";
import { AGENT_QUIPS } from "./program/agentQuips";
import { FloorInviteButton } from "./FloorInviteButton";
import { OfficeAvatarChip } from "./avatar/OfficeAvatarChip";
import type { UserAvatar } from "@/lib/office/userAvatar";
import { ScreenShareDock } from "./ScreenShareDock";
import { ExecutiveDirectory } from "./ExecutiveDirectory";
import { FloorCommandPalette } from "./FloorCommandPalette";
import { FloorShortcuts } from "./FloorShortcuts";
import { AreaMapEditor } from "./program/AreaMapEditor";
import { officeInviteUrl } from "@/lib/office/floor-link";
import { createClient } from "@/lib/supabase/client";

/** A teammate present on the floor (from the scene's presence bridge). */
export type RosterEntry = {
  id: string;
  name: string;
  roomKey: string | null;
  self: boolean;
  onCall: boolean;
};

const GAME_WIDTH = 900;
const GAME_HEIGHT = 600;

/** The executive the player is standing next to (Gather-style proximity). */
type NearbyAgent = { agentId: string; name: string; role: string; line: string; accent: string };

// Proximity presence card: as you walk up to an executive, they greet you with
// their line — built as an Adventure-style rich-text component (name in the
// role accent, the line quoted beneath). Lingering cycles through more of their
// lines, and an inline "Ask" action hands off to the Earn copilot.
function ProximityCard({ agent, onDelegate }: { agent: NearbyAgent; onDelegate: () => void }) {
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
      <div className="pointer-events-auto mt-1 flex items-center gap-1.5">
        <button
          type="button"
          onClick={askEarn}
          className="rounded-md px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] transition-colors"
          style={{ color: agent.accent, border: `1px solid ${agent.accent}55`, background: `${agent.accent}14` }}
        >
          Ask {agent.name}
        </button>
        <button
          type="button"
          onClick={onDelegate}
          className="rounded-md px-2 py-0.5 text-[11px] uppercase tracking-[0.08em] font-semibold transition-colors"
          style={{ color: "#0a0806", background: agent.accent }}
        >
          Give a task →
        </button>
      </div>
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
  { key: "marketplace", label: "Marketplace",     icon: "◈" },
];

/**
 * Maps a copilot agent key (from lib/agents — what Earn's planner assigns) to
 * the office floor's executive id, so real routed work lights up the right
 * executive. Sprite-consistent where the office reused a copilot sprite; by
 * function otherwise. Anything unmapped falls back to Earn (the coordinator).
 */
const KEY_TO_OFFICE: Record<string, AgentId> = {
  analyst: "analyst",
  associate: "earn",
  investor_relations: "investor_relations",
  portfolio_ops: "portfolio_ops",
  diligence: "risk",
  fund_admin: "ops_admin",
  executive_advisor: "principal",
  capital_raiser: "analyst",
  capital_connector: "treasury",
  deal_sourcer: "associate",
  rainmaker: "business_dev",
  lead_generator: "business_dev",
  pr_director: "investor_relations",
  seo_disruptor: "business_dev",
  curator: "ops_admin",
};

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
  officeAvatar?: UserAvatar;
  /** Called when the operator saves a new character from the top-rail chip. */
  onAvatarSaved?: (a: UserAvatar) => void;
  /**
   * Whether this panel is currently the active/visible tab.
   * Phaser init is deferred until the first time this becomes true,
   * ensuring the canvas is measured against a visible (non-zero) container.
   */
  active?: boolean;
  /** If set, teleports the player to this virtual room key on mount / change. */
  teleportTarget?: string | null;
  /**
   * Marketplace listing id to convene a deal room around (from a `?deal=` invite
   * link). Shows the deal-room context banner once the operator is in the Deal
   * Room, so a counterparty who opens the link sees the same convening.
   */
  dealRoomListingId?: string | null;
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
  onAvatarSaved,
  active = true,
  teleportTarget,
  dealRoomListingId = null,
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
  // On desktop, cap the floor's height to the space left in the viewport so the
  // whole office fits without vertical scrolling (Phaser FIT scales the 3:2 game
  // down into it). null = uncapped (mobile keeps its scrollable stack).
  const [canvasCap, setCanvasCap] = useState<number | null>(null);
  const [currentRoom, setCurrentRoom] = useState<string>("");
  // Public marketplace listings — fetched once the operator first steps into the
  // Marketplace hall; shared by the in-world stall signboards and the panel.
  const [marketplaceListings, setMarketplaceListings] = useState<PublicListing[] | null>(null);
  const marketplaceFetchedRef = useRef(false);
  // Which listing's in-world detail overlay is open (null = none).
  const [activeListingId, setActiveListingId] = useState<string | null>(null);
  // Whether the in-world "list something" create overlay is open.
  const [showCreateListing, setShowCreateListing] = useState(false);
  // The marketplace listing convened as a deal room (null = none). Seeded from
  // the dealRoomListingId prop (arriving via a ?deal= link) and set locally when
  // the operator opens a deal room from a listing.
  const [dealListingId, setDealListingId] = useState<string | null>(dealRoomListingId);
  useEffect(() => {
    if (dealRoomListingId) setDealListingId(dealRoomListingId);
  }, [dealRoomListingId]);
  const [isTouch, setIsTouch] = useState(false);
  // Which executive's on-floor inspector is open (null = none).
  const [inspectAgentId, setInspectAgentId] = useState<AgentId | null>(null);
  const [nearbyAgent, setNearbyAgent] = useState<NearbyAgent | null>(null);
  // The executive the operator is composing a delegated task for (null = none).
  const [delegateAgent, setDelegateAgent] = useState<NearbyAgent | null>(null);
  const [videoProximity, setVideoProximity] = useState<Record<string, number>>({});
  const [roster, setRoster] = useState<RosterEntry[]>([]);
  // Rolling in-world activity feed — real floor moments announced via
  // emitFloorActivity (Earn routing work, meetings, deal rooms, listings, joins).
  const [floorActivity, setFloorActivity] = useState<FloorEvent[]>([]);
  const floorActivityIdRef = useRef(0);
  // Previous roster ids, to announce joins to the feed. null until the first
  // snapshot, so the initial population doesn't spam "joined" for everyone.
  const prevRosterIdsRef = useRef<Set<string> | null>(null);
  // Side-panel visibility (Earn Command Center + Active Work). Persisted so the
  // operator's choice sticks; when both are hidden the side column is removed
  // and the floor widens to fill the reclaimed space.
  const readPanel = (key: string) => {
    if (typeof window === "undefined") return true;
    try { return window.localStorage.getItem(key) !== "0"; } catch { return true; }
  };
  const [showCommandPanel, setShowCommandPanel] = useState(() => readPanel("office:panel:earn"));
  const [showActiveWork, setShowActiveWork] = useState(() => readPanel("office:panel:work"));
  useEffect(() => { try { window.localStorage.setItem("office:panel:earn", showCommandPanel ? "1" : "0"); } catch { /* no-op */ } }, [showCommandPanel]);
  useEffect(() => { try { window.localStorage.setItem("office:panel:work", showActiveWork ? "1" : "0"); } catch { /* no-op */ } }, [showActiveWork]);
  // WorkAdventure-style companion (Earn-coin sidekick) + "Say" bubble. The
  // companion preference persists; the scene spawns it from initData and this
  // effect re-emits on toggle. "Say" opens a one-line input in the rail.
  const readCompanion = () => {
    if (typeof window === "undefined") return false;
    try { return window.localStorage.getItem("office:companion") === "1"; } catch { return false; }
  };
  const [companionOn, setCompanionOn] = useState(readCompanion);
  useEffect(() => {
    try { window.localStorage.setItem("office:companion", companionOn ? "1" : "0"); } catch { /* no-op */ }
    gameRef.current?.events.emit("office:companion", companionOn);
  }, [companionOn]);
  const [sayOpen, setSayOpen] = useState(false);
  const [sayValue, setSayValue] = useState("");
  const submitSay = useCallback(() => {
    const text = sayValue.trim();
    if (text) gameRef.current?.events.emit("office:say", text);
    setSayValue("");
    setSayOpen(false);
  }, [sayValue]);
  // In-office meeting: an explicit real-time video session, rendered as a
  // floating dock over the canvas (reuses the floor's WebRTC video).
  const [meetingActive, setMeetingActive] = useState(false);
  const [micOn, setMicOn] = useState(true);
  const [camOn, setCamOn] = useState(true);
  // Virtual background (on-device segmentation blur) for meeting video. The
  // processor owns the raw camera track while active; refs hold both so the
  // effect can be torn down and the raw track restored to peers.
  const [bgBlur, setBgBlur] = useState(false);
  const [bgBusy, setBgBusy] = useState(false);
  const [bgSupported, setBgSupported] = useState(false);
  const bgProcessorRef = useRef<BackgroundProcessor | null>(null);
  const rawVideoTrackRef = useRef<MediaStreamTrack | null>(null);
  useEffect(() => setBgSupported(backgroundBlurSupported()), []);
  const [devices, setDevices] = useState<{ mics: MediaDeviceInfo[]; cams: MediaDeviceInfo[]; speakers: MediaDeviceInfo[] }>({ mics: [], cams: [], speakers: [] });
  const [selectedMic, setSelectedMic] = useState("");
  const [selectedCam, setSelectedCam] = useState("");
  const [selectedSpeaker, setSelectedSpeaker] = useState("");
  const [screenStream, setScreenStream] = useState<MediaStream | null>(null);
  const screenStreamRef = useRef<MediaStream | null>(null);
  const [directoryOpen, setDirectoryOpen] = useState(false);
  const [paletteOpen, setPaletteOpen] = useState(false);
  const [shortcutsOpen, setShortcutsOpen] = useState(false);
  const [roomMenuOpen, setRoomMenuOpen] = useState(false);
  // WorkAdventure-style scripted-area map editor (persists to localStorage; the
  // scene reacts to the store's change event and re-renders areas live).
  const [mapEditorOpen, setMapEditorOpen] = useState(false);

  // Detect a touch-capable device once on mount (client-only). Desktop keeps
  // keyboard + click-to-walk; touch devices additionally get an on-screen D-pad.
  useEffect(() => {
    if (typeof window === "undefined") return;
    setIsTouch("ontouchstart" in window || navigator.maxTouchPoints > 0);
  }, []);

  // Fit-to-viewport: on desktop, size the floor to the height left below it so
  // the whole office is visible without scrolling. Re-measures on resize and
  // whenever the chrome above the canvas changes height (media banner, the
  // ambient video strip when a meeting starts, tab activation). Below the
  // desktop breakpoint we leave the canvas uncapped so mobile keeps its stack.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const DESKTOP_MIN = 1024;
    const RESERVE = 40; // small breathing room below the floor (audit bar is gone)
    const measure = () => {
      const el = containerRef.current;
      if (!el) return;
      if (window.innerWidth < DESKTOP_MIN) {
        setCanvasCap(null);
        return;
      }
      const top = el.getBoundingClientRect().top;
      const avail = window.innerHeight - top - RESERVE;
      // Fill the viewport height that's left below the floor. RESIZE lets the
      // office grow into it (taller floor, more world visible) rather than
      // scaling a fixed frame — so allow a generous ceiling, not the old 3:2 cap.
      setCanvasCap(Math.max(360, Math.min(1000, Math.round(avail))));
    };
    const raf = requestAnimationFrame(measure);
    window.addEventListener("resize", measure);
    return () => {
      cancelAnimationFrame(raf);
      window.removeEventListener("resize", measure);
    };
    // `token` is included because token-driven chrome (the avatar chip) changes
    // the header height after it resolves, shifting the canvas top.
  }, [active, meetingActive, mediaState, token]);

  // After a canvasCap change resizes the container via CSS (no window resize
  // fires), tell Phaser's FIT scale manager to re-measure so the canvas tracks
  // the new box immediately — matching how panel toggles / tab activation refresh.
  useEffect(() => {
    if (canvasCap == null || !gameRef.current) return;
    const id = setTimeout(() => gameRef.current?.scale.refresh(), 60);
    return () => clearTimeout(id);
  }, [canvasCap]);

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
      setMeetingActive((wasActive) => {
        if (!wasActive) emitFloorActivity("meeting", "A meeting started on the floor");
        return true;
      });
      if (!localStreamRef.current) void requestMedia();
    };
    window.addEventListener("office:start-meeting", open);
    return () => window.removeEventListener("office:start-meeting", open);
  }, [requestMedia]);

  // Living executives — reflect REAL Earn activity on the floor. When Earn routes
  // work (from the floor's "Give a task", or the app-wide dock), it announces the
  // assigned agents via earn:exec-activity. We light up exactly those executives:
  // they stand, take on the plan as their status line, and their room glows,
  // reverting once the activity settles. This is a pure visual reflection through
  // the existing program bridge — it never touches the store's workflow state, and
  // it stands down whenever the in-scene program engine is running its own
  // choreography, so the two never fight over the same avatars.
  const execReflectRef = useRef<{ agents: Set<AgentId>; timer: ReturnType<typeof setTimeout> | null }>({
    agents: new Set(),
    timer: null,
  });
  useEffect(() => {
    if (typeof window === "undefined") return;
    const ref = execReflectRef.current; // stable container from useRef
    const revert = () => {
      const game = gameRef.current;
      if (game && !getOfficeProgramState().activeWorkflow) {
        for (const id of ref.agents) {
          game.events.emit("program:npc-state", id, "idle", AGENT_BY_ID[id]?.role ?? "");
          const home = AGENT_BY_ID[id]?.homeRoom;
          if (home) game.events.emit("program:room-activity", home, false, 0, null);
        }
      }
      ref.agents.clear();
      ref.timer = null;
    };
    const onExecActivity = (e: Event) => {
      const detail = (e as CustomEvent<{ agentKeys?: string[]; planTitle?: string }>).detail;
      const game = gameRef.current;
      if (!game) return;

      const ids = Array.from(
        new Set((detail?.agentKeys ?? []).map((k) => KEY_TO_OFFICE[k] ?? "earn")),
      ).slice(0, 4);
      if (ids.length === 0) ids.push("earn");
      const raw = (detail?.planTitle ?? "On a task").trim();
      const label = raw.length > 32 ? `${raw.slice(0, 31)}…` : raw;

      // Log to the activity feed even if the visual reflection is skipped below.
      emitFloorActivity("work", `Earn routed “${label}” to ${ids.length} exec${ids.length === 1 ? "" : "s"}`);

      // Don't fight the in-scene program engine's own live choreography.
      const st = getOfficeProgramState();
      if (st.activeWorkflow || st.officeStatus !== "calm") return;

      if (ref.timer) clearTimeout(ref.timer);
      for (const id of ids) {
        ref.agents.add(id);
        const home = AGENT_BY_ID[id]?.homeRoom;
        game.events.emit("program:npc-state", id, "working", label);
        if (home) {
          game.events.emit("program:npc-goto", id, home);
          game.events.emit("program:room-activity", home, true, 1, null);
        }
      }
      ref.timer = setTimeout(revert, 15000);
    };
    window.addEventListener("earn:exec-activity", onExecActivity);
    return () => {
      window.removeEventListener("earn:exec-activity", onExecActivity);
      if (ref.timer) clearTimeout(ref.timer);
    };
  }, []);

  // Collect floor-activity announcements into the rolling feed (newest first,
  // capped). Every notable floor moment posts here via emitFloorActivity.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onActivity = (e: Event) => {
      const detail = (e as CustomEvent<{ kind?: FloorActivityKind; text?: string }>).detail;
      if (!detail?.kind || !detail?.text) return;
      floorActivityIdRef.current += 1;
      const entry: FloorEvent = {
        id: `fa-${floorActivityIdRef.current}`,
        ts: Date.now(),
        kind: detail.kind,
        text: detail.text,
      };
      setFloorActivity((prev) => {
        // Collapse rapid duplicates (e.g. a meeting re-announced within seconds)
        // so the ticker shows distinct moments, not a stutter of the same line.
        const top = prev[0];
        if (top && top.kind === entry.kind && top.text === entry.text && entry.ts - top.ts < 8000) {
          return prev;
        }
        return [entry, ...prev].slice(0, 20);
      });
    };
    window.addEventListener(FLOOR_ACTIVITY_EVENT, onActivity);
    return () => window.removeEventListener(FLOOR_ACTIVITY_EVENT, onActivity);
  }, []);

  // Pull live public listings and push them to both the scene (live stall
  // signboards) and the panel. Reused on first entry to the hall and again after
  // the operator publishes a new listing in-world.
  const refreshMarketplaceListings = useCallback(async () => {
    const supabase = createClient();
    const { data } = await supabase
      .from("marketplace_listings")
      .select("id, title, listing_type, summary, amount, status")
      .eq("is_public", true)
      .order("created_at", { ascending: false })
      .limit(12);
    const listings = (data as PublicListing[] | null) ?? [];
    setMarketplaceListings(listings);
    gameRef.current?.events.emit("office:marketplace-listings", listings);
  }, []);

  // Fetch public listings the first time the operator enters the Marketplace
  // hall, then push them to the scene (live stall signboards) and the panel.
  useEffect(() => {
    if (currentRoom !== "marketplace" || marketplaceFetchedRef.current) return;
    marketplaceFetchedRef.current = true;
    void refreshMarketplaceListings();
  }, [currentRoom, refreshMarketplaceListings]);

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

  // Turn virtual background off: restore the raw camera track to the local
  // stream and every peer, then dispose the processor. Safe to call when off.
  const disableBgBlur = useCallback(() => {
    const proc = bgProcessorRef.current;
    const raw = rawVideoTrackRef.current;
    const stream = localStreamRef.current;
    if (stream && raw) {
      const processed = stream.getVideoTracks()[0];
      if (processed) stream.removeTrack(processed);
      raw.enabled = camOn;
      stream.addTrack(raw);
      setLocalStream(new MediaStream(stream.getTracks()));
      gameRef.current?.events.emit("rtc:replace-track", "video", raw);
    }
    proc?.stop(); // stops the processed track + model; leaves the raw track live
    bgProcessorRef.current = null;
    rawVideoTrackRef.current = null;
    setBgBlur(false);
  }, [camOn]);

  // Toggle on-device background blur. Enabling processes the live camera track
  // and swaps the blurred output in for the local tile and every peer; any
  // failure tears down and falls back to the raw camera so the call is never lost.
  const toggleBackgroundBlur = useCallback(async () => {
    const stream = localStreamRef.current;
    if (!stream || bgBusy) return;
    if (bgBlur) {
      disableBgBlur();
      return;
    }
    const raw = stream.getVideoTracks()[0];
    if (!raw) return;
    setBgBusy(true);
    try {
      const proc = new BackgroundProcessor();
      const processed = await proc.start(raw);
      processed.enabled = camOn;
      bgProcessorRef.current = proc;
      rawVideoTrackRef.current = raw;
      stream.removeTrack(raw); // keep raw alive — the processor feeds on it
      stream.addTrack(processed);
      setLocalStream(new MediaStream(stream.getTracks()));
      gameRef.current?.events.emit("rtc:replace-track", "video", processed);
      setBgBlur(true);
    } catch {
      bgProcessorRef.current?.stop();
      bgProcessorRef.current = null;
      rawVideoTrackRef.current = null;
      setBgBlur(false);
    } finally {
      setBgBusy(false);
    }
  }, [bgBlur, bgBusy, camOn, disableBgBlur]);

  const endMeeting = useCallback(() => {
    setMeetingActive(false);
    // Dispose the blur pipeline and its raw camera track (which lives outside
    // localStreamRef while blur is active) before stopping the rest.
    bgProcessorRef.current?.stop();
    bgProcessorRef.current = null;
    rawVideoTrackRef.current?.stop();
    rawVideoTrackRef.current = null;
    setBgBlur(false);
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
    // Switching cameras changes the track the blur pipeline feeds on — turn the
    // effect off first (restoring the raw track) so the swap stays consistent.
    if (!isAudio && bgProcessorRef.current) disableBgBlur();
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
  }, [micOn, camOn, disableBgBlur]);

  // Meeting invites carry the host's current room + meet=1, so the recipient
  // lands in the same room and the video dock auto-opens (they join the call).
  const sendFloorInvite = useCallback(async (emails: string[]): Promise<{ ok: boolean; sent: number }> => {
    try {
      const res = await fetch("/api/office/invite", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ emails, room: currentRoom || null, meet: true }),
      });
      if (!res.ok) return { ok: false, sent: 0 };
      const data = (await res.json()) as { sent: number };
      return { ok: true, sent: data.sent };
    } catch {
      return { ok: false, sent: 0 };
    }
  }, [currentRoom]);

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
            // RESIZE (not FIT): the canvas tracks the parent box 1:1 and the
            // camera shows more of the world as the box widens/heightens, so the
            // office fills the space instead of scaling a fixed 3:2 frame with
            // side margins. The scene reflows its fixed HUD on the resize event.
            mode: PhaserLib.Scale.RESIZE,
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

        // Scripted area entered — map the declarative trigger to a concrete
        // action (WorkAdventure-style walk-in zones). Kept in one place so the
        // scene stays trigger-agnostic and a future map editor just adds data.
        game.events.on(
          "office:area-enter",
          (payload: { id: string; label: string; trigger: { kind: string; text?: string } }) => {
            const t = payload.trigger;
            if (t.kind === "say" && t.text) gameRef.current?.events.emit("office:say", t.text);
            else if (t.kind === "toast" && t.text) emitFloorActivity("presence", t.text);
            else if (t.kind === "start-meeting") window.dispatchEvent(new CustomEvent("office:start-meeting"));
            else if (t.kind === "broadcast" && t.text) {
              // All-hands: announce floor-wide (feed everyone sees) and pop a
              // Say bubble over the operator who convened it.
              emitFloorActivity("meeting", t.text);
              gameRef.current?.events.emit("office:say", t.text);
            }
          },
        );

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
          // Announce anyone who just appeared (skip yourself and the first snapshot).
          const prev = prevRosterIdsRef.current;
          if (prev) {
            for (const entry of r) {
              if (!entry.self && !prev.has(entry.id)) {
                emitFloorActivity("presence", `${entry.name} joined the floor`);
              }
            }
          }
          prevRosterIdsRef.current = new Set(r.map((e) => e.id));
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
          if (obj.id.startsWith("mkt-")) {
            // Market stall — open the listing detail in-world (no navigation).
            setActiveListingId(obj.id.slice("mkt-".length));
          } else if (obj.href) {
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
          const initData: OfficeSceneInitData = { token, characterId, officeAvatar, companion: readCompanion() };
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

  // Hiding/showing the side panels resizes the floor column without a window
  // resize event, so re-measure Phaser's canvas to fill the new width.
  useEffect(() => {
    if (!gameRef.current) return;
    const id = setTimeout(() => gameRef.current?.scale.refresh(), 60);
    return () => clearTimeout(id);
  }, [showCommandPanel, showActiveWork]);

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
      <div className="flex flex-col gap-3 xl:flex-row xl:items-start">
        {/* ── Execution floor column ── */}
        <div className="flex min-w-0 flex-1 flex-col gap-3">
          <div className="flex flex-col bg-[#080604] rounded-xl overflow-hidden border border-[#c9a84c22]"
            style={{ boxShadow: "0 0 40px rgba(201,168,76,0.06), inset 0 1px 0 rgba(201,168,76,0.08)" }}>

      {/* Unified status strip — the office's single status bar, first row of the
          card so the whole control surface (status → rails → floor) reads as one. */}
      <OfficeHUD currentRoom={currentRoom} presenceCount={token ? Math.max(roster.length, 1) : undefined} />

      {/* Live agent presence for the active work session — a flush band inside
          the card (real runtime status; human peer video is the VideoTileBar
          below). Kept in the card so it never floats as a detached strip that
          separates the top nav from the office. Renders only during a session. */}
      <MeetingPresenceGrid />

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

      {/* ── Navigation bar ── (wraps rather than scroll-clipping, so the room
          dropdown can overlay the floor below it) */}
      <div className="relative z-10 flex flex-wrap items-center gap-1 px-3 py-2 border-b border-[#c9a84c18] bg-[#0a0806]">
        <span className="text-[9px] text-[#c9a84c55] uppercase tracking-widest mr-2 shrink-0"
          style={{ fontFamily: "Georgia, serif" }}>Rooms</span>
        {/* Room selector — a compact dropdown so every room is one click away,
            rather than a wide tab strip that overflows and hides rooms. */}
        {(() => {
          const active = ROOM_NAV.find((r) => r.key === currentRoom);
          return (
            <div className="relative shrink-0">
              <button
                type="button"
                onClick={() => setRoomMenuOpen((v) => !v)}
                aria-haspopup="menu"
                aria-expanded={roomMenuOpen}
                title="Jump to a room"
                className="flex items-center gap-1.5 rounded px-2.5 py-1 text-[10px] transition-all duration-150"
                style={{
                  fontFamily: "Georgia, serif",
                  letterSpacing: "0.06em",
                  color: "#c9a84c",
                  background: "rgba(201,168,76,0.12)",
                  border: "1px solid rgba(201,168,76,0.35)",
                }}
              >
                <span className="opacity-60 text-[8px]">{active?.icon ?? "◇"}</span>
                {active?.label ?? "Select room"}
                <span className="opacity-70 text-[8px]">{roomMenuOpen ? "▴" : "▾"}</span>
              </button>
              {roomMenuOpen && (
                <>
                  {/* click-away backdrop */}
                  <div className="fixed inset-0 z-30" onClick={() => setRoomMenuOpen(false)} />
                  <div
                    role="menu"
                    className="absolute left-0 top-full z-40 mt-1 max-h-[280px] w-[190px] overflow-y-auto rounded-lg border py-1 shadow-2xl backdrop-blur-sm"
                    style={{ background: "rgba(10,8,6,0.97)", borderColor: "rgba(201,168,76,0.3)" }}
                  >
                    {ROOM_NAV.map((r) => {
                      const isActive = currentRoom === r.key;
                      return (
                        <button
                          key={r.key}
                          type="button"
                          role="menuitem"
                          onClick={() => {
                            teleportTo(r.key);
                            setRoomMenuOpen(false);
                          }}
                          className="flex w-full items-center gap-2 px-3 py-1.5 text-left text-[11px] transition-colors hover:bg-[#c9a84c1f]"
                          style={{
                            fontFamily: "Georgia, serif",
                            letterSpacing: "0.04em",
                            color: isActive ? "#c9a84c" : "#cbd2dc",
                            background: isActive ? "rgba(201,168,76,0.1)" : "transparent",
                          }}
                        >
                          <span className="w-3 text-center text-[9px] opacity-70">{r.icon}</span>
                          {r.label}
                          {isActive && <span className="ml-auto text-[8px] text-[#c9a84c]">●</span>}
                        </button>
                      );
                    })}
                  </div>
                </>
              )}
            </div>
          );
        })()}
        {/* Presence chip + activity dropdown, then Invite — in the rail's left
            gap (they sit before the ml-auto tool group, so they stay left). */}
        {token && (
          <>
            <FloorActivityFeed events={floorActivity} presenceCount={Math.max(roster.length, 1)} />
            <FloorInviteButton currentRoom={currentRoom} />
            {officeAvatar && onAvatarSaved && (
              <OfficeAvatarChip compact avatar={officeAvatar} onSaved={onAvatarSaved} />
            )}
          </>
        )}
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
        {/* Map editor — author the floor's WorkAdventure-style scripted areas */}
        <button
          type="button"
          onClick={() => setMapEditorOpen(true)}
          title="Edit the floor's scripted areas"
          className="shrink-0 flex items-center gap-1 px-2.5 py-1 rounded text-[10px] transition-all duration-150"
          style={{
            fontFamily: "Georgia, serif",
            letterSpacing: "0.06em",
            color: "#94a3b8",
            background: "transparent",
            border: "1px solid rgba(255,255,255,0.05)",
          }}
        >
          <span className="opacity-60 text-[8px]">▧</span>
          Map editor
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
        {/* Emote bar — mirrors keyboard shortcuts 1-4 — plus Say + Companion. */}
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
          {/* Say — a text speech bubble over your avatar */}
          <div className="relative">
            <button
              type="button"
              title="Say something"
              aria-expanded={sayOpen}
              onClick={() => setSayOpen((v) => !v)}
              className={`px-1.5 py-0.5 rounded text-[13px] transition-colors ${sayOpen ? "bg-[#c9a84c2e]" : "hover:bg-[#c9a84c1f]"}`}
            >
              💬
            </button>
            {sayOpen && (
              <>
                <div className="fixed inset-0 z-30" onClick={() => setSayOpen(false)} />
                <div
                  className="absolute right-0 top-full z-40 mt-1 flex items-center gap-1 rounded-md border p-1"
                  style={{ borderColor: "rgba(201,168,76,0.35)", background: "rgba(10,8,6,0.97)" }}
                >
                  <input
                    autoFocus
                    value={sayValue}
                    maxLength={120}
                    onChange={(e) => setSayValue(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") submitSay();
                      else if (e.key === "Escape") setSayOpen(false);
                    }}
                    placeholder="Say something…"
                    className="w-40 rounded bg-[#12100c] px-2 py-1 text-[11px] text-fg-primary outline-none"
                    style={{ border: "1px solid rgba(201,168,76,0.2)" }}
                  />
                  <button
                    type="button"
                    onClick={submitSay}
                    className="rounded px-2 py-1 text-[10px] uppercase tracking-[0.1em]"
                    style={{ background: "rgba(201,168,76,0.14)", color: "#c9a84c", border: "1px solid rgba(201,168,76,0.4)" }}
                  >
                    Say
                  </button>
                </div>
              </>
            )}
          </div>
          {/* Companion — an Earn-coin sidekick that follows you */}
          <button
            type="button"
            title={companionOn ? "Dismiss the Earn companion" : "Summon the Earn companion"}
            aria-pressed={companionOn}
            onClick={() => setCompanionOn((v) => !v)}
            className={`px-1.5 py-0.5 rounded text-[13px] transition-colors ${companionOn ? "bg-[#c9a84c2e]" : "hover:bg-[#c9a84c1f]"}`}
          >
            🪙
          </button>
        </div>
      </div>

      {/* Game canvas area */}
      <div className="relative">
        {/* Proximity presence — the executive you're standing beside greets you */}
        {nearbyAgent && (
          <ProximityCard agent={nearbyAgent} onDelegate={() => setDelegateAgent(nearbyAgent)} />
        )}

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
            blurOn={bgBlur}
            blurBusy={bgBusy}
            blurSupported={bgSupported}
            onToggleBlur={() => void toggleBackgroundBlur()}
            inviteUrl={typeof window !== "undefined" ? officeInviteUrl(window.location.origin, { room: currentRoom || null, meet: true }) : ""}
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

        {/* Map editor — author scripted areas; the scene re-renders them live */}
        {mapEditorOpen && <AreaMapEditor onClose={() => setMapEditorOpen(false)} />}

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

        {/* Room actions + persistent panel toggles — one inline horizontal row.
            The Earn Command Center / Active Work toggles sit next to the room's
            Ask Earn / Dashboard actions; hiding both side panels widens the floor. */}
        <div className="absolute bottom-3 left-3 z-10 flex flex-wrap items-center gap-1.5">
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
          {[
            { on: showCommandPanel, toggle: () => setShowCommandPanel((v) => !v), label: "Earn Center" },
            { on: showActiveWork, toggle: () => setShowActiveWork((v) => !v), label: "Active Work" },
          ].map((p) => (
            <button
              key={p.label}
              type="button"
              onClick={p.toggle}
              aria-pressed={p.on}
              title={`${p.on ? "Hide" : "Show"} ${p.label}`}
              className="flex items-center gap-1.5 px-3 py-1.5 text-[11px] rounded-lg transition-colors backdrop-blur-sm"
              style={{
                fontFamily: "Georgia, serif",
                letterSpacing: "0.06em",
                color: p.on ? "#c9a84c" : "#7c8697",
                background: "rgba(10,8,6,0.88)",
                border: `1px solid ${p.on ? "rgba(201,168,76,0.3)" : "rgba(255,255,255,0.08)"}`,
              }}
            >
              <span className="font-mono text-[10px] opacity-80">{p.on ? "⊟" : "⊞"}</span>
              {p.label}
            </button>
          ))}
        </div>

        {/* In-world Marketplace browser — appears while standing in the
            Marketplace hall; lists live public listings and deep-links into the
            full /marketplace surfaces. */}
        {currentRoom === "marketplace" && (
          <div className="pointer-events-auto absolute right-2 top-10 z-10 w-[290px]">
            <MarketplacePanel
              listings={marketplaceListings}
              onOpenListing={setActiveListingId}
              onCreate={() => setShowCreateListing(true)}
            />
          </div>
        )}

        {/* Deal-room context banner — shown at the top of the Deal Room while a
            listing is convened there (opened from a listing, or via a ?deal= link). */}
        {currentRoom === "trading" && dealListingId && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-20 w-[min(92%,460px)] -translate-x-1/2">
            <DealRoomBanner listingId={dealListingId} onClose={() => setDealListingId(null)} />
          </div>
        )}

        {/* A deal room is convened but you've walked out of the Deal Room —
            offer a one-tap way back to it. */}
        {dealListingId && currentRoom !== "trading" && (
          <button
            type="button"
            onClick={() => teleportTo("trading")}
            className="pointer-events-auto absolute bottom-2 left-1/2 z-20 -translate-x-1/2 rounded-full border px-3 py-1 text-[10px] font-semibold uppercase tracking-wider backdrop-blur-sm transition-colors"
            style={{ borderColor: "#c9a84c66", background: "rgba(10,8,6,0.9)", color: "#c9a84c", fontFamily: "Georgia, serif" }}
          >
            ◈ Back to the deal room
          </button>
        )}

        {/* In-world listing detail — opened from a stall press-X or a panel row. */}
        {activeListingId && (
          <MarketplaceListingDetail
            listingId={activeListingId}
            onClose={() => setActiveListingId(null)}
            onOpenDealRoom={(id) => {
              setDealListingId(id);
              setActiveListingId(null);
              teleportTo("trading");
              emitFloorActivity("deal", "A deal room opened in the Deal Room");
              // Convene as a live session: open the video dock once we've arrived.
              setTimeout(() => window.dispatchEvent(new CustomEvent("office:start-meeting")), 700);
            }}
          />
        )}

        {/* In-world "list something" — publish to the exchange floor in place. */}
        {showCreateListing && (
          <MarketplaceCreateListing
            onClose={() => setShowCreateListing(false)}
            onCreated={() => {
              emitFloorActivity("listing", "A new listing was published to the Marketplace");
              void refreshMarketplaceListings();
            }}
          />
        )}

        {/* Delegate a task to the executive the operator is standing next to —
            composes an instruction and routes it into Earn's gated pipeline. */}
        {delegateAgent && (
          <AgentDelegateComposer agent={delegateAgent} onClose={() => setDelegateAgent(null)} />
        )}

        {/* Phaser canvas mount point. Phaser runs in RESIZE mode: the canvas
            matches this box exactly and the camera reveals more office as the box
            grows (rather than just zooming a fixed 3:2 frame). On desktop the box
            fills the floor column's full width and the viewport-capped height, so
            the office spans edge-to-edge and stands taller. Mobile keeps a 3:2
            aspect box in the scrollable stack. */}
        <div
          ref={containerRef}
          style={
            canvasCap
              ? { width: "100%", height: canvasCap }
              : { width: "100%", aspectRatio: `${GAME_WIDTH} / ${GAME_HEIGHT}`, maxWidth: GAME_WIDTH * 1.5 }
          }
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
        </div>

        {/* ── Command & work-visibility column ── (removed when both hidden, so
            the floor column, which is flex-1, widens to reclaim the space) */}
        {(showCommandPanel || showActiveWork) && (
          <div className="flex w-full flex-col gap-3 xl:w-[340px] xl:shrink-0">
            {showCommandPanel && (
              <div className="flex h-[430px] flex-col">
                <OfficeCommandPanel onDismiss={() => setShowCommandPanel(false)} />
              </div>
            )}
            {showActiveWork && <ActiveWorkflowPanel onDismiss={() => setShowActiveWork(false)} />}
          </div>
        )}
      </div>
    </div>
  );
}
