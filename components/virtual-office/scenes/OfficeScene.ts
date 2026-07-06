import * as Phaser from "phaser";
import {
  ROOMS,
  ROOM_W,
  ROOM_H,
  GRID_COLS,
  GRID_ROWS,
  WORLD_W,
  WORLD_H,
  PLAYER_SPEED,
  WALL_THICKNESS,
  DOOR_GAP,
  ANIM_ROWS,
  ROOM_ACTIONS,
  INTERACTIVE_OBJECTS,
  type InteractiveObject,
  type ZoneDef,
} from "../types";
import { VirtualOfficeSocket, type ConnectionStatus } from "../net/VirtualOfficeSocket";
import type { Facing, RemotePlayer, ServerMessage } from "../net/messages";
import { MeshManager } from "../rtc/MeshManager";
import { SfuManager } from "../rtc/SfuManager";
import { executiveCharacters } from "../../characters/characterConfig";
import { spriteFrameMaps } from "../../characters/spriteFrameMap";
import {
  AGENT_BY_ID,
  PROGRAM_AGENTS,
  RISK_TIERS,
  type AgentId,
  type AgentState,
  type RiskTier,
  type RoomKey,
} from "../program/officeProgram";
import { ExecutiveAvatar, type AvatarFacing } from "../avatar/ExecutiveAvatar";
import { agentAvatarSpec, remoteAvatarSpec } from "../avatar/avatarPalette";
import { userAvatarSpec, parseUserAvatar, DEFAULT_USER_AVATAR, type UserAvatar } from "@/lib/office/userAvatar";
import {
  createWallVisuals,
  createFurniture,
  officeSeats,
  boardroomTableSeats,
  coffeePoints,
  yDepth,
  DEPTH_LABEL,
  type FurniturePiece,
  type SeatAnchor,
} from "./officeEnvironment";

// ─── Room label overlay ────────────────────────────────────────────────────────

type RoomZone = { zone: Phaser.GameObjects.Zone; key: string; label: string };

type RemoteAvatarState = {
  sprite: Phaser.Physics.Arcade.Sprite;
  avatar: ExecutiveAvatar;
  label: Phaser.GameObjects.Text;
  nameTag: Phaser.GameObjects.Graphics;
  targetX: number;
  targetY: number;
  facing: Facing;
  spriteKey: string;
};

type NpcAvatarState = {
  /** Invisible position anchor moved by path-following. */
  sprite: Phaser.GameObjects.Sprite;
  /** Humanized vector executive figure rendered on top of the anchor. */
  avatar: ExecutiveAvatar;
  label: Phaser.GameObjects.Text;
  targetX: number;
  targetY: number;
  facing: Facing;
  spriteKey: string;
  // ── Office-program agent fields ──
  /** Program agent id when this NPC is an AI executive agent. */
  agentId: AgentId | null;
  /** Current program state — drives aura color, pulse, and status label. */
  programState: AgentState;
  /** Status line rendered under the name label. */
  statusText: Phaser.GameObjects.Text;
  /** Active waypoint path when the agent is walking to a room. */
  path: Array<{ x: number; y: number }>;
  /** True while the agent is sitting at a desk (idle stance). */
  seated: boolean;
};

type RoomOverlay = {
  glow: Phaser.GameObjects.Graphics;
  badge: Phaser.GameObjects.Text;
  badgeBg: Phaser.GameObjects.Graphics;
};

