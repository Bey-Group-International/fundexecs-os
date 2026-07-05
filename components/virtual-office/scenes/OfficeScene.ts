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

// ─── Room label overlay ────────────────────────────────────────────────────────

type RoomZone = { zone: Phaser.GameObjects.Zone; key: string; label: string };

type RemoteAvatarState = {
  sprite: Phaser.Physics.Arcade.Sprite;
  label: Phaser.GameObjects.Text;
  nameTag: Phaser.GameObjects.Graphics;
  targetX: number;
  targetY: number;
  facing: Facing;
  spriteKey: string;
};

type NpcAvatarState = {
  sprite: Phaser.GameObjects.Sprite;
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
  /** Soft glow ring under the avatar — the AI-native visual cue. */
  aura: Phaser.GameObjects.Arc;
  /** Active waypoint path when the agent is walking to a room. */
  path: Array<{ x: number; y: number }>;
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

// ─── Scene ────────────────────────────────────────────────────────────────────

export class OfficeScene extends Phaser.Scene {
  // M0 properties
  private player!: Phaser.Physics.Arcade.Sprite;
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
  // M5 — character identity
  private myCharacterId = "player_default";
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
  private interactives: Array<{ obj: InteractiveObject; wx: number; wy: number }> = [];
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

  // ── Office-program layer ──
  /** Room activation overlays (glow + task badge), created lazily per room. */
  private roomOverlays = new Map<string, RoomOverlay>();
  /** Which agents currently occupy each room, for slot placement. */
  private roomAgentSlots = new Map<string, AgentId[]>();

  constructor() {
    super({ key: "OfficeScene" });
  }

  // ── init ────────────────────────────────────────────────────────────────────

  init(data: OfficeSceneInitData) {
    if (data?.characterId) this.myCharacterId = data.characterId;
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
    this.physics.world.setBounds(0, 0, WORLD_W, WORLD_H);

    this._createTilemap();
    this._createWalls();
    this._createPlayer();
    this._createAnimations();
    this._createRoomZones();
    this._createRoomLabel();
    this._createNetDot();
    this._setupCamera();
    this._setupInput();
    this._spawnProgramAgents();
    this._setupProgramBridge();
    this._setupPointerTeleport();
    this._createMinimap();
    this._createInteractives();
    this._setupEmotes();
    this._setupFollowMode();

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

    // M5c: teleport to a room by key
    this.game.events.on("office:teleport", (roomKey: string) => {
      const room = ROOMS.find((r) => r.key === roomKey);
      if (!room) return;
      const tx = room.col * ROOM_W + ROOM_W / 2;
      const ty = room.row * ROOM_H + ROOM_H / 2;
      this.player.setPosition(tx, ty);
      this._cancelWalk();
      this.game.canvas.focus();
    });
  }

  // ── update ──────────────────────────────────────────────────────────────────

  update(_time: number, delta: number) {
    this._updateFollowMode(delta);
    this._handleMovement();
    this._updateInteractives();
    this._updateEmotes(delta);
    this._updateRoomLabel();
    this._updateIframeZones();
    this._updateRemoteAvatars();
    this._updateNpcAvatars(delta);
    this._updateSpatialAudio();
    this._updateMinimap();

    this._interpFrame = (this._interpFrame + 1) % 2;
  }

  // ── shutdown ─────────────────────────────────────────────────────────────────

  shutdown() {
    this.game.events.off("office:teleport");
    this.game.events.off("office:teleport-room");
    this.game.events.off("office:emote");
    this.game.events.off("office:zone-config");
    this.game.events.off("rtc:localStream");
    this.game.events.off("program:npc-goto");
    this.game.events.off("program:npc-state");
    this.game.events.off("program:room-activity");
    this.game.events.off("program:handoff");
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
  }

  // ── private helpers ─────────────────────────────────────────────────────────

  private _createTilemap() {
    const map = this.make.tilemap({ key: "office-world" });
    const tileset = map.addTilesetImage("office-tiles", "office-tiles");
    if (!tileset) return;

    // Render floor and decor tile layers beneath everything
    map.createLayer("floor", tileset, 0, 0)?.setDepth(0);
    map.createLayer("decor", tileset, 0, 0)?.setDepth(1);

    // Room borders and name labels on top of tiles
    for (const room of ROOMS) {
      // Subtle gold room border
      const gfx = this.add.graphics().setDepth(2);
      gfx.lineStyle(1.5, 0xc9a84c, 0.25);
      gfx.strokeRect(room.col * ROOM_W + 2, room.row * ROOM_H + 2, ROOM_W - 4, ROOM_H - 4);

      // Professional room label — pill badge bottom-left of room
      const lx = room.col * ROOM_W + 10;
      const ly = room.row * ROOM_H + ROOM_H - 24;
      const label = this.add.text(lx + 6, ly + 3, room.label.toUpperCase(), {
        fontFamily: "'Georgia','Times New Roman',serif",
        fontSize: "8px",
        color: "#c9a84c",
        letterSpacing: 2,
      }).setDepth(4).setAlpha(0.9);
      const bg = this.add.graphics().setDepth(3);
      bg.fillStyle(0x0f172a, 0.72);
      bg.fillRoundedRect(lx, ly, label.width + 12, 18, 4);
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

    this.physics.add.collider(this.player, this.walls);
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

    // Keyboard input always overrides click-to-walk and follow-mode
    if (up || down || left || right) { this._cancelWalk(); this._cancelFollow(); }
    else if (this._followWalkPath()) return;

    let vx = 0;
    let vy = 0;

    if (left)  vx -= PLAYER_SPEED;
    if (right) vx += PLAYER_SPEED;
    if (up)    vy -= PLAYER_SPEED;
    if (down)  vy += PLAYER_SPEED;

    // Normalize diagonal
    if (vx !== 0 && vy !== 0) {
      vx *= 0.707;
      vy *= 0.707;
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
    // Interpolate every other frame — server sends at ~10 Hz so 30 Hz is plenty
    if (this._interpFrame !== 0) return;
    for (const [, state] of this.remotePlayers) {
      state.sprite.x = Phaser.Math.Linear(state.sprite.x, state.targetX, 0.3);
      state.sprite.y = Phaser.Math.Linear(state.sprite.y, state.targetY, 0.3);
      state.label.setPosition(state.sprite.x, state.sprite.y - 28);
      state.nameTag.setPosition(state.sprite.x, state.sprite.y - 40);
    }
  }

  private static readonly NPC_SPEED = 105; // px/s — purposeful executive pace

  /**
   * Program agents walk waypoint paths issued by the office program
   * (task routing, meetings, approvals). Movement is never random.
   */
  private _updateNpcAvatars(delta: number) {
    const step = (OfficeScene.NPC_SPEED * delta) / 1000;
    for (const [, state] of this.npcAvatars) {
      if (state.path.length > 0) {
        const next = state.path[0];
        const dx = next.x - state.sprite.x;
        const dy = next.y - state.sprite.y;
        const dist = Math.hypot(dx, dy);
        if (dist <= step) {
          state.sprite.setPosition(next.x, next.y);
          state.path.shift();
          if (state.path.length === 0) {
            state.sprite.anims.play(facingToAnimKey("idle", state.spriteKey), true);
            state.facing = "idle" as Facing;
          }
        } else {
          state.sprite.x += (dx / dist) * step;
          state.sprite.y += (dy / dist) * step;
          const facing: Facing = Math.abs(dx) > Math.abs(dy)
            ? (dx < 0 ? "left" : "right")
            : (dy < 0 ? "up" : "down");
          if (state.facing !== facing) {
            state.facing = facing;
            state.sprite.anims.play(facingToAnimKey(facing, state.spriteKey), true);
          }
        }
      } else if (state.targetX !== state.sprite.x || state.targetY !== state.sprite.y) {
        // Legacy lerp target (kept for future server-driven agents).
        state.sprite.x = Phaser.Math.Linear(state.sprite.x, state.targetX, 0.24);
        state.sprite.y = Phaser.Math.Linear(state.sprite.y, state.targetY, 0.24);
      }
      state.label.setPosition(state.sprite.x, state.sprite.y - 30);
      state.statusText.setPosition(state.sprite.x, state.sprite.y - 22);
      state.aura.setPosition(state.sprite.x, state.sprite.y + 10);
    }
  }

  // ── Office-program bridge — NPC reactivity, room activation, handoffs ──────

  private _setupProgramBridge() {
    // Agent walks to a room with purpose (task assignment / approval / return).
    this.game.events.on("program:npc-goto", (agentId: AgentId, roomKey: RoomKey) => {
      const npc = this.npcAvatars.get(`agent:${agentId}`);
      if (!npc) return;
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
        this._applyAgentAura(npc, state);
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
  }

  /** Compact status text for the floor label (full text lives in the panel). */
  private _shortStatus(state: AgentState, label: string): string {
    if (state === "idle") return "";
    const max = 26;
    return label.length > max ? `${label.slice(0, max - 1)}…` : label;
  }

  private _applyAgentAura(npc: NpcAvatarState, state: AgentState) {
    const colors: Partial<Record<AgentState, number>> = {
      classifying: 0xfbbf24,
      listening: 0xfbbf24,
      assigned: 0xc9a84c,
      moving: 0xc9a84c,
      working: 0x38bdf8,
      collaborating: 0x38bdf8,
      reviewing: 0xa855f7,
      waiting_for_approval: 0xf59e0b,
      complete: 0x22c55e,
      blocked: 0xef4444,
    };
    const color = colors[state];
    this.tweens.killTweensOf(npc.aura);
    if (!color) {
      npc.aura.setVisible(false);
      return;
    }
    npc.aura.setVisible(true);
    npc.aura.setStrokeStyle(1.5, color, 0.85);
    npc.aura.setFillStyle(color, 0.08);
    npc.aura.setScale(1);
    npc.aura.setAlpha(1);
    // Work pulse — only while actively engaged, per the "glow when active" rule
    if (state === "working" || state === "classifying" || state === "waiting_for_approval") {
      this.tweens.add({
        targets: npc.aura,
        scale: 1.25,
        alpha: 0.55,
        duration: 850,
        yoyo: true,
        repeat: -1,
        ease: "Sine.easeInOut",
      });
    }
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
    overlay.glow.lineStyle(2, tierColor, 0.5);
    overlay.glow.strokeRect(rx, ry, ROOM_W - 6, ROOM_H - 6);
    overlay.glow.setAlpha(1);
    this.tweens.add({
      targets: overlay.glow, alpha: 0.45, duration: 1300, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
    });

    const tierShort = tier ? RISK_TIERS[tier].short : "";
    overlay.badge.setText(`● ${taskCount} ACTIVE${tierShort ? ` · ${tierShort}` : ""}`);
    overlay.badge.setColor(tier ? RISK_TIERS[tier].color : "#c9a84c");
    const bx = room.col * ROOM_W + ROOM_W - overlay.badge.width - 16;
    const by = room.row * ROOM_H + 8;
    overlay.badge.setPosition(bx + 5, by + 3).setVisible(true);
    overlay.badgeBg.fillStyle(0x0a0806, 0.82);
    overlay.badgeBg.fillRoundedRect(bx, by, overlay.badge.width + 10, 15, 3);
  }

  /** Gold task card tween — the visible delegation from Earn to an agent. */
  private _animateTaskHandoff(fromX: number, fromY: number, toX: number, toY: number) {
    const card = this.add.graphics().setDepth(14);
    card.fillStyle(0xc9a84c, 0.95);
    card.fillRoundedRect(-5, -3.5, 10, 7, 1.5);
    card.lineStyle(0.5, 0x0a0806, 0.9);
    card.strokeRoundedRect(-5, -3.5, 10, 7, 1.5);
    card.setPosition(fromX, fromY);
    this.tweens.add({
      targets: card,
      x: toX,
      y: toY,
      duration: 620,
      ease: "Cubic.easeInOut",
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
      this.interactives.push({ obj, wx, wy });

      // Subtle pulsing gold diamond marks the hotspot
      const marker = this.add.text(wx, wy - 20, obj.icon, {
        fontFamily: "monospace",
        fontSize: "10px",
        color: "#c9a84c",
      }).setOrigin(0.5, 0.5).setDepth(7).setAlpha(0.7);
      this.tweens.add({
        targets: marker, y: wy - 24, alpha: 0.35,
        duration: 1200, yoyo: true, repeat: -1, ease: "Sine.easeInOut",
      });
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

  private _updateInteractives() {
    let nearest: InteractiveObject | null = null;
    let bestDist = OfficeScene.INTERACT_RADIUS;
    for (const { obj, wx, wy } of this.interactives) {
      const d = Phaser.Math.Distance.Between(this.player.x, this.player.y, wx, wy);
      if (d < bestDist) { bestDist = d; nearest = obj; }
    }
    if (nearest !== this.nearestInteractive) {
      this.nearestInteractive = nearest;
      if (nearest) {
        this.interactPrompt.setText(`${nearest.icon}  Press X — ${nearest.label}`);
        const cam = this.cameras.main;
        this.interactPrompt.setPosition(
          cam.width / 2 - this.interactPrompt.width / 2,
          cam.height - 44,
        );
        this.interactPrompt.setVisible(true);
      } else {
        this.interactPrompt.setVisible(false);
      }
    }
    if (this.nearestInteractive && Phaser.Input.Keyboard.JustDown(this.keyX)) {
      this.game.events.emit("office:interact", this.nearestInteractive);
      this._showEmote(this.player.x, this.player.y, "✦");
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
    // their state is communicated by aura + status label instead.
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
    }).setOrigin(0.5, 1).setDepth(15).setScale(0.4);
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
    this.walkPath = this._findPath(this.player.x, this.player.y, wx, wy);
    if (this.walkPath.length === 0) return;
    // Destination marker — gold pulse ring that fades
    this.walkMarker?.destroy();
    this.walkMarker = this.add.arc(wx, wy, 8, 0, 360, false).setStrokeStyle(1.5, 0xc9a84c, 0.9).setDepth(7);
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
      const pos = this._claimRoomSlot(agent.id, agent.homeRoom);
      this._spawnNpc(`agent:${agent.id}`, pos.x, pos.y, "down", agent.spriteKey, agent.name, agent.id);
    }
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
    const textureKey = this._textureKeyForCharacter(spriteKey);
    const frameMap = spriteFrameMaps[this._frameMapKindForCharacter(spriteKey)];
    const sprite = this.add.sprite(x, y, textureKey);
    sprite.setScale(frameMap.scale);
    sprite.setDepth(8);
    sprite.anims.play(facingToAnimKey(facing, spriteKey), true);

    // Make NPC clickable — emits npc:click so the React layer can open AI chat
    sprite.setInteractive({ useHandCursor: true });
    sprite.on("pointerdown", () => {
      this.game.events.emit("npc:click", { npcId, spriteKey, name });
    });
    sprite.on("pointerover", () => {
      sprite.setTint(0xffffff);
      // Subtle highlight: slightly brighten
      sprite.setAlpha(0.85);
    });
    sprite.on("pointerout", () => {
      sprite.clearTint();
      sprite.setAlpha(1);
    });

    const accent = agentId ? AGENT_BY_ID[agentId].accent : "#fbbf24";
    const label = this.add.text(x, y - 30, name, {
      fontFamily: "monospace",
      fontSize: "8px",
      color: accent,
      stroke: "#0f172a",
      strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(9);

    // Executive status line under the name — updated by the program layer
    const statusText = this.add.text(x, y - 22, "", {
      fontFamily: "monospace",
      fontSize: "6px",
      color: "#cbd5e1",
      stroke: "#0f172a",
      strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(9);

    // AI-native glow ring at the agent's feet; hidden while idle
    const aura = this.add.arc(x, y + 10, 11, 0, 360, false)
      .setStrokeStyle(1.5, 0xc9a84c, 0.85)
      .setFillStyle(0xc9a84c, 0.08)
      .setDepth(7)
      .setVisible(false);

    this.npcAvatars.set(npcId, {
      sprite, label, targetX: x, targetY: y, facing, spriteKey,
      agentId, programState: "idle", statusText, aura, path: [],
    });
  }

  private _updateSpatialAudio() {
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
    }
  }

  private _spawnRemotePlayer(remote: RemotePlayer) {
    if (remote.id === this.myPlayerId) return;
    if (this.remotePlayers.has(remote.id)) return;

    const spriteKey = remote.spriteKey ?? "player_default";
    const textureKey = this._textureKeyForCharacter(spriteKey);
    const frameMap = spriteFrameMaps[this._frameMapKindForCharacter(spriteKey)];

    const sprite = this.physics.add.sprite(remote.x, remote.y, textureKey);
    sprite.setScale(frameMap.scale);
    sprite.setDepth(9);
    sprite.setBodySize(20, 20);
    sprite.setOffset(6, 12);

    // Only tint unknown players; identified executives render with their own colours
    const isIdentified = executiveCharacters.some((c) => c.id === spriteKey && c.spriteSheet);
    if (!isIdentified) {
      const hue = playerIdToHue(remote.id);
      const color = Phaser.Display.Color.HSVColorWheel()[Math.round(hue / 360 * 359)];
      sprite.setTint(color.color);
    }

    this.physics.add.collider(sprite, this.walls);

    const label = this.add.text(remote.x, remote.y - 28, remote.name, {
      fontFamily: "monospace",
      fontSize: "8px",
      color: "#e2e8f0",
      stroke: "#0f172a",
      strokeThickness: 2,
    })
      .setOrigin(0.5, 1)
      .setDepth(11);

    // Small colored avatar dot above the name tag
    const hue = playerIdToHue(remote.id);
    const dotColor = Phaser.Display.Color.HSVColorWheel()[Math.round(hue / 360 * 359)].color;
    const nameTag = this.add.graphics().setDepth(12);
    nameTag.fillStyle(dotColor, 1);
    nameTag.fillCircle(0, 0, 5);
    nameTag.lineStyle(1, 0x0f172a, 0.8);
    nameTag.strokeCircle(0, 0, 5);

    sprite.anims.play(facingToAnimKey(remote.facing, spriteKey), true);

    this.remotePlayers.set(remote.id, {
      sprite,
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