/** Data passed from VirtualOfficeGame into the scene via scene.init() */
export type OfficeSceneInitData = {
  token?: string;
  characterId?: string;
  /** The operator's human Executive Floor avatar (from user_metadata). */
  officeAvatar?: unknown;
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

/** Deterministic hue (0–360) from a player id string */
function playerIdToHue(id: string): number {
  let h = 0;
  for (let i = 0; i < id.length; i++) {
    h = (h * 31 + id.charCodeAt(i)) & 0xffff;
  }
  return (h % 360);
}

function spritePrefix(spriteKey: string): string {
  if (spriteKey === "earnest-fundmaker") return "earnest";
  if (executiveCharacters.some((c) => c.id === spriteKey && c.spriteSheet)) return spriteKey;
  return "earnest";
}

function facingToAnimKey(facing: Facing, spriteKey = "earnest-fundmaker"): string {
  const p = spritePrefix(spriteKey);
  switch (facing) {
    case "down":  return `${p}-walkDown`;
    case "up":    return `${p}-walkUp`;
    case "left":  return `${p}-walkLeft`;
    case "right": return `${p}-walkRight`;
    default:      return `${p}-idle`;
  }
}

/** Map a velocity vector to a four-way avatar facing. */
function velocityToFacing(vx: number, vy: number): AvatarFacing {
  if (Math.abs(vx) > Math.abs(vy)) return vx < 0 ? "left" : "right";
  return vy < 0 ? "up" : "down";
}

// ─── Scene ────────────────────────────────────────────────────────────────────

export class OfficeScene extends Phaser.Scene {
  // M0 properties
  private player!: Phaser.Physics.Arcade.Sprite;
  private playerAvatar!: ExecutiveAvatar;
  private walls!: Phaser.Physics.Arcade.StaticGroup;
  private cursors!: Phaser.Types.Input.Keyboard.CursorKeys;
  private wasd!: {
    up: Phaser.Input.Keyboard.Key;
    down: Phaser.Input.Keyboard.Key;
    left: Phaser.Input.Keyboard.Key;
    right: Phaser.Input.Keyboard.Key;
  };
  private roomLabel!: Phaser.GameObjects.Text;
  private roomZones: RoomZone[] = [];
  private currentRoom = "";

  // M1 — networking
  private socket: VirtualOfficeSocket | null = null;
  private myPlayerId: string | null = null;

  // M2 — bubble state
  private myBubbleId: string | null = null;
  private bubbleMemberNames: string[] = [];

  // M3 — WebRTC mesh
  private mesh: MeshManager | null = null;
  // M4 — SFU
  private sfu: SfuManager | null = null;
  private sfuMode = false;
  // Proximity video — throttle + dedupe the tile-opacity map sent to the DOM.
  private spatialVideoAccumMs = 0;
  private lastVideoProx = "";
  // Floor presence roster — throttle + dedupe the who's-on-the-floor list.
  private rosterAccumMs = 0;
  private lastRoster = "";
  // M5 — character identity. The invisible physics sprite animates from a real
  // sprite sheet (myCharacterId); the visible figure is the operator's own
  // human avatar (myOfficeAvatar), distinct from the AI executive agents.
  private myCharacterId = "earnest-fundmaker";
  private myOfficeAvatar: UserAvatar = DEFAULT_USER_AVATAR;
  private remotePlayers = new Map<string, RemoteAvatarState>();
  private npcAvatars = new Map<string, NpcAvatarState>();
  private moveSeq = 0;

  private _interpFrame = 0;

  // Iframe zones — populated via office:zone-config event from React layer
  private iframeZoneDefs: ZoneDef[] = [];
  private iframeZoneRects: Array<{ rect: Phaser.Geom.Rectangle; def: ZoneDef }> = [];
  private currentZoneId: string | null = null;
  /** seq number of the last server-acknowledged move for local reconciliation */
  private lastAckedSeq = 0;
  /** velocity at the time each seq was sent, used for reconciliation */
  private pendingMoves = new Map<number, { vx: number; vy: number }>();

  // M1 — HUD
  private netDot!: Phaser.GameObjects.Arc;

  // Click-to-walk pathing
  private walkPath: Array<{ x: number; y: number }> = [];
  private walkMarker: Phaser.GameObjects.Arc | null = null;

  // Minimap HUD
  private minimapPlayerDot!: Phaser.GameObjects.Arc;

  // Interactive objects (press-X hotspots)
  private interactives: Array<{ obj: InteractiveObject; wx: number; wy: number; marker: Phaser.GameObjects.Text }> = [];
  private interactPrompt!: Phaser.GameObjects.Text;
  private nearestInteractive: InteractiveObject | null = null;
  private keyX!: Phaser.Input.Keyboard.Key;

  // Follow-mode (press F near a remote player to follow them)
  private followTargetId: string | null = null;
  private followHud!: Phaser.GameObjects.Text;
  private followRepathMs = 0;
  private keyF!: Phaser.Input.Keyboard.Key;

  // Emotes
  private emoteKeys: Phaser.Input.Keyboard.Key[] = [];
  // Start within the natural 14-26s window so no ambient emote fires on frame 1
  private npcEmoteTimer = 14000 + Math.random() * 12000;

  // ── Accessibility / performance ──
  /** True when the user prefers reduced motion; suppresses decorative loops. */
  private reducedMotion = false;
  /** Off-screen cull margin (world px) around the camera view for avatars. */
  private static readonly CULL_MARGIN = 80;

  // ── Touch controls ──
  /**
   * Normalized movement vector from the on-screen D-pad (mobile/touch), each
   * component in [-1, 1]. {0,0} means released. Consumed in _handleMovement,
   * where it overrides click-to-walk but yields to physical keyboard input.
   */
  private touchVector = { dx: 0, dy: 0 };

  // ── Office-program layer ──
  /** Room activation overlays (glow + task badge), created lazily per room. */
  private roomOverlays = new Map<string, RoomOverlay>();
  /** Which agents currently occupy each room, for slot placement. */
  private roomAgentSlots = new Map<string, AgentId[]>();
  /** 2.5D environment (extruded walls + department furniture) for cleanup. */
  private envWalls: Phaser.GameObjects.Graphics | null = null;
  private furniture: FurniturePiece[] = [];
  /** On-floor approval-gate banner (one at a time; lives in the gate's room). */
  private approvalGateMarker: Phaser.GameObjects.Container | null = null;
  /** Throttle counter for the task-handoff motion trail. */
  private _handoffTrailTick = 0;
  // ── Desk seating ──
  /** All desk seats on the floor. */
  private seats: SeatAnchor[] = [];
  /** Seats not currently occupied by an NPC or the user. */
  private freeSeats = new Set<SeatAnchor>();
  /** Seat each NPC currently occupies, keyed by npcId. */
  private npcSeat = new Map<string, SeatAnchor>();
  /** The seat the local player is sitting in, if any. */
  private playerSeat: SeatAnchor | null = null;
  private keyE!: Phaser.Input.Keyboard.Key;
  private sitPrompt!: Phaser.GameObjects.Text;
  // Gather-style proximity: walk near an executive to get a "talk" affordance.
  private keyT!: Phaser.Input.Keyboard.Key;
  private talkPrompt!: Phaser.GameObjects.Text;
  private talkRing!: Phaser.GameObjects.Arc;
  private nearestNpcId: string | null = null;
  private talkPulse = 0;
  // Proximity/interactive distance scans are throttled off the per-frame path;
  // keypress + the highlight ring still update every frame for responsiveness.
  private scanAccumInteract = 0;
  private scanAccumNpc = 0;
  private clockMs = 0;
  /** Per-zone last auto-activation time (ms on the scene clock), for cooldown. */
  private lastZoneFireAt: Record<string, number> = {};
  /** Conference-table seats (for meetings) and their occupancy. */
  private tableSeats: SeatAnchor[] = [];
  private freeTableSeats = new Set<SeatAnchor>();
  private npcTableSeat = new Map<string, SeatAnchor>();
  // ── Ambient floor life (coffee runs) ──
  private coffeeSpots: Array<{ x: number; y: number }> = [];
  private ambientTimer = 12000 + Math.random() * 12000;
  /** npcId of the one executive currently on a coffee run (one at a time). */
  private ambientAgent: string | null = null;
  private ambientPhase: "to_coffee" | "pause" | "return" | null = null;
  private ambientPauseMs = 0;

  constructor() {
    super({ key: "OfficeScene" });
  }

  // ── init ────────────────────────────────────────────────────────────────────

  init(data: OfficeSceneInitData) {
    // The operator appears as their own human avatar (distinct from the AI
    // executives). The invisible physics sprite keeps a real sprite sheet for
    // movement/animation; the visible figure is built from the office avatar.
    this.myOfficeAvatar = parseUserAvatar(data?.officeAvatar) ?? DEFAULT_USER_AVATAR;
    if (data?.token) {
      this.socket = new VirtualOfficeSocket();
      this.socket.onMessage((msg: ServerMessage) => this._handleServerMessage(msg));
      this.socket.onStatusChange((s: ConnectionStatus) => this._updateNetDot(s));
      this.socket.connect(data.token, "office-main", this.myCharacterId);

      // M3: MeshManager sends RTC signalling through the socket
      const sock = this.socket;
      this.mesh = new MeshManager(
        (msg) => sock!.sendRtc(msg),
        (peerId, el) => this.game.events.emit("rtc:video", peerId, el)
      );
      // M4: SfuManager for bubbles >4
      this.sfu = new SfuManager(
        (msg) => sock!.sendSfu(msg),
        (peerId, el) => this.game.events.emit("rtc:video", peerId, el)
      );
    }
  }

  // ── preload ─────────────────────────────────────────────────────────────────

  preload() {
    // Tilemap + tileset — replaces per-room PNG backgrounds
    this.load.tilemapTiledJSON("office-world", "/assets/fundexecs/office/maps/office-world.tmj");
    this.load.image("office-tiles", "/assets/fundexecs/office/tilesets/office-tiles.png");

    // Earnest Fundmaker sprite sheet (32×32 frames)
    const earnestMap = spriteFrameMaps.earnest;
    this.load.spritesheet("earnest", "/assets/fundexecs/characters/earnest-fundmaker/earnest-fundmaker.png", {
      frameWidth: earnestMap.frameWidth,
      frameHeight: earnestMap.frameHeight,
    });

    // Executive sprite sheets (16×32 frames) — only those with a spriteSheet path
    const execMap = spriteFrameMaps.executive;
    for (const ch of executiveCharacters) {
      if (ch.spriteSheet && ch.frameMapKind === "executive") {
        this.load.spritesheet(ch.id, ch.spriteSheet, {
          frameWidth: execMap.frameWidth,
          frameHeight: execMap.frameHeight,
        });
      }
    }
  }

  // ── create ──────────────────────────────────────────────────────────────────

  create() {
    // Accessibility: honor the OS "reduce motion" setting. Detected once and
    // shared with ExecutiveAvatar (via a static) BEFORE any avatar spawns so
    // the aura/breathing/typing loops are never scheduled. Guarded for SSR
    // and browsers without matchMedia.
    this.reducedMotion =
      typeof window !== "undefined" &&
      typeof window.matchMedia === "function" &&
      window.matchMedia("(prefers-reduced-motion: reduce)").matches;
    ExecutiveAvatar.reducedMotion = this.reducedMotion;

    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

    this._createTilemap();
    this._createWalls();
    // 2.5D department dressing sits above the tile floor and room overlays,
    // below the y-sorted avatar band. Extruded walls line up with the
    // invisible physics walls; furniture y-sorts with avatars for occlusion.
    this.envWalls = createWallVisuals(this);
    this.furniture = createFurniture(this);
    // Desk seats (must exist before agents spawn so they can take a seat).
    this.seats = officeSeats();
    this.freeSeats = new Set(this.seats);
    this.tableSeats = boardroomTableSeats();
    this.freeTableSeats = new Set(this.tableSeats);
    this.coffeeSpots = coffeePoints();
    this._createPlayer();
    this._createAnimations();
    this._createRoomZones();
    this._createRoomLabel();
    this._createNetDot();
    this._setupCamera();
    this._setupInput();
    this._setupSeating();
    this._spawnProgramAgents();
    this._setupProgramBridge();
    this._setupPointerTeleport();
    this._createMinimap();
    this._createInteractives();
    this._setupEmotes();
    this._setupFollowMode();
    this._setupNpcProximity();

    // Ensure the canvas captures keyboard events immediately on scene start
    this.game.canvas.setAttribute("tabindex", "0");
    this.game.canvas.focus();

    // Receive resolved zone definitions from the React wrapper
    this.game.events.on("office:zone-config", (zones: ZoneDef[]) => {
      this.iframeZoneDefs = zones;
      this._createIframeZones();
    });

    // M3/M4: receive local media stream from React wrapper
    this.game.events.on("rtc:localStream", (stream: MediaStream) => {
      this.mesh?.setLocalStream(stream);
      this.sfu?.setLocalStream(stream);
    });

    // Mobile/touch D-pad → normalized movement vector. Consumed each frame in
    // _handleMovement; {0,0} on release. Keyboard still takes precedence.
    this.game.events.on("office:touch-move", (v: { dx: number; dy: number }) => {
      this.touchVector.dx = v?.dx ?? 0;
      this.touchVector.dy = v?.dy ?? 0;
    });

    // M5c: teleport to a room by key
    this.game.events.on("office:teleport", (roomKey: string) => {
      const room = ROOMS.find((r) => r.key === roomKey);
      if (!room) return;
      const tx = room.col * ROOM_W + ROOM_W / 2;
      const ty = room.row * ROOM_H + ROOM_H / 2;
      this._playerStand();
      this.player.setPosition(tx, ty);
      this._cancelWalk();
      this.game.canvas.focus();
    });
  }

  // ── update ──────────────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    this._updateFollowMode(delta);
    this._updateSitting();
    this._handleMovement();
    this._updatePlayerAvatar(delta);
    this._updateInteractives(delta);
    this._updateEmotes(delta);
    this._updateRoomLabel();
    this._updateIframeZones();
    this._updateRemoteAvatars();
    this._updateAmbient(delta);
    this._updateNpcAvatars(delta);
    this._updateNpcProximity(delta);
    this._updateSpatialAudio(delta);
    this._updateRoster(delta);
    this._updateMinimap();

    this._interpFrame = (this._interpFrame + 1) % 2;
  }

  // ── shutdown ─────────────────────────────────────────────────────────────────

  shutdown() {
    this.game.events.off("office:teleport");
    this.game.events.off("office:teleport-room");
    this.game.events.off("office:touch-move");
    this.game.events.off("office:emote");
    this.game.events.off("office:zone-config");
    this.game.events.off("rtc:localStream");
    this.game.events.off("program:npc-goto");
    this.game.events.off("program:npc-state");
    this.game.events.off("program:room-activity");
    this.game.events.off("program:handoff");
    this.game.events.off("program:approval-gate");
    if (this.sfuMode) {
      this.sfu?.leave();
    } else {
      this.mesh?.leaveBubble();
    }
    this.mesh?.stopLocalStream();
    this.mesh = null;
    this.sfu = null;
    this.sfuMode = false;
    this.socket?.disconnect();
    this.socket = null;
    // Tear down vector avatars (containers + tweened auras).
    this.playerAvatar?.destroy();
    for (const [, s] of this.npcAvatars) s.avatar.destroy();
    for (const [, s] of this.remotePlayers) s.avatar.destroy();
    // Tear down the 2.5D environment (walls + furniture graphics).
    this.envWalls?.destroy();
    for (const piece of this.furniture) piece.gfx.destroy();
    this.furniture = [];
    // Tear down the approval-gate banner if one is showing.
    if (this.approvalGateMarker) {
      this.tweens.killTweensOf(this.approvalGateMarker);
      this.approvalGateMarker.destroy(true);
      this.approvalGateMarker = null;
    }
  }

  // ── private helpers ─────────────────────────────────────────────────────────

  private _createTilemap() {
    const map = this.make.tilemap({ key: "office-world" });
    const tileset = map.addTilesetImage("office-tiles", "office-tiles");
    if (!tileset) return;

    // Render floor and decor tile layers beneath everything
    map.createLayer("floor", tileset, 0, 0)?.setDepth(0);
    map.createLayer("decor", tileset, 0, 0)?.setDepth(1);

    // Per-room premium dressing: floor wash, ambient light pool, corner
    // accents, inner shadow frame, and a clean executive label.
    for (const room of ROOMS) {
      const rx = room.col * ROOM_W;
      const ry = room.row * ROOM_H;

      // Soft floor wash — subtly darkens the room field for depth.
      const wash = this.add.graphics().setDepth(1);
      wash.fillStyle(0x0a0e16, 0.28);
      wash.fillRect(rx + 4, ry + 4, ROOM_W - 8, ROOM_H - 8);

      // Ambient light pool at room center — layered discs fake a soft glow.
      const cx = rx + ROOM_W / 2;
      const cy = ry + ROOM_H / 2;
      const pool = this.add.graphics().setDepth(1);
      for (let i = 3; i >= 1; i--) {
        pool.fillStyle(0xc9a84c, 0.015 * i);
        pool.fillCircle(cx, cy, 40 + i * 26);
      }

      // Inner shadow frame + gold hairline border.
      const gfx = this.add.graphics().setDepth(2);
      gfx.lineStyle(3, 0x000000, 0.22);
      gfx.strokeRect(rx + 4, ry + 4, ROOM_W - 8, ROOM_H - 8);
      gfx.lineStyle(1, 0xc9a84c, 0.22);
      gfx.strokeRect(rx + 2, ry + 2, ROOM_W - 4, ROOM_H - 4);

      // Gold corner accents (L-ticks) for a command-floor feel.
      const t = 10;
      gfx.lineStyle(1.5, 0xc9a84c, 0.5);
      const corners: Array<[number, number, number, number]> = [
        [rx + 6, ry + 6, 1, 1], [rx + ROOM_W - 6, ry + 6, -1, 1],
        [rx + 6, ry + ROOM_H - 6, 1, -1], [rx + ROOM_W - 6, ry + ROOM_H - 6, -1, -1],
      ];
      for (const [x, y, sx, sy] of corners) {
        gfx.beginPath();
        gfx.moveTo(x + sx * t, y); gfx.lineTo(x, y); gfx.lineTo(x, y + sy * t);
        gfx.strokePath();
      }

      // Executive label — pill badge with an accent dot, bottom-left.
      const lx = rx + 10;
      const ly = ry + ROOM_H - 24;
      const label = this.add.text(lx + 14, ly + 3, room.label.toUpperCase(), {
        fontFamily: "'Georgia','Times New Roman',serif",
        fontSize: "8px",
        color: "#d8c07a",
        letterSpacing: 2,
      }).setDepth(4).setAlpha(0.95);
      const bg = this.add.graphics().setDepth(3);
      bg.fillStyle(0x0a0806, 0.82);
      bg.fillRoundedRect(lx, ly, label.width + 22, 18, 4);
      bg.lineStyle(1, 0xc9a84c, 0.28);
      bg.strokeRoundedRect(lx, ly, label.width + 22, 18, 4);
      bg.fillStyle(0xc9a84c, 0.9);
      bg.fillCircle(lx + 8, ly + 9, 2);
    }
  }

  private _createWalls() {
    this.walls = this.physics.add.staticGroup();

    const W = WALL_THICKNESS;
    const DG = DOOR_GAP;

    // Helper to add an invisible wall rectangle
    const wall = (x: number, y: number, w: number, h: number) => {
      const gfx = this.add.rectangle(x + w / 2, y + h / 2, w, h, 0x000000, 0);
      this.physics.add.existing(gfx, true);
      this.walls.add(gfx);
    };

    // ── Perimeter walls ──
    wall(0, 0, WORLD_W, W);                          // top
    wall(0, WORLD_H - W, WORLD_W, W);                // bottom
    wall(0, 0, W, WORLD_H);                          // left
    wall(WORLD_W - W, 0, W, WORLD_H);                // right

    // ── Internal horizontal walls (between grid rows) ──
    for (let r = 1; r < GRID_ROWS; r++) {
      const wallY = r * ROOM_H - W / 2;
      for (let c = 0; c < GRID_COLS; c++) {
        const wallX = c * ROOM_W;
        const doorCenter = wallX + ROOM_W / 2;
        // Left segment (before door)
        const leftLen = doorCenter - DG / 2 - wallX;
        if (leftLen > 0) wall(wallX, wallY, leftLen, W);
        // Right segment (after door)
        const rightStart = doorCenter + DG / 2;
        const rightLen = wallX + ROOM_W - rightStart;
        if (rightLen > 0) wall(rightStart, wallY, rightLen, W);
      }
    }

    // ── Internal vertical walls (between grid columns) ──
    for (let c = 1; c < GRID_COLS; c++) {
      const wallX = c * ROOM_W - W / 2;
      for (let r = 0; r < GRID_ROWS; r++) {
        const wallY = r * ROOM_H;
        const doorCenter = wallY + ROOM_H / 2;
        const topLen = doorCenter - DG / 2 - wallY;
        if (topLen > 0) wall(wallX, wallY, W, topLen);
        const botStart = doorCenter + DG / 2;
        const botLen = wallY + ROOM_H - botStart;
        if (botLen > 0) wall(wallX, botStart, W, botLen);
      }
    }
  }

  private _createPlayer() {
    const spawnX = ROOM_W / 2;
    const spawnY = ROOM_H / 2;
    const textureKey = this._textureKeyForCharacter(this.myCharacterId);
    const frameMap = spriteFrameMaps[this._frameMapKindForCharacter(this.myCharacterId)];
    this.player = this.physics.add.sprite(spawnX, spawnY, textureKey);
    this.player.setScale(frameMap.scale);
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(10);
    this.player.setBodySize(20, 20);
    this.player.setOffset(6, 12);
    // The arcade sprite stays as the invisible physics/collision anchor;
    // the humanized vector avatar rides on top of it.
    this.player.setVisible(false);

    this.physics.add.collider(this.player, this.walls);

    // The player appears as their own human avatar (gender + wardrobe + accent).
    this.playerAvatar = new ExecutiveAvatar(this, spawnX, spawnY, userAvatarSpec(this.myOfficeAvatar), 10);
  }

  /** Sync the humanized player avatar to the physics anchor and velocity. */
  private _updatePlayerAvatar(delta: number) {
    if (!this.playerAvatar) return;
    this.playerAvatar.setPosition(this.player.x, this.player.y);
    const body = this.player.body as Phaser.Physics.Arcade.Body | null;
    const vx = body?.velocity.x ?? 0;
    const vy = body?.velocity.y ?? 0;
    const moving = Math.abs(vx) > 4 || Math.abs(vy) > 4;
    if (moving) {
      this.playerAvatar.setFacing(velocityToFacing(vx, vy));
    }
    this.playerAvatar.setWalking(moving);
    this.playerAvatar.update(delta);
    // y-sort so the player passes behind/in front of furniture by depth.
    this.playerAvatar.container.setDepth(yDepth(this.player.y));
  }

  private _textureKeyForCharacter(characterId: string): string {
    if (characterId === "earnest-fundmaker") return "earnest";
    const ch = executiveCharacters.find((c) => c.id === characterId);
    if (ch?.spriteSheet && this.textures.exists(characterId)) return characterId;
    return "earnest";
  }

  private _frameMapKindForCharacter(characterId: string): "earnest" | "executive" {
    if (characterId === "earnest-fundmaker") return "earnest";
    const ch = executiveCharacters.find((c) => c.id === characterId);
    return ch?.frameMapKind ?? "earnest";
  }

  private _createAnimations() {
    const fps = 8;

    const makeAnims = (textureKey: string, prefix: string, framesPerRow: number) => {
      const defs = [
        { suffix: "idle",      row: ANIM_ROWS.idle },
        { suffix: "walkDown",  row: ANIM_ROWS.walkDown },
        { suffix: "walkUp",    row: ANIM_ROWS.walkUp },
        { suffix: "walkLeft",  row: ANIM_ROWS.walkLeft },
        { suffix: "walkRight", row: ANIM_ROWS.walkRight },
      ];
      for (const def of defs) {
        const key = `${prefix}-${def.suffix}`;
        if (!this.anims.exists(key)) {
          this.anims.create({
            key,
            frames: Array.from({ length: 4 }, (_, i) => ({
              key: textureKey,
              frame: def.row * framesPerRow + i,
            })),
            frameRate: fps,
            repeat: -1,
          });
        }
      }
    };

    // Earnest: 32×32 frames → 512px sheet → 16 frames/row
    makeAnims("earnest", "earnest", 512 / spriteFrameMaps.earnest.frameWidth);

    // Executive: 16×32 frames — determine frames/row from actual texture width
    for (const ch of executiveCharacters) {
      if (ch.spriteSheet && ch.frameMapKind === "executive" && this.textures.exists(ch.id)) {
        const tex = this.textures.get(ch.id);
        const src = tex.getSourceImage() as HTMLImageElement;
        const framesPerRow = Math.floor(src.width / spriteFrameMaps.executive.frameWidth);
        makeAnims(ch.id, ch.id, framesPerRow);
      }
    }
  }

  private _createRoomZones() {
    for (const room of ROOMS) {
      const zx = room.col * ROOM_W + ROOM_W / 2;
      const zy = room.row * ROOM_H + ROOM_H / 2;
      const zone = this.add.zone(zx, zy, ROOM_W - WALL_THICKNESS * 2, ROOM_H - WALL_THICKNESS * 2);
      this.physics.world.enable(zone, Phaser.Physics.Arcade.STATIC_BODY);
      this.roomZones.push({ zone, key: room.key, label: room.label });
    }
  }

  private _createIframeZones() {
    // Clear any previously rendered zone graphics (safe to call multiple times)
    this.iframeZoneRects = [];
    for (const def of this.iframeZoneDefs) {
      const room = ROOMS.find((r) => r.key === def.roomKey);
      if (!room) continue;
      const worldX = room.col * ROOM_W + def.x;
      const worldY = room.row * ROOM_H + def.y;
      const rect = new Phaser.Geom.Rectangle(worldX, worldY, def.w, def.h);
      this.iframeZoneRects.push({ rect, def });

      // Visual indicator: dashed amber border at depth 6
      const gfx = this.add.graphics().setDepth(6);
      gfx.lineStyle(1, 0xfbbf24, 0.35);
      gfx.strokeRect(worldX, worldY, def.w, def.h);
      this.add.text(worldX + 6, worldY + 4, `⬛ ${def.title}`, {
        fontFamily: "monospace",
        fontSize: "8px",
        color: "#fbbf24",
        stroke: "#0f172a",
        strokeThickness: 2,
      }).setDepth(6).setAlpha(0.6);
    }
  }

  private _createRoomLabel() {
    this.roomLabel = this.add
      .text(0, 0, "", {
        fontFamily: "'Georgia','Times New Roman',serif",
        fontSize: "11px",
        color: "#c9a84c",
        backgroundColor: "#0a0806e6",
        padding: { x: 14, y: 7 },
        stroke: "#0a0806",
        strokeThickness: 1,
        letterSpacing: 3,
      })
      .setScrollFactor(0)
      .setDepth(20)
      .setVisible(false);
  }

  private _createNetDot() {
    const cam = this.cameras.main;
    // Placed bottom-right; scroll-locked to viewport
    this.netDot = this.add.arc(cam.width - 14, cam.height - 14, 6, 0, 360, false, 0x888888)
      .setScrollFactor(0)
      .setDepth(30);
    // Initially hidden; becomes visible once a socket is created
    this.netDot.setVisible(this.socket !== null);
  }

  private _updateNetDot(status: ConnectionStatus) {
    if (!this.netDot) return;
    this.netDot.setVisible(true);
    switch (status) {
      case "connected":    this.netDot.setFillStyle(0x22c55e); break; // green
      case "reconnecting": this.netDot.setFillStyle(0xf59e0b); break; // amber
      case "failed":       this.netDot.setFillStyle(0xef4444); break; // red
      case "disconnected": this.netDot.setFillStyle(0x888888); break; // grey
    }
  }

  private _setupCamera() {
    const cam = this.cameras.main;
    cam.setBounds(0, 0, WORLD_W, WORLD_H);
    cam.startFollow(this.player, true, 0.08, 0.08);
    cam.setZoom(2.0);
  }

  private _setupInput() {
    this.cursors = this.input.keyboard!.createCursorKeys();
    this.wasd = {
      up:    this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.W),
      down:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.S),
      left:  this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.A),
      right: this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.D),
    };
  }

  private _handleMovement() {
    const up    = this.cursors.up.isDown    || this.wasd.up.isDown;
    const down  = this.cursors.down.isDown  || this.wasd.down.isDown;
    const left  = this.cursors.left.isDown  || this.wasd.left.isDown;
    const right = this.cursors.right.isDown || this.wasd.right.isDown;
    const kbActive = up || down || left || right;
    const touchActive = this.touchVector.dx !== 0 || this.touchVector.dy !== 0;

    // Seated: any movement input stands the player up; otherwise stay put.
    if (this.playerSeat) {
      if (kbActive || touchActive) this._playerStand();
      else { this.player.setVelocity(0, 0); return; }
    }

    // Keyboard and touch both override click-to-walk and follow-mode; keyboard
    // takes precedence over touch when both are engaged.
    if (kbActive || touchActive) { this._cancelWalk(); this._cancelFollow(); }
    else if (this._followWalkPath()) return;

    let vx = 0;
    let vy = 0;

    if (kbActive) {
      if (left)  vx -= PLAYER_SPEED;
      if (right) vx += PLAYER_SPEED;
      if (up)    vy -= PLAYER_SPEED;
      if (down)  vy += PLAYER_SPEED;
      // Normalize diagonal
      if (vx !== 0 && vy !== 0) {
        vx *= 0.707;
        vy *= 0.707;
      }
    } else if (touchActive) {
      // Drive velocity from the on-screen D-pad vector, normalized to unit
      // length so diagonals match keyboard speed.
      const len = Math.hypot(this.touchVector.dx, this.touchVector.dy) || 1;
      vx = (this.touchVector.dx / len) * PLAYER_SPEED;
      vy = (this.touchVector.dy / len) * PLAYER_SPEED;
    }

    this.player.setVelocity(vx, vy);

    // Animation
    if (vx < 0)      this.player.anims.play(facingToAnimKey("left",  this.myCharacterId), true);
    else if (vx > 0) this.player.anims.play(facingToAnimKey("right", this.myCharacterId), true);
    else if (vy < 0) this.player.anims.play(facingToAnimKey("up",    this.myCharacterId), true);
    else if (vy > 0) this.player.anims.play(facingToAnimKey("down",  this.myCharacterId), true);
    else             this.player.anims.play(facingToAnimKey("idle",  this.myCharacterId), true);

    // Send movement to server (client-side prediction — we already applied locally)
    if (this.socket && (vx !== 0 || vy !== 0)) {
      const seq = ++this.moveSeq;
      // Normalise to unit direction for the wire message
      const len = Math.sqrt(vx * vx + vy * vy);
      const dx = vx / len;
      const dy = vy / len;
      this.pendingMoves.set(seq, { vx, vy });
      this.socket.sendMove(dx, dy, seq);
    }
  }

  private _updateRoomLabel() {
    const px = this.player.x;
    const py = this.player.y;
    let found = "";
    let foundLabel = "";

    for (const rz of this.roomZones) {
      const body = rz.zone.body as Phaser.Physics.Arcade.StaticBody;
      const b = body.getBounds(new Phaser.Geom.Rectangle());
      if (Phaser.Geom.Rectangle.Contains(b as unknown as Phaser.Geom.Rectangle, px, py)) {
        found = rz.key;
        foundLabel = rz.label;
        break;
      }
    }

    if (found !== this.currentRoom) {
      this.currentRoom = found;
      if (found) {
        this.roomLabel.setText(foundLabel.toUpperCase());
        // Position HUD label top-center of viewport
        const cam = this.cameras.main;
        this.roomLabel.setPosition(
          cam.width / 2 - this.roomLabel.width / 2,
          16
        );
        this.roomLabel.setVisible(true);
      } else {
        this.roomLabel.setVisible(false);
      }
      // Notify React layer of room change so it can render room-specific actions
      this.game.events.emit("office:room-enter", found, ROOM_ACTIONS[found] ?? []);
    }
  }

  private _updateIframeZones() {
    const px = this.player.x;
    const py = this.player.y;
    let enteredId: string | null = null;
    let enteredDef: ZoneDef | null = null;

    for (const { rect, def } of this.iframeZoneRects) {
      if (Phaser.Geom.Rectangle.Contains(rect, px, py)) {
        enteredId = def.id;
        enteredDef = def;
        break;
      }
    }

    if (enteredId !== this.currentZoneId) {
      this.currentZoneId = enteredId;
      if (enteredDef) {
        this.game.events.emit("office:zone-enter", enteredDef);
      } else {
        this.game.events.emit("office:zone-leave");
      }
    }
  }

  // ── Multiplayer: remote avatar rendering ────────────────────────────────────

  private _updateRemoteAvatars() {
    const view = this.cameras.main.worldView;
    const M = OfficeScene.CULL_MARGIN;
    for (const [, state] of this.remotePlayers) {
      const prevX = state.sprite.x;
      const prevY = state.sprite.y;
      // Interpolate toward the last server target every frame (cheap lerp).
      // Position math always runs so re-entry into view is seamless.
      state.sprite.x = Phaser.Math.Linear(state.sprite.x, state.targetX, 0.2);
      state.sprite.y = Phaser.Math.Linear(state.sprite.y, state.targetY, 0.2);
      const moving = Math.hypot(state.sprite.x - prevX, state.sprite.y - prevY) > 0.4;

      // Off-screen culling: skip the expensive redraw + label repositioning and
      // hide the visuals when outside the camera view (plus a margin).
      const onScreen =
        state.sprite.x >= view.x - M && state.sprite.x <= view.right + M &&
        state.sprite.y >= view.y - M && state.sprite.y <= view.bottom + M;
      if (!onScreen) {
        if (state.avatar.container.visible) {
          state.avatar.container.setVisible(false);
          state.label.setVisible(false);
          state.nameTag.setVisible(false);
        }
        continue;
      }
      if (!state.avatar.container.visible) {
        state.avatar.container.setVisible(true);
        state.label.setVisible(true);
        state.nameTag.setVisible(true);
      }

      if (moving) {
        state.avatar.setFacing(velocityToFacing(state.sprite.x - prevX, state.sprite.y - prevY));
      }
      state.avatar.setWalking(moving);
      state.avatar.setPosition(state.sprite.x, state.sprite.y);
      state.avatar.update(16);
      state.avatar.container.setDepth(yDepth(state.sprite.y));
      state.label.setPosition(state.sprite.x, state.sprite.y - 28);
      state.nameTag.setPosition(state.sprite.x, state.sprite.y - 40);
    }
  }

  private static readonly NPC_SPEED = 105; // px/s — purposeful executive pace
  /** Radius² within which an idle executive turns to face the player. */
  private static readonly LOOK_RADIUS_SQ = 96 * 96;

  /**
   * Program agents walk waypoint paths issued by the office program
   * (task routing, meetings, approvals). Movement is never random.
   */
  private _updateNpcAvatars(delta: number) {
    const step = (OfficeScene.NPC_SPEED * delta) / 1000;
    const view = this.cameras.main.worldView;
    const M = OfficeScene.CULL_MARGIN;
    for (const [npcId, state] of this.npcAvatars) {
      if (state.seated) { this._updateSeatedNpc(state, delta); continue; }
      let walking = false;
      // Facing update is deferred so it (and its redraw) is skipped when culled.
      let newFacing: AvatarFacing | null = null;
      if (state.path.length > 0) {
        walking = true;
        const next = state.path[0];
        const dx = next.x - state.sprite.x;
        const dy = next.y - state.sprite.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= step) {
          state.sprite.setPosition(next.x, next.y);
          state.path.shift();
          if (state.path.length === 0) {
            walking = false;
            state.facing = "down" as Facing;
          }
        } else {
          state.sprite.x += (dx / dist) * step;
          state.sprite.y += (dy / dist) * step;
          const facing = velocityToFacing(dx, dy);
          state.facing = facing as Facing;
          newFacing = facing;
        }
      } else if (state.targetX !== state.sprite.x || state.targetY !== state.sprite.y) {
        // Legacy lerp target (kept for future server-driven agents).
        state.sprite.x = Phaser.Math.Linear(state.sprite.x, state.targetX, 0.24);
        state.sprite.y = Phaser.Math.Linear(state.sprite.y, state.targetY, 0.24);
      }

      // On arrival, take a seat: collaborators sit at the conference table,
      // idle executives sit at the nearest desk. The executive on an ambient
      // coffee run manages its own sit, so it's excluded here. Earn is the
      // command operator — it stays on its feet in the Command Center, greeting
      // the operator, so it's never auto-seated when idle.
      if (!walking && !state.seated && npcId !== this.ambientAgent) {
        if (state.programState === "collaborating") {
          if (this._sitAtTable(npcId, state)) continue;
        } else if (state.programState === "idle" && state.agentId !== "earn") {
          if (this._sitNpc(npcId, state)) continue;
        }
      }

      // Off-screen culling: movement math above still ran, but skip the
      // per-frame redraw + label repositioning and hide the visuals.
      const onScreen =
        state.sprite.x >= view.x - M && state.sprite.x <= view.right + M &&
        state.sprite.y >= view.y - M && state.sprite.y <= view.bottom + M;
      if (!onScreen) {
        if (state.avatar.container.visible) {
          state.avatar.container.setVisible(false);
          state.label.setVisible(false);
          state.statusText.setVisible(false);
        }
        continue;
      }
      if (!state.avatar.container.visible) {
        state.avatar.container.setVisible(true);
        state.label.setVisible(true);
        state.statusText.setVisible(true);
      }

      // Reactive presence (ACE-style "face the user when addressed"): an idle
      // executive turns to look at the player when they come near, and settles
      // back to a neutral facing once the player moves off. Never changes
      // position — movement stays program-driven.
      if (!walking && state.path.length === 0 && state.programState === "idle") {
        const dxp = this.player.x - state.sprite.x;
        const dyp = this.player.y - state.sprite.y;
        newFacing = dxp * dxp + dyp * dyp < OfficeScene.LOOK_RADIUS_SQ
          ? velocityToFacing(dxp, dyp)
          : ("down" as AvatarFacing);
      } else if (!walking && state.programState === "collaborating") {
        // Meeting presence: collaborators turn inward to face the center of
        // the room they're meeting in, so a Boardroom huddle reads as a group.
        const col = Math.floor(state.sprite.x / ROOM_W);
        const row = Math.floor(state.sprite.y / ROOM_H);
        const dxc = col * ROOM_W + ROOM_W / 2 - state.sprite.x;
        const dyc = row * ROOM_H + ROOM_H / 2 - state.sprite.y;
        if (Math.abs(dxc) > 6 || Math.abs(dyc) > 6) newFacing = velocityToFacing(dxc, dyc);
      }

      if (newFacing) state.avatar.setFacing(newFacing);
      state.avatar.setWalking(walking);
      state.avatar.setPosition(state.sprite.x, state.sprite.y);
      state.avatar.update(delta);
      state.avatar.container.setDepth(yDepth(state.sprite.y));
      state.label.setPosition(state.sprite.x, state.sprite.y - 30);
      state.statusText.setPosition(state.sprite.x, state.sprite.y - 22);
    }
  }

  // ── Office-program bridge — NPC reactivity, room activation, handoffs ──────

  private _setupProgramBridge() {
    // Agent walks to a room with purpose (task assignment / approval / return).
    this.game.events.on("program:npc-goto", (agentId: AgentId, roomKey: RoomKey) => {
      const npc = this.npcAvatars.get(`agent:${agentId}`);
      if (!npc) return;
      this._standNpc(`agent:${agentId}`, npc); // stand up before walking
      const dest = this._claimRoomSlot(agentId, roomKey);
      npc.path = this._findPath(npc.sprite.x, npc.sprite.y, dest.x, dest.y);
      if (npc.path.length === 0) npc.path = [dest];
    });

    // Agent state change — aura color, pulse, and executive status line.
    this.game.events.on(
      "program:npc-state",
      (agentId: AgentId, state: AgentState, label: string) => {
        const npc = this.npcAvatars.get(`agent:${agentId}`);
        if (!npc) return;
        npc.programState = state;
        npc.statusText.setText(this._shortStatus(state, label));
        npc.avatar.setState(state);
        // Sitting is the idle stance: sit when the agent goes idle (and isn't
        // walking), stand for any active state.
        if (state === "idle") {
          if (npc.path.length === 0 && !npc.seated) this._sitNpc(`agent:${agentId}`, npc);
        } else if (npc.seated) {
          this._standNpc(`agent:${agentId}`, npc);
        }
      }
    );

    // Room activation — glow border + task/tier badge.
    this.game.events.on(
      "program:room-activity",
      (roomKey: RoomKey, active: boolean, taskCount: number, tier: RiskTier | null) => {
        this._renderRoomOverlay(roomKey, active, taskCount, tier);
      }
    );

    // Visible work handoff — a task card travels from Earn to the agent.
    this.game.events.on("program:handoff", (toAgentId: AgentId) => {
      const from = this.npcAvatars.get("agent:earn");
      const to = this.npcAvatars.get(`agent:${toAgentId}`);
      if (!from || !to) return;
      this._animateTaskHandoff(from.sprite.x, from.sprite.y - 12, to.sprite.x, to.sprite.y - 12);
    });

    // On-floor approval gate — a pulsing banner in the room where the
    // capital-binding / external-facing decision is pending.
    this.game.events.on(
      "program:approval-gate",
      (roomKey: RoomKey, active: boolean, tier: Exclude<RiskTier, "internal"> | null, title: string) => {
        this._renderApprovalGate(roomKey, active, tier, title);
      }
    );
  }

  /** On-floor approval-gate banner. One at a time; cleared when resolved. */
  private _renderApprovalGate(
    roomKey: RoomKey, active: boolean, tier: Exclude<RiskTier, "internal"> | null, _title: string,
  ) {
    if (this.approvalGateMarker) {
      this.tweens.killTweensOf(this.approvalGateMarker);
      this.approvalGateMarker.destroy(true);
      this.approvalGateMarker = null;
    }
    if (!active) return;
    const room = ROOMS.find((r) => r.key === roomKey);
    if (!room) return;

    const hex = tier ? RISK_TIERS[tier].color : "#f59e0b";
    const color = parseInt(hex.slice(1), 16);
    const short = tier ? RISK_TIERS[tier].short : "";
    const cx = room.col * ROOM_W + ROOM_W / 2;
    const cy = room.row * ROOM_H + 42;

    const g = this.add.graphics();
    const w = 152, h = 26;
    g.fillStyle(0x0a0806, 0.92); g.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
    g.fillStyle(color, 0.14); g.fillRoundedRect(-w / 2, -h / 2, w, h, 6);
    g.lineStyle(1.5, color, 0.9); g.strokeRoundedRect(-w / 2, -h / 2, w, h, 6);
    const label = this.add.text(0, 0, `⚖  APPROVAL REQUIRED${short ? ` · ${short}` : ""}`, {
      fontFamily: "'Georgia','Times New Roman',serif",
      fontSize: "9px",
      color: hex,
      letterSpacing: 1,
    }).setOrigin(0.5, 0.5);

    const container = this.add.container(cx, cy, [g, label]).setDepth(DEPTH_LABEL + 0.2);
    this.approvalGateMarker = container;
    if (!this.reducedMotion) {
      this.tweens.add({ targets: container, alpha: 0.55, duration: 820, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
      this.tweens.add({ targets: container, scaleX: 1.04, scaleY: 1.04, duration: 1200, yoyo: true, repeat: -1, ease: "Sine.easeInOut" });
    }
  }

  /** Compact status text for the floor label (full text lives in the panel). */
  private _shortStatus(state: AgentState, label: string): string {
    if (state === "idle") return "";
    const max = 26;
    return label.length > max ? `${label.slice(0, max - 1)}…` : label;
  }

  /** Room activation overlay: soft glow border + "N active · tier" badge. */
  private _renderRoomOverlay(roomKey: string, active: boolean, taskCount: number, tier: RiskTier | null) {
    const room = ROOMS.find((r) => r.key === roomKey);
    if (!room) return;
    let overlay = this.roomOverlays.get(roomKey);
    if (!overlay) {
      const glow = this.add.graphics().setDepth(3);
      const badgeBg = this.add.graphics().setDepth(4);
      const badge = this.add.text(0, 0, "", {
        fontFamily: "'Georgia','Times New Roman',serif",
        fontSize: "8px",
        color: "#c9a84c",
        letterSpacing: 1,
      }).setDepth(5);
      overlay = { glow, badge, badgeBg };
      this.roomOverlays.set(roomKey, overlay);
    }

    overlay.glow.clear();
    overlay.badgeBg.clear();
    this.tweens.killTweensOf(overlay.glow);

    if (!active) {
      overlay.badge.setVisible(false);
      return;
    }

    const tierColor = tier ? parseInt(RISK_TIERS[tier].color.slice(1), 16) : 0xc9a84c;
    const rx = room.col * ROOM_W + 3;
    const ry = room.row * ROOM_H + 3;
    // Soft interior illumination — layered discs at room center fake a
    // directional light pool so an active room visibly "turns on".
    const cx = room.col * ROOM_W + ROOM_W / 2;
    const cy = room.row * ROOM_H + ROOM_H / 2;
    for (let i = 3; i >= 1; i--) {
      overlay.glow.fillStyle(tierColor, 0.03 * i);
      overlay.glow.fillCircle(cx, cy, 46 + i * 30);
    }
    // Gold-lit floor wash tint across the room field.
    overlay.glow.fillStyle(tierColor, 0.05);
    overlay.glow.fillRect(rx, ry, ROOM_W - 6, ROOM_H - 6);
    // Accent border — pulses unless reduced motion, in which case it holds a
    // static glow so the "room is active" cue remains legible.
    overlay.glow.lineStyle(2, tierColor, 0.5);
    overlay.glow.strokeRect(rx, ry, ROOM_W - 6, ROOM_H - 6);
    overlay.glow.setAlpha(1);
    if (!this.reducedMotion) {
      this.tweens.add({
        targets: overlay.glow, alpha: 0.5, duration: 1300, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
      });
    }

    const tierShort = tier ? RISK_TIERS[tier].short : "";
    overlay.badge.setText(`● ${taskCount} ACTIVE${tierShort ? ` · ${tierShort}` : ""}`);
    overlay.badge.setColor(tier ? RISK_TIERS[tier].color : "#c9a84c");
    const bx = room.col * ROOM_W + ROOM_W - overlay.badge.width - 16;
    const by = room.row * ROOM_H + 8;
    overlay.badge.setPosition(bx + 5, by + 3).setVisible(true);
    overlay.badgeBg.fillStyle(0x0a0806, 0.82);
    overlay.badgeBg.fillRoundedRect(bx, by, overlay.badge.width + 10, 15, 3);
  }

  /** Gold task card tween with a fading motion trail — the visible delegation
   *  from Earn to an agent. The trail is suppressed under reduced motion. */
  private _animateTaskHandoff(fromX: number, fromY: number, toX: number, toY: number) {
    const card = this.add.graphics().setDepth(14);
    card.fillStyle(0xc9a84c, 0.95);
    card.fillRoundedRect(-5, -3.5, 10, 7, 1.5);
    card.lineStyle(0.5, 0x0a0806, 0.9);
    card.strokeRoundedRect(-5, -3.5, 10, 7, 1.5);
    card.setPosition(fromX, fromY);
    const trail = !this.reducedMotion;
    this._handoffTrailTick = 0;
    this.tweens.add({
      targets: card,
      x: toX,
      y: toY,
      duration: 620,
      ease: "Cubic.easeInOut",
      onUpdate: trail
        ? () => {
            // Drop a fading gold mote every few frames along the card's path.
            this._handoffTrailTick = (this._handoffTrailTick + 1) % 3;
            if (this._handoffTrailTick !== 0) return;
            const mote = this.add.circle(card.x, card.y, 2.4, 0xc9a84c, 0.7).setDepth(13);
            this.tweens.add({
              targets: mote, alpha: 0, scale: 0.3, duration: 360,
              onComplete: () => mote.destroy(),
            });
          }
        : undefined,
      onComplete: () => {
        this.tweens.add({
          targets: card, alpha: 0, scale: 1.6, duration: 220,
          onComplete: () => card.destroy(),
        });
      },
    });
  }

  /** Deterministic in-room slot so agents never stack on one tile. */
  private _claimRoomSlot(agentId: AgentId, roomKey: RoomKey): { x: number; y: number } {
    // Release any slot the agent holds elsewhere
    for (const [key, ids] of this.roomAgentSlots) {
      const idx = ids.indexOf(agentId);
      if (idx >= 0 && key !== roomKey) ids.splice(idx, 1);
    }
    const ids = this.roomAgentSlots.get(roomKey) ?? [];
    if (!ids.includes(agentId)) ids.push(agentId);
    this.roomAgentSlots.set(roomKey, ids);

    const room = ROOMS.find((r) => r.key === roomKey)!;
    const offsets = [
      { dx: -60, dy: 20 }, { dx: 60, dy: 20 }, { dx: -60, dy: 64 },
      { dx: 60, dy: 64 }, { dx: 0, dy: 44 }, { dx: 0, dy: -8 },
    ];
    const off = offsets[ids.indexOf(agentId) % offsets.length];
    return {
      x: room.col * ROOM_W + ROOM_W / 2 + off.dx,
      y: room.row * ROOM_H + ROOM_H / 2 + off.dy,
    };
  }

  // ── Interactive objects — WorkAdventure-style "press X" hotspots ────────────

  private static readonly INTERACT_RADIUS = 52;

  private _createInteractives() {
    for (const obj of INTERACTIVE_OBJECTS) {
      const room = ROOMS.find((r) => r.key === obj.roomKey);
      if (!room) continue;
      const wx = room.col * ROOM_W + obj.x;
      const wy = room.row * ROOM_H + obj.y;

      // Subtle pulsing gold diamond marks the hotspot
      const marker = this.add.text(wx, wy - 20, obj.icon, {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#c9a84c",
      }).setOrigin(0.5, 0.5).setDepth(DEPTH_LABEL - 0.2).setAlpha(0.7);
      this.interactives.push({ obj, wx, wy, marker });
      // Bob the hotspot marker unless reduced motion — then it sits static.
      if (!this.reducedMotion) {
        this.tweens.add({
          targets: marker, y: wy - 24, alpha: 0.35,
          duration: 1200, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
        });
      }
    }

    // Scroll-locked prompt shown when standing near a hotspot
    this.interactPrompt = this.add.text(0, 0, "", {
      fontFamily: "'Georgia','Times New Roman',serif",
      fontSize: "10px",
      color: "#c9a84c",
      backgroundColor: "#0a0806e6",
      padding: { x: 10, y: 5 },
    }).setScrollFactor(0).setDepth(25).setVisible(false);

    this.keyX = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.X);
  }

  private static readonly SCAN_INTERVAL_MS = 90;
  private static readonly ZONE_COOLDOWN_MS = 6000;

  private _updateInteractives(delta: number) {
    this.clockMs += delta;

    // Per-frame: act on the cached nearest hotspot so the keypress stays crisp.
    if (this.nearestInteractive && Phaser.Input.Keyboard.JustDown(this.keyX)) {
      this.game.events.emit("office:interact", this.nearestInteractive);
      this._showEmote(this.player.x, this.player.y, "✦");
    }

    // Throttled: the distance scan runs ~10×/sec, not every frame.
    this.scanAccumInteract += delta;
    if (this.scanAccumInteract < OfficeScene.SCAN_INTERVAL_MS) return;
    this.scanAccumInteract = 0;

    let nearest: InteractiveObject | null = null;
    let bestDist = OfficeScene.INTERACT_RADIUS;
    for (const { obj, wx, wy } of this.interactives) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, wx, wy);
      if (d < bestDist) { bestDist = d; nearest = obj; }
    }
    if (nearest === this.nearestInteractive) return;
    this.nearestInteractive = nearest;
    if (!nearest) {
      this.interactPrompt.setVisible(false);
      return;
    }
    this.interactPrompt.setText(`${nearest.icon}  Press X — ${nearest.label}`);
    const cam = this.cameras.main;
    this.interactPrompt.setPosition(cam.width / 2 - this.interactPrompt.width / 2, cam.height - 44);
    this.interactPrompt.setVisible(true);

    // On-entry glow: the zone's marker pops larger so stepping into a zone feels
    // alive (Gather-style). Scale-only, so it rides alongside the looping bob
    // tween (which animates y + alpha) without killing it. Skipped under
    // reduced motion — where the marker sits static anyway.
    const entry = this.interactives.find((i) => i.obj === nearest);
    if (entry && !this.reducedMotion) {
      entry.marker.setScale(1.6);
      this.tweens.add({ targets: entry.marker, scale: 1, duration: 420, ease: "Back.easeOut" });
    }

    // Gather-style: stepping into a NON-navigating zone activates it on entry
    // (with a cooldown). Navigating (href) zones still require a press to X —
    // auto-navigating on mere entry would yank the operator off the floor.
    if (nearest.event && !nearest.href) {
      const last = this.lastZoneFireAt[nearest.id] ?? -Infinity;
      if (this.clockMs - last > OfficeScene.ZONE_COOLDOWN_MS) {
        this.lastZoneFireAt[nearest.id] = this.clockMs;
        this.game.events.emit("office:interact", nearest);
      }
    }
  }

  // ── Gather-style NPC proximity — walk near an executive to talk ──────────────

  private static readonly TALK_RADIUS_SQ = 62 * 62;

  private _setupNpcProximity() {
    this.keyT = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.T);
    this.talkPrompt = this.add.text(0, 0, "", {
      fontFamily: "'Georgia','Times New Roman',serif",
      fontSize: "10px",
      color: "#c9a84c",
      backgroundColor: "#0a0806e6",
      padding: { x: 10, y: 5 },
    }).setScrollFactor(0).setDepth(25).setVisible(false);
    // Soft gold halo that highlights the executive you're standing beside.
    this.talkRing = this.add.arc(0, 0, 15, 0, 360, false)
      .setStrokeStyle(1.5, 0xc9a84c, 0.9)
      .setFillStyle(0xc9a84c, 0.06)
      .setDepth(5)
      .setVisible(false);
  }

  /**
   * Highlight the nearest executive and offer a press-T / click "talk", so the
   * floor rewards walking up to someone — Gather-style proximity presence.
   * Talking reuses the same npc:click path as tapping the figure.
   */
  private _updateNpcProximity(delta: number) {
    // Per-frame: follow + breathe the ring and handle press-T on the cached
    // nearest executive, so the highlight and talk stay responsive.
    const nearest = this.nearestNpcId ? this.npcAvatars.get(this.nearestNpcId) : undefined;
    if (nearest && nearest.agentId) {
      this.talkRing.setPosition(nearest.sprite.x, nearest.sprite.y + 12);
      this.talkRing.setDepth(yDepth(nearest.sprite.y) - 0.1);
      if (!this.reducedMotion) {
        this.talkPulse += delta / 1000;
        const p = (Math.sin(this.talkPulse * 3.2) + 1) / 2;
        this.talkRing.setScale(0.92 + p * 0.16).setAlpha(0.6 + p * 0.4);
      }
      if (Phaser.Input.Keyboard.JustDown(this.keyT)) {
        this.game.events.emit("npc:click", {
          npcId: this.nearestNpcId,
          spriteKey: nearest.spriteKey,
          name: nearest.label.text,
        });
        nearest.avatar.react();
      }
    }

    // Throttled: re-scan for the nearest executive ~10×/sec.
    this.scanAccumNpc += delta;
    if (this.scanAccumNpc < OfficeScene.SCAN_INTERVAL_MS) return;
    this.scanAccumNpc = 0;

    let nearestId: string | null = null;
    let best: NpcAvatarState | null = null;
    let bd = OfficeScene.TALK_RADIUS_SQ;
    for (const [npcId, state] of this.npcAvatars) {
      if (!state.agentId) continue;
      const dx = state.sprite.x - this.player.x;
      const dy = state.sprite.y - this.player.y;
      const d = dx * dx + dy * dy;
      if (d < bd) { bd = d; best = state; nearestId = npcId; }
    }
    if (nearestId === this.nearestNpcId) return;
    this.nearestNpcId = nearestId;
    if (best && best.agentId) {
      this.talkPrompt.setText(`💬  Talk to ${best.label.text} — T`);
      const cam = this.cameras.main;
      this.talkPrompt.setPosition(cam.width / 2 - this.talkPrompt.width / 2, cam.height - 88);
      this.talkPrompt.setVisible(true);
      this.talkRing.setVisible(true);
      // Surface the executive's presence as live dialogue in the DOM overlay.
      const agent = AGENT_BY_ID[best.agentId];
      this.game.events.emit("office:nearby-agent", {
        agentId: best.agentId,
        name: agent.name,
        role: agent.role,
        line: agent.idleLine,
        accent: agent.accent,
      });
    } else {
      this.talkPrompt.setVisible(false);
      this.talkRing.setVisible(false);
      this.game.events.emit("office:nearby-agent", null);
    }
  }

  // ── Follow-mode — press F near a remote player to walk behind them ─────────

  private static readonly FOLLOW_PICK_RADIUS = 96;
  private static readonly FOLLOW_STOP_DIST = 44;

  private _setupFollowMode() {
    this.keyF = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.F);
    this.followHud = this.add.text(0, 0, "", {
      fontFamily: "'Georgia','Times New Roman',serif",
      fontSize: "10px",
      color: "#c9a84c",
      backgroundColor: "#0a0806e6",
      padding: { x: 10, y: 5 },
    }).setScrollFactor(0).setDepth(25).setVisible(false);
  }

  private _cancelFollow() {
    if (!this.followTargetId) return;
    this.followTargetId = null;
    this.followHud.setVisible(false);
    this._cancelWalk();
  }

  private _updateFollowMode(delta: number) {
    if (Phaser.Input.Keyboard.JustDown(this.keyF)) {
      if (this.followTargetId) {
        this._cancelFollow();
      } else {
        // Pick the nearest remote player within reach
        let bestId: string | null = null;
        let bestDist = OfficeScene.FOLLOW_PICK_RADIUS;
        for (const [id, state] of this.remotePlayers) {
          const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, state.sprite.x, state.sprite.y);
          if (d < bestDist) { bestDist = d; bestId = id; }
        }
        if (bestId) {
          this.followTargetId = bestId;
          const name = this.remotePlayers.get(bestId)?.label.text ?? "player";
          this.followHud.setText(`◈  Following ${name} — F to stop`);
          const cam = this.cameras.main;
          this.followHud.setPosition(cam.width / 2 - this.followHud.width / 2, 40);
          this.followHud.setVisible(true);
        }
      }
    }

    if (!this.followTargetId) return;
    const target = this.remotePlayers.get(this.followTargetId);
    if (!target) { this._cancelFollow(); return; }  // target left the office

    // Re-path on a short cadence so we trail the target without thrashing A*
    this.followRepathMs -= delta;
    const dist = Phaser.Math.Distance.Between(this.player.x, this.player.y, target.sprite.x, target.sprite.y);
    if (dist <= OfficeScene.FOLLOW_STOP_DIST) {
      this._cancelWalk();
    } else if (this.followRepathMs <= 0) {
      this.followRepathMs = 350;
      this.walkPath = this._findPath(this.player.x, this.player.y, target.sprite.x, target.sprite.y);
    }
  }

  // ── Emotes — Gather-style reactions on keys 1-4 ─────────────────────────────

  private static readonly EMOTES = ["👋", "👍", "❤️", "🎉"] as const;

  private _setupEmotes() {
    const codes = [
      Phaser.Input.Keyboard.KeyCodes.ONE,
      Phaser.Input.Keyboard.KeyCodes.TWO,
      Phaser.Input.Keyboard.KeyCodes.THREE,
      Phaser.Input.Keyboard.KeyCodes.FOUR,
    ];
    this.emoteKeys = codes.map((c) => this.input.keyboard!.addKey(c));

    // React layer can also trigger emotes (emote button bar)
    this.game.events.on("office:emote", (emoji: string) => {
      this._triggerLocalEmote(emoji);
    });
  }

  /** Show an emote above the local player and broadcast it to the room. */
  private _triggerLocalEmote(emoji: string) {
    this._showEmote(this.player.x, this.player.y, emoji);
    const allowed = OfficeScene.EMOTES.find((e) => e === emoji);
    if (this.socket && allowed) {
      this.socket.sendEmote(allowed);
    }
  }

  private _updateEmotes(delta: number) {
    for (let i = 0; i < this.emoteKeys.length; i++) {
      if (Phaser.Input.Keyboard.JustDown(this.emoteKeys[i])) {
        this._triggerLocalEmote(OfficeScene.EMOTES[i]);
      }
    }
    // Light purposeful idle activity — only idle agents, infrequent, and
    // restricted to work-flavored icons. Active agents never emote randomly;
    // their state is communicated by aura + status label instead. Suppressed
    // entirely under reduced motion (ambient decorative motion).
    if (this.reducedMotion) return;
    this.npcEmoteTimer -= delta;
    if (this.npcEmoteTimer <= 0) {
      this.npcEmoteTimer = 14000 + Math.random() * 12000;
      const idle = [...this.npcAvatars.values()].filter((n) => n.programState === "idle");
      if (idle.length > 0) {
        const npc = idle[Math.floor(Math.random() * idle.length)];
        const ambient = ["📊", "✦", "📈"];
        this._showEmote(npc.sprite.x, npc.sprite.y, ambient[Math.floor(Math.random() * ambient.length)]);
      }
    }
  }

  private _showEmote(x: number, y: number, emoji: string) {
    // Speech-bubble emote that floats up and fades
    const bubble = this.add.text(x, y - 34, emoji, {
      fontSize: "14px",
      backgroundColor: "#0a0806cc",
      padding: { x: 5, y: 3 },
    }).setOrigin(0.5, 1).setDepth(DEPTH_LABEL + 0.3);
    if (this.reducedMotion) {
      // Reduced motion: appear at full scale, then a single fade-out (no pop
      // or float). The emote is still shown and readable.
      bubble.setScale(1);
      this.tweens.add({
        targets: bubble, alpha: 0, duration: 900, delay: 900,
        onComplete: () => bubble.destroy(),
      });
      return;
    }
    bubble.setScale(0.4);
    this.tweens.add({
      targets: bubble, scale: 1, y: y - 44, duration: 180, ease: "Back.easeOut",
      onComplete: () => {
        this.tweens.add({
          targets: bubble, y: y - 58, alpha: 0, duration: 900, delay: 700,
          onComplete: () => bubble.destroy(),
        });
      },
    });
  }

  private _createMinimap() {
    // Clickable floor-plan minimap, scroll-locked bottom-right (Gather-style)
    const cam = this.cameras.main;
    const SCALE = 0.055;                        // 1152×864 world → ~63×48 px
    const mw = WORLD_W * SCALE, mh = WORLD_H * SCALE;
    const pad = 10;
    const ox = cam.width - mw - pad, oy = cam.height - mh - pad - 18;

    const bg = this.add.graphics().setScrollFactor(0).setDepth(28);
    bg.fillStyle(0x0a0806, 0.85);
    bg.fillRoundedRect(ox - 5, oy - 5, mw + 10, mh + 10, 4);
    bg.lineStyle(1, 0xc9a84c, 0.3);
    bg.strokeRoundedRect(ox - 5, oy - 5, mw + 10, mh + 10, 4);

    for (const room of ROOMS) {
      const rx = ox + room.col * ROOM_W * SCALE;
      const ry = oy + room.row * ROOM_H * SCALE;
      const rw = ROOM_W * SCALE - 1, rh = ROOM_H * SCALE - 1;
      const cell = this.add.rectangle(rx + rw / 2, ry + rh / 2, rw, rh, 0xc9a84c, 0.12)
        .setStrokeStyle(0.5, 0xc9a84c, 0.35)
        .setScrollFactor(0)
        .setDepth(29)
        .setInteractive({ useHandCursor: true });
      cell.on("pointerover", () => cell.setFillStyle(0xc9a84c, 0.3));
      cell.on("pointerout",  () => cell.setFillStyle(0xc9a84c, 0.12));
      cell.on("pointerup", (ptr: Phaser.Input.Pointer, _x: number, _y: number, ev: Phaser.Types.Input.EventData) => {
        ev.stopPropagation();   // don't also trigger click-to-walk
        this.player.setPosition(room.col * ROOM_W + ROOM_W / 2, room.row * ROOM_H + ROOM_H / 2);
        this._cancelWalk();
        this._cancelFollow();
      });
    }

    this.minimapPlayerDot = this.add.arc(ox, oy, 2, 0, 360, false, 0xc9a84c)
      .setScrollFactor(0).setDepth(30);
    // Stash origin/scale for the per-frame dot update
    this.minimapPlayerDot.setData({ ox, oy, scale: SCALE });
  }

  private _updateMinimap() {
    if (!this.minimapPlayerDot) return;
    const ox = this.minimapPlayerDot.getData("ox") as number;
    const oy = this.minimapPlayerDot.getData("oy") as number;
    const s  = this.minimapPlayerDot.getData("scale") as number;
    this.minimapPlayerDot.setPosition(ox + this.player.x * s, oy + this.player.y * s);
  }

  private _setupPointerTeleport() {
    // Click-to-walk: click anywhere and the avatar pathfinds there (Gather-style)
    this.input.on("pointerup", (ptr: Phaser.Input.Pointer) => {
      // Ignore clicks consumed by interactive objects (NPCs, minimap cells)
      if (this.input.hitTestPointer(ptr).length > 0) return;
      const world = this.cameras.main.getWorldPoint(ptr.x, ptr.y);
      if (world.x < 0 || world.y < 0 || world.x >= WORLD_W || world.y >= WORLD_H) return;
      this._cancelFollow();
      this._walkTo(world.x, world.y);
    });

    // Emit teleport requests from the React layer (room key → room center)
    this.game.events.on("office:teleport-room", (roomKey: string) => {
      const room = ROOMS.find((r) => r.key === roomKey);
      if (!room) return;
      this._playerStand();
      this.player.setPosition(room.col * ROOM_W + ROOM_W / 2, room.row * ROOM_H + ROOM_H / 2);
      this._cancelWalk();
      this._cancelFollow();
      this.game.canvas.focus();
    });
  }

  // ── Click-to-walk pathfinding ───────────────────────────────────────────────
  //
  // The world is a 3×3 room grid; movement between adjacent tiles is free
  // inside a room, and crossing a room boundary is only allowed through the
  // door gap at the center of each shared edge (mirrors _createWalls()).

  private static readonly TILE = 32;

  private _tileWalkableEdge(ax: number, ay: number, bx: number, by: number): boolean {
    const T = OfficeScene.TILE;
    const tilesPerRoomX = ROOM_W / T;  // 12
    const tilesPerRoomY = ROOM_H / T;  // 9
    // Crossing a vertical room boundary (x changes across col*12)
    if (ax !== bx) {
      const boundary = Math.max(ax, bx);
      if (boundary % tilesPerRoomX === 0 && boundary > 0 && boundary < (WORLD_W / T)) {
        // The 64px DOOR_GAP centered on the odd-height (9-tile) room edge fully
        // covers only tile row 4; the adjacent rows are half-blocked, so a
        // 20px body walking their centers would clip the wall. One row only.
        const roomRow = Math.floor(ay / tilesPerRoomY);
        const doorRow = roomRow * tilesPerRoomY + Math.floor(tilesPerRoomY / 2);
        return ay === doorRow;
      }
    }
    // Crossing a horizontal room boundary (y changes across row*9)
    if (ay !== by) {
      const boundary = Math.max(ay, by);
      if (boundary % tilesPerRoomY === 0 && boundary > 0 && boundary < (WORLD_H / T)) {
        const roomCol = Math.floor(ax / tilesPerRoomX);
        const doorColA = roomCol * tilesPerRoomX + Math.floor(tilesPerRoomX / 2) - 1;
        return ax === doorColA || ax === doorColA + 1;
      }
    }
    return true;
  }

  private _findPath(sx: number, sy: number, tx: number, ty: number): Array<{ x: number; y: number }> {
    const T = OfficeScene.TILE;
    const GW = WORLD_W / T, GH = WORLD_H / T;
    const start = { x: Math.floor(sx / T), y: Math.floor(sy / T) };
    const goal  = { x: Math.min(GW - 1, Math.max(0, Math.floor(tx / T))), y: Math.min(GH - 1, Math.max(0, Math.floor(ty / T))) };
    if (start.x === goal.x && start.y === goal.y) return [{ x: tx, y: ty }];

    const key = (x: number, y: number) => y * GW + x;
    const open: Array<{ x: number; y: number; f: number }> = [{ ...start, f: 0 }];
    const came = new Map<number, number>();
    const gScore = new Map<number, number>([[key(start.x, start.y), 0]]);
    const h = (x: number, y: number) => Math.abs(x - goal.x) + Math.abs(y - goal.y);

    while (open.length > 0) {
      // TODO: replace linear-scan open set with a min-heap if the map grows
      // beyond the current 36×27 grid (O(n²) is ~fine at 972 tiles).
      let bi = 0;
      for (let i = 1; i < open.length; i++) if (open[i].f < open[bi].f) bi = i;
      const cur = open.splice(bi, 1)[0];
      if (cur.x === goal.x && cur.y === goal.y) {
        // reconstruct → waypoints at tile centers, final point is the exact click
        const path: Array<{ x: number; y: number }> = [];
        let k = key(cur.x, cur.y);
        while (came.has(k)) {
          const x = k % GW, y = Math.floor(k / GW);
          path.unshift({ x: x * T + T / 2, y: y * T + T / 2 });
          k = came.get(k)!;
        }
        if (path.length > 0) path[path.length - 1] = { x: tx, y: ty };
        else path.push({ x: tx, y: ty });
        return path;
      }
      for (const [dx, dy] of [[0, -1], [0, 1], [-1, 0], [1, 0]] as const) {
        const nx = cur.x + dx, ny = cur.y + dy;
        if (nx < 0 || ny < 0 || nx >= GW || ny >= GH) continue;
        if (!this._tileWalkableEdge(cur.x, cur.y, nx, ny)) continue;
        const ng = (gScore.get(key(cur.x, cur.y)) ?? Infinity) + 1;
        if (ng < (gScore.get(key(nx, ny)) ?? Infinity)) {
          came.set(key(nx, ny), key(cur.x, cur.y));
          gScore.set(key(nx, ny), ng);
          open.push({ x: nx, y: ny, f: ng + h(nx, ny) });
        }
      }
    }
    return [];
  }

  private _walkTo(wx: number, wy: number) {
    if (this.playerSeat) this._playerStand(); // clicking to walk stands you up
    this.walkPath = this._findPath(this.player.x, this.player.y, wx, wy);
    if (this.walkPath.length === 0) return;
    // Destination marker — gold pulse ring that fades
    this.walkMarker?.destroy();
    this.walkMarker = this.add.arc(wx, wy, 8, 0, 360, false).setStrokeStyle(1.5, 0xc9a84c, 0.9).setDepth(DEPTH_LABEL - 0.3);
    this.tweens.add({
      targets: this.walkMarker, scale: 0.3, alpha: 0, duration: 600,
      onComplete: () => { this.walkMarker?.destroy(); this.walkMarker = null; },
    });
  }

  private _cancelWalk() {
    this.walkPath = [];
  }

  /** Follow the active click-to-walk path. Returns true when auto-walking. */
  private _followWalkPath(): boolean {
    if (this.walkPath.length === 0) return false;
    const next = this.walkPath[0];
    const dx = next.x - this.player.x;
    const dy = next.y - this.player.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 4) {
      this.walkPath.shift();
      if (this.walkPath.length === 0) {
        this.player.setVelocity(0, 0);
        this.player.anims.play(facingToAnimKey("idle", this.myCharacterId), true);
        return true;
      }
      return this._followWalkPath();
    }
    const vx = (dx / dist) * PLAYER_SPEED;
    const vy = (dy / dist) * PLAYER_SPEED;
    this.player.setVelocity(vx, vy);
    // Face dominant axis
    if (Math.abs(vx) > Math.abs(vy)) {
      this.player.anims.play(facingToAnimKey(vx < 0 ? "left" : "right", this.myCharacterId), true);
    } else {
      this.player.anims.play(facingToAnimKey(vy < 0 ? "up" : "down", this.myCharacterId), true);
    }
    // Mirror to server, same as keyboard movement
    if (this.socket) {
      const seq = ++this.moveSeq;
      this.pendingMoves.set(seq, { vx, vy });
      this.socket.sendMove(vx / PLAYER_SPEED, vy / PLAYER_SPEED, seq);
    }
    return true;
  }

  /**
   * Spawn the AI executive agents at their home rooms. Agents are
   * humanized executive sprites with a name label, role status line,
   * and an AI-native glow ring that activates only when they work.
   * All movement is issued by the office program — never random.
   */
  private _spawnProgramAgents() {
    for (const agent of PROGRAM_AGENTS) {
      // Earn greets the operator standing in the center of the Command Center
      // room, right alongside the player, instead of seated at a desk — so the
      // office opens onto the two of them together, ready to work.
      if (agent.id === "earn") {
        const room = ROOMS.find((r) => r.key === agent.homeRoom);
        const cx = (room ? room.col * ROOM_W : 0) + ROOM_W / 2 + 34;
        const cy = (room ? room.row * ROOM_H : 0) + ROOM_H / 2 + 4;
        this._spawnNpc(`agent:${agent.id}`, cx, cy, "down", agent.spriteKey, agent.name, agent.id);
        continue;
      }
      const pos = this._claimRoomSlot(agent.id, agent.homeRoom);
      this._spawnNpc(`agent:${agent.id}`, pos.x, pos.y, "down", agent.spriteKey, agent.name, agent.id);
      // Idle executives start the day sitting at a desk in their home room.
      const st = this.npcAvatars.get(`agent:${agent.id}`);
      if (st) this._sitNpc(`agent:${agent.id}`, st);
    }
  }

  // ── Desk seating ──────────────────────────────────────────────────────────

  private static readonly SIT_RADIUS_SQ = 46 * 46;

  private _setupSeating() {
    this.keyE = this.input.keyboard!.addKey(Phaser.Input.Keyboard.KeyCodes.E);
    this.sitPrompt = this.add.text(0, 0, "", {
      fontFamily: "'Georgia','Times New Roman',serif",
      fontSize: "10px",
      color: "#c9a84c",
      backgroundColor: "#0a0806e6",
      padding: { x: 10, y: 5 },
    }).setScrollFactor(0).setDepth(25).setVisible(false);
  }

  /** Room key containing a world point, or null. */
  private _roomKeyAt(x: number, y: number): RoomKey | null {
    const col = Math.floor(x / ROOM_W);
    const row = Math.floor(y / ROOM_H);
    const room = ROOMS.find((r) => r.col === col && r.row === row);
    return (room?.key as RoomKey) ?? null;
  }

  /** Nearest free seat in a room to a point. */
  private _nearestFreeSeat(roomKey: RoomKey, x: number, y: number): SeatAnchor | null {
    let best: SeatAnchor | null = null;
    let bd = Infinity;
    for (const s of this.freeSeats) {
      if (s.roomKey !== roomKey) continue;
      const d = (s.x - x) ** 2 + (s.y - y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    return best;
  }

  /** Seat an NPC at the nearest free desk in its current room. */
  private _sitNpc(npcId: string, state: NpcAvatarState): boolean {
    const rk = this._roomKeyAt(state.sprite.x, state.sprite.y);
    const seat = rk ? this._nearestFreeSeat(rk, state.sprite.x, state.sprite.y) : null;
    if (!seat) return false;
    this.freeSeats.delete(seat);
    this.npcSeat.set(npcId, seat);
    state.seated = true;
    state.path = [];
    state.sprite.setPosition(seat.x, seat.y);
    state.avatar.setSeated(true);
    state.avatar.setFacing("down");
    state.avatar.setPosition(seat.x, seat.y);
    return true;
  }

  /** Seat an NPC at the nearest free conference-table seat (for meetings). */
  private _sitAtTable(npcId: string, state: NpcAvatarState): boolean {
    let best: SeatAnchor | null = null;
    let bd = Infinity;
    for (const s of this.freeTableSeats) {
      const d = (s.x - state.sprite.x) ** 2 + (s.y - state.sprite.y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    if (!best) return false;
    this.freeTableSeats.delete(best);
    this.npcTableSeat.set(npcId, best);
    state.seated = true;
    state.path = [];
    state.sprite.setPosition(best.x, best.y);
    state.avatar.setSeated(true);
    state.avatar.setFacing(best.facing);
    state.avatar.setPosition(best.x, best.y);
    return true;
  }

  /** Stand an NPC up, releasing whichever seat (desk or table) it holds. */
  private _standNpc(npcId: string, state: NpcAvatarState) {
    const seat = this.npcSeat.get(npcId);
    if (seat) { this.freeSeats.add(seat); this.npcSeat.delete(npcId); }
    const tseat = this.npcTableSeat.get(npcId);
    if (tseat) { this.freeTableSeats.add(tseat); this.npcTableSeat.delete(npcId); }
    if (state.seated) { state.seated = false; state.avatar.setSeated(false); }
  }

  /** Per-frame update for a seated NPC: hold position, breathe/blink, cull. */
  private _updateSeatedNpc(state: NpcAvatarState, delta: number) {
    const view = this.cameras.main.worldView;
    const M = OfficeScene.CULL_MARGIN;
    const onScreen =
      state.sprite.x >= view.x - M && state.sprite.x <= view.right + M &&
      state.sprite.y >= view.y - M && state.sprite.y <= view.bottom + M;
    if (!onScreen) {
      if (state.avatar.container.visible) {
        state.avatar.container.setVisible(false);
        state.label.setVisible(false);
        state.statusText.setVisible(false);
      }
      return;
    }
    if (!state.avatar.container.visible) {
      state.avatar.container.setVisible(true);
      state.label.setVisible(true);
      state.statusText.setVisible(true);
    }
    state.avatar.setPosition(state.sprite.x, state.sprite.y);
    state.avatar.update(delta);
    state.avatar.container.setDepth(yDepth(state.sprite.y));
    state.label.setPosition(state.sprite.x, state.sprite.y - 30);
    state.statusText.setPosition(state.sprite.x, state.sprite.y - 22);
  }

  /** Player sit/stand: press E near a free desk to sit; move or press E to stand. */
  private _updateSitting() {
    if (this.playerSeat) {
      if (Phaser.Input.Keyboard.JustDown(this.keyE)) this._playerStand();
      return;
    }
    let best: SeatAnchor | null = null;
    let bd = OfficeScene.SIT_RADIUS_SQ;
    for (const s of this.freeSeats) {
      const d = (s.x - this.player.x) ** 2 + (s.y - this.player.y) ** 2;
      if (d < bd) { bd = d; best = s; }
    }
    if (best) {
      if (!this.sitPrompt.visible) {
        this.sitPrompt.setText("🪑  Press E — sit").setVisible(true);
        const cam = this.cameras.main;
        this.sitPrompt.setPosition(cam.width / 2 - this.sitPrompt.width / 2, cam.height - 66);
      }
      if (Phaser.Input.Keyboard.JustDown(this.keyE)) this._playerSit(best);
    } else if (this.sitPrompt.visible) {
      this.sitPrompt.setVisible(false);
    }
  }

  private _playerSit(seat: SeatAnchor) {
    this.freeSeats.delete(seat);
    this.playerSeat = seat;
    this._cancelWalk();
    this._cancelFollow();
    this.player.setVelocity(0, 0);
    this.player.setPosition(seat.x, seat.y);
    this.playerAvatar.setSeated(true);
    this.playerAvatar.setFacing("down");
    this.sitPrompt.setVisible(false);
  }

  private _playerStand() {
    if (!this.playerSeat) return;
    this.freeSeats.add(this.playerSeat);
    this.playerSeat = null;
    this.playerAvatar.setSeated(false);
  }

  // ── Ambient floor life — occasional coffee runs ───────────────────────────
  //
  // To make the floor feel alive between tasks, one idle executive at a time
  // gets up, strolls to the nearest coffee station, pauses, and returns to a
  // desk. It's a low-frequency background motion: never more than one runner,
  // always yields the moment the office program hands that agent real work,
  // and fully disabled under reduced-motion.

  /** Pick a random idle, seated executive to send on a coffee run (never Earn). */
  private _pickAmbientCandidate(): string | null {
    const candidates: string[] = [];
    for (const [npcId, state] of this.npcAvatars) {
      if (
        state.seated &&
        state.programState === "idle" &&
        state.agentId &&
        state.agentId !== "earn"
      ) {
        candidates.push(npcId);
      }
    }
    if (candidates.length === 0) return null;
    return candidates[Math.floor(Math.random() * candidates.length)];
  }

  /** Nearest coffee station to a point. */
  private _nearestCoffee(x: number, y: number): { x: number; y: number } | null {
    let best: { x: number; y: number } | null = null;
    let bd = Infinity;
    for (const c of this.coffeeSpots) {
      const d = (c.x - x) ** 2 + (c.y - y) ** 2;
      if (d < bd) { bd = d; best = c; }
    }
    return best;
  }

  private _updateAmbient(delta: number) {
    if (this.reducedMotion || this.coffeeSpots.length === 0) return;

    // A run is in progress — advance its little state machine.
    if (this.ambientAgent) {
      const state = this.npcAvatars.get(this.ambientAgent);
      // Agent vanished or the program handed it real work — abandon the run
      // and let the program drive (goto/state handlers own the seat + path now).
      if (!state || state.programState !== "idle") {
        this.ambientAgent = null;
        this.ambientPhase = null;
        return;
      }

      if (this.ambientPhase === "to_coffee") {
        if (state.path.length === 0) {
          this.ambientPhase = "pause";
          this.ambientPauseMs = 1400 + Math.random() * 1600;
          state.avatar.setFacing("up"); // face the machine
        }
      } else if (this.ambientPhase === "pause") {
        this.ambientPauseMs -= delta;
        if (this.ambientPauseMs <= 0) {
          const home = state.agentId ? AGENT_BY_ID[state.agentId].homeRoom : null;
          const seat = home
            ? this._nearestFreeSeat(home, state.sprite.x, state.sprite.y)
            : null;
          const dest = seat ?? this._roomCenter(home);
          state.path = this._findPath(state.sprite.x, state.sprite.y, dest.x, dest.y);
          this.ambientPhase = "return";
        }
      } else if (this.ambientPhase === "return") {
        if (state.path.length === 0) {
          this.ambientAgent = null;
          this.ambientPhase = null;
          this._sitNpc(`agent:${state.agentId}`, state); // settle back at a desk
        }
      }
      return;
    }

    // No run active — count down, then occasionally start one.
    this.ambientTimer -= delta;
    if (this.ambientTimer > 0) return;
    this.ambientTimer = 16000 + Math.random() * 14000;

    const npcId = this._pickAmbientCandidate();
    if (!npcId) return;
    const state = this.npcAvatars.get(npcId);
    if (!state) return;
    const coffee = this._nearestCoffee(state.sprite.x, state.sprite.y);
    if (!coffee) return;

    this._standNpc(npcId, state);
    state.path = this._findPath(state.sprite.x, state.sprite.y, coffee.x, coffee.y);
    // Already at the station (no path) — skip straight to the pause phase.
    this.ambientAgent = npcId;
    this.ambientPhase = "to_coffee";
  }

  /** Center point of a room (fallback ambient destination). */
  private _roomCenter(roomKey: RoomKey | null): { x: number; y: number } {
    const room = ROOMS.find((r) => r.key === roomKey);
    if (!room) return { x: this.player.x, y: this.player.y };
    return { x: room.col * ROOM_W + ROOM_W / 2, y: room.row * ROOM_H + ROOM_H / 2 };
  }

  private _spawnNpc(
    npcId: string,
    x: number,
    y: number,
    facing: Facing,
    spriteKey: string,
    name: string,
    agentId: AgentId | null = null,
  ) {
    if (this.npcAvatars.has(npcId)) return;

    // Invisible arcade-free anchor the path-follower moves; the humanized
    // vector avatar rides on top of it.
    const sprite = this.add.sprite(x, y, this._textureKeyForCharacter(spriteKey));
    sprite.setVisible(false);
    sprite.setActive(false);

    const accentHex = agentId ? AGENT_BY_ID[agentId].accent : "#fbbf24";
    const spec = agentId
      ? agentAvatarSpec(agentId, accentHex)
      : agentAvatarSpec("associate", accentHex);
    const avatar = new ExecutiveAvatar(this, x, y, spec, 8);
    avatar.setFacing(facing === "idle" ? "down" : (facing as AvatarFacing));

    // Make the humanized figure clickable — emits npc:click so the React
    // layer can open the inspector, and the figure nods to acknowledge the tap.
    avatar.setInteractive(() => {
      avatar.react();
      this.game.events.emit("npc:click", { npcId, spriteKey, name });
    });

    const label = this.add.text(x, y - 30, name, {
      fontFamily: "monospace",
      fontSize: "8px",
      color: accentHex,
      stroke: "#0f172a",
      strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(DEPTH_LABEL);

    // Executive status line under the name — updated by the program layer
    const statusText = this.add.text(x, y - 22, "", {
      fontFamily: "monospace",
      fontSize: "6px",
      color: "#cbd5e1",
      stroke: "#0f172a",
      strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(DEPTH_LABEL);

    this.npcAvatars.set(npcId, {
      sprite, avatar, label, targetX: x, targetY: y, facing, spriteKey,
      agentId, programState: "idle", statusText, path: [], seated: false,
    });
  }

  // Proximity video: the tile fades as the teammate's avatar drifts away, on
  // the same distance band as the spatial audio — Gather's "see who's near".
  private static readonly VIDEO_NEAR_PX = 160;
  private static readonly VIDEO_FAR_PX = 240;
  private static readonly VIDEO_MIN = 0.12;

  private _updateSpatialAudio(delta: number) {
    const prox: Record<string, number> = {};
    for (const [id, state] of this.remotePlayers) {
      const dist = Phaser.Math.Distance.Between(
        this.player.x, this.player.y,
        state.sprite.x, state.sprite.y
      );
      if (this.sfuMode) {
        this.sfu?.updateSpatialGain(id, dist);
      } else {
        this.mesh?.updateSpatialGain(id, dist);
      }
      const f = Math.max(
        OfficeScene.VIDEO_MIN,
        Math.min(1, (OfficeScene.VIDEO_FAR_PX - dist) / (OfficeScene.VIDEO_FAR_PX - OfficeScene.VIDEO_NEAR_PX)),
      );
      prox[id] = Math.round(f * 100) / 100;
    }

    // Throttle the DOM update to ~8×/sec, and only emit when it actually changes.
    this.spatialVideoAccumMs += delta;
    if (this.spatialVideoAccumMs < 120) return;
    this.spatialVideoAccumMs = 0;
    const key = JSON.stringify(prox);
    if (key === this.lastVideoProx) return;
    this.lastVideoProx = key;
    this.game.events.emit("rtc:video-proximity", prox);
  }

  /**
   * Broadcast the floor presence roster to the DOM — who's on the floor
   * (you + teammates), each with the room they're standing in — so the office
   * can show a live "who's here" list. Throttled to ~1×/sec and deduped.
   */
  private _updateRoster(delta: number) {
    this.rosterAccumMs += delta;
    if (this.rosterAccumMs < 1000) return;
    this.rosterAccumMs = 0;

    const roster: Array<{ id: string; name: string; roomKey: string | null; self: boolean }> = [
      {
        id: "self",
        name: this.myOfficeAvatar.displayName,
        roomKey: this._roomKeyAt(this.player.x, this.player.y),
        self: true,
      },
    ];
    for (const [id, state] of this.remotePlayers) {
      roster.push({
        id,
        name: state.label.text,
        roomKey: this._roomKeyAt(state.sprite.x, state.sprite.y),
        self: false,
      });
    }

    const key = JSON.stringify(roster);
    if (key === this.lastRoster) return;
    this.lastRoster = key;
    this.game.events.emit("office:roster", roster);
  }

  private _spawnRemotePlayer(remote: RemotePlayer) {
    if (remote.id === this.myPlayerId) return;
    if (this.remotePlayers.has(remote.id)) return;

    const spriteKey = remote.spriteKey ?? "player_default";
    const textureKey = this._textureKeyForCharacter(spriteKey);
    const frameMap = spriteFrameMaps[this._frameMapKindForCharacter(spriteKey)];

    // Invisible physics anchor keeps collision + server reconciliation intact.
    const sprite = this.physics.add.sprite(remote.x, remote.y, textureKey);
    sprite.setScale(frameMap.scale);
    sprite.setDepth(9);
    sprite.setBodySize(20, 20);
    sprite.setOffset(6, 12);
    sprite.setVisible(false);

    this.physics.add.collider(sprite, this.walls);

    // Remote humans render as distinct executives (suit/accent from their id).
    const avatar = new ExecutiveAvatar(this, remote.x, remote.y, remoteAvatarSpec(remote.id), 9);
    avatar.setFacing(remote.facing === "idle" ? "down" : (remote.facing as AvatarFacing));

    const label = this.add.text(remote.x, remote.y - 28, remote.name, {
      fontFamily: "monospace",
      fontSize: "8px",
      color: "#e2e8f0",
      stroke: "#0f172a",
      strokeThickness: 2,
    })
      .setOrigin(0.5, 1)
      .setDepth(DEPTH_LABEL);

    // Small colored presence dot above the name tag
    const hue = playerIdToHue(remote.id);
    const dotColor = Phaser.Display.Color.HSVColorWheel()[Math.round(hue / 360 * 359)].color;
    const nameTag = this.add.graphics().setDepth(DEPTH_LABEL + 0.1);
    nameTag.fillStyle(dotColor, 1);
    nameTag.fillCircle(0, 0, 5);
    nameTag.lineStyle(1, 0x0f172a, 0.8);
    nameTag.strokeCircle(0, 0, 5);

    this.remotePlayers.set(remote.id, {
      sprite,
      avatar,
      label,
      nameTag,
      targetX: remote.x,
      targetY: remote.y,
      facing: remote.facing,
      spriteKey,
    });
  }

  private _removeRemotePlayer(playerId: string) {
    const state = this.remotePlayers.get(playerId);
    if (!state) return;
    state.avatar.destroy();
    state.sprite.destroy();
    state.label.destroy();
    state.nameTag.destroy();
    this.remotePlayers.delete(playerId);
  }

  private _handleServerMessage(msg: ServerMessage) {
    switch (msg.type) {
      case "welcome": {
        this.myPlayerId = msg.playerId;
        for (const p of msg.worldSnapshot.players) {
          this._spawnRemotePlayer(p);
        }
        break;
      }
      case "player.joined": {
        this._spawnRemotePlayer(msg.player);
        break;
      }
      case "player.left": {
        this._removeRemotePlayer(msg.playerId);
        break;
      }
      case "player.state": {
        if (msg.playerId === this.myPlayerId) {
          // Reconcile local player position
          const dx = this.player.x - msg.x;
          const dy = this.player.y - msg.y;
          const dist = Math.sqrt(dx * dx + dy * dy);
          if (dist > 8) {
            // Snap on large divergence
            this.player.setPosition(msg.x, msg.y);
          }
          // Prune acknowledged pending moves
          for (const seq of this.pendingMoves.keys()) {
            if (seq <= msg.seq) this.pendingMoves.delete(seq);
          }
          this.lastAckedSeq = msg.seq;
        } else {
          const state = this.remotePlayers.get(msg.playerId);
          if (state) {
            state.targetX = msg.x;
            state.targetY = msg.y;
            if (state.facing !== msg.facing) {
              state.facing = msg.facing;
              state.sprite.anims.play(facingToAnimKey(msg.facing, state.spriteKey), true);
            }
          }
        }
        break;
      }
      case "player.emote": {
        // Sanitize: only render allowlisted emojis from the server
        if (!OfficeScene.EMOTES.some((e) => e === msg.emoji)) break;
        const state = this.remotePlayers.get(msg.playerId);
        if (state) {
          this._showEmote(state.sprite.x, state.sprite.y, msg.emoji);
        }
        break;
      }
      case "pong": {
        // Heartbeat acknowledged; socket manager handles stale detection
        break;
      }
      case "bubble.join": {
        this.myBubbleId = msg.bubbleId;
        this.bubbleMemberNames = msg.members
          .filter((id) => id !== this.myPlayerId)
          .map((id) => this.remotePlayers.get(id)?.label.text ?? id);
        this.game.events.emit("bubble:update", this.bubbleMemberNames);
        // M3: initiate WebRTC mesh (only if not already in SFU mode)
        if (!this.sfuMode && this.mesh && this.myPlayerId) {
          void this.mesh.joinBubble(this.myPlayerId, msg.members);
        }
        break;
      }
      case "bubble.update": {
        if (msg.bubbleId !== this.myBubbleId) break;
        this.bubbleMemberNames = msg.members
          .filter((id) => id !== this.myPlayerId)
          .map((id) => this.remotePlayers.get(id)?.label.text ?? id);
        this.game.events.emit("bubble:update", this.bubbleMemberNames);
        // M3: add newly joined peers (mesh mode only)
        if (!this.sfuMode && this.mesh && this.myPlayerId) {
          for (const id of msg.members) {
            if (id !== this.myPlayerId) void this.mesh.addPeer(id);
          }
        }
        break;
      }
      case "bubble.leave": {
        if (msg.bubbleId !== this.myBubbleId) break;
        this.myBubbleId = null;
        this.bubbleMemberNames = [];
        this.game.events.emit("bubble:update", []);
        if (this.sfuMode) {
          this.sfu?.leave();
          this.sfuMode = false;
        } else {
          this.mesh?.leaveBubble();
        }
        break;
      }
      // ── M3: P2P RTC relay ───────────────────────────────────────────────────
      case "rtc.offer": {
        void this.mesh?.handleOffer(msg.from, msg.sdp);
        break;
      }
      case "rtc.answer": {
        void this.mesh?.handleAnswer(msg.from, msg.sdp);
        break;
      }
      case "rtc.ice": {
        void this.mesh?.handleIce(msg.from, msg.candidate as RTCIceCandidateInit);
        break;
      }
      // ── M4: SFU switch & signalling ─────────────────────────────────────────
      case "bubble.sfu-switch": {
        this.myBubbleId = msg.bubbleId;
        this.sfuMode = true;
        // Tear down mesh connections
        this.mesh?.leaveBubble();
        // Update member list
        this.bubbleMemberNames = msg.members
          .filter((id) => id !== this.myPlayerId)
          .map((id) => this.remotePlayers.get(id)?.label.text ?? id);
        this.game.events.emit("bubble:update", this.bubbleMemberNames);
        // Join SFU
        if (this.sfu) void this.sfu.join();
        break;
      }
      case "sfu.router-caps": {
        this.sfu?.handleRouterCaps(msg);
        break;
      }
      case "sfu.transport-created": {
        this.sfu?.handleTransportCreated(msg);
        break;
      }
      case "sfu.produced": {
        this.sfu?.handleProduced(msg);
        break;
      }
      case "sfu.producers-list": {
        this.sfu?.handleProducersList(msg);
        break;
      }
      case "sfu.consumed": {
        this.sfu?.handleConsumed(msg);
        break;
      }
      case "sfu.new-producer": {
        void this.sfu?.handleNewProducer(msg);
        break;
      }
      case "sfu.producer-closed": {
        this.sfu?.handleProducerClosed(msg);
        break;
      }
      case "npc.snapshot":
      case "npc.state": {
        // Server-driven wandering NPCs are intentionally ignored: the office
        // program is the local authority on agent presence and movement, and
        // every agent move must correspond to a task, approval, or meeting.
        // TODO(websocket): once the workflow engine runs server-side, map
        // npc.state messages onto program agents here instead.
        break;
      }
      case "room.occupancy": {
        this.game.events.emit("office:occupancy", msg.counts);
        break;
      }
      default: {
        console.warn("[OfficeScene] unhandled message type:", (msg as { type: string }).type);
      }
    }
  }
}
