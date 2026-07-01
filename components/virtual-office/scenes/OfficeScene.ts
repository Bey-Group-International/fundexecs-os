import Phaser from "phaser";
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
} from "../types";
import { VirtualOfficeSocket, type ConnectionStatus } from "../net/VirtualOfficeSocket";
import type { Facing, RemotePlayer, ServerMessage } from "../net/messages";
import { MeshManager } from "../rtc/MeshManager";
import { SfuManager } from "../rtc/SfuManager";
import { executiveCharacters } from "../../characters/characterConfig";
import { spriteFrameMaps } from "../../characters/spriteFrameMap";

// ─── Room label overlay ────────────────────────────────────────────────────────

type RoomZone = { zone: Phaser.GameObjects.Zone; key: string; label: string };

type RemoteAvatarState = {
  sprite: Phaser.Physics.Arcade.Sprite;
  label: Phaser.GameObjects.Text;
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
  if (executiveCharacters.some((c) => c.id === spriteKey && c.spriteSheet)) return "exec";
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
  /** seq number of the last server-acknowledged move for local reconciliation */
  private lastAckedSeq = 0;
  /** velocity at the time each seq was sent, used for reconciliation */
  private pendingMoves = new Map<number, { vx: number; vy: number }>();

  // M1 — HUD
  private netDot!: Phaser.GameObjects.Arc;

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
    // Room background images
    for (const room of ROOMS) {
      this.load.image(room.key, room.imagePath);
    }

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

    this._createRooms();
    this._createWalls();
    this._createPlayer();
    this._createAnimations();
    this._createRoomZones();
    this._createRoomLabel();
    this._createNetDot();
    this._setupCamera();
    this._setupInput();

    // M3/M4: receive local media stream from React wrapper
    this.game.events.on("rtc:localStream", (stream: MediaStream) => {
      this.mesh?.setLocalStream(stream);
      this.sfu?.setLocalStream(stream);
    });
  }

  // ── update ──────────────────────────────────────────────────────────────────

  update() {
    this._handleMovement();
    this._updateRoomLabel();
    this._updateRemoteAvatars();
    this._updateNpcAvatars();
    this._updateSpatialAudio();
  }

  // ── shutdown ─────────────────────────────────────────────────────────────────

  shutdown() {
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

  private _createRooms() {
    for (const room of ROOMS) {
      const x = room.col * ROOM_W + ROOM_W / 2;
      const y = room.row * ROOM_H + ROOM_H / 2;
      const img = this.add.image(x, y, room.key);
      // Scale the pre-rendered room image to fill the room cell
      img.setDisplaySize(ROOM_W, ROOM_H);

      // Subtle room border
      const gfx = this.add.graphics();
      gfx.lineStyle(1, 0x334155, 0.4);
      gfx.strokeRect(room.col * ROOM_W, room.row * ROOM_H, ROOM_W, ROOM_H);

      // Room name label (in-world, small, top-left of room)
      this.add.text(room.col * ROOM_W + 10, room.row * ROOM_H + 10, room.label.toUpperCase(), {
        fontFamily: "monospace",
        fontSize: "9px",
        color: "#e2e8f0",
        stroke: "#0f172a",
        strokeThickness: 2,
      }).setDepth(5);
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
        makeAnims(ch.id, "exec", framesPerRow);
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

  private _createRoomLabel() {
    this.roomLabel = this.add
      .text(0, 0, "", {
        fontFamily: "monospace",
        fontSize: "13px",
        color: "#fbbf24",
        backgroundColor: "#0f172aCC",
        padding: { x: 10, y: 6 },
        stroke: "#0f172a",
        strokeThickness: 1,
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
    cam.startFollow(this.player, true, 0.1, 0.1);
    cam.setZoom(1.5);
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
    }
  }

  // ── Multiplayer: remote avatar rendering ────────────────────────────────────

  private _updateRemoteAvatars() {
    for (const [, state] of this.remotePlayers) {
      state.sprite.x = Phaser.Math.Linear(state.sprite.x, state.targetX, 0.15);
      state.sprite.y = Phaser.Math.Linear(state.sprite.y, state.targetY, 0.15);
      state.label.setPosition(state.sprite.x, state.sprite.y - 28);
    }
  }

  private _updateNpcAvatars() {
    for (const [, state] of this.npcAvatars) {
      state.sprite.x = Phaser.Math.Linear(state.sprite.x, state.targetX, 0.12);
      state.sprite.y = Phaser.Math.Linear(state.sprite.y, state.targetY, 0.12);
      state.label.setPosition(state.sprite.x, state.sprite.y - 28);
    }
  }

  private _spawnNpc(npcId: string, x: number, y: number, facing: Facing, spriteKey: string, name: string) {
    if (this.npcAvatars.has(npcId)) return;
    const textureKey = this._textureKeyForCharacter(spriteKey);
    const frameMap = spriteFrameMaps[this._frameMapKindForCharacter(spriteKey)];
    const sprite = this.add.sprite(x, y, textureKey);
    sprite.setScale(frameMap.scale);
    sprite.setDepth(8);
    sprite.anims.play(facingToAnimKey(facing, spriteKey), true);

    const label = this.add.text(x, y - 28, name, {
      fontFamily: "monospace",
      fontSize: "8px",
      color: "#fbbf24",
      stroke: "#0f172a",
      strokeThickness: 2,
    }).setOrigin(0.5, 1).setDepth(9);

    this.npcAvatars.set(npcId, { sprite, label, targetX: x, targetY: y, facing, spriteKey });
  }

  private _updateNpcState(npcId: string, x: number, y: number, facing: Facing, spriteKey: string) {
    const state = this.npcAvatars.get(npcId);
    if (!state) return;
    state.targetX = x;
    state.targetY = y;
    if (state.facing !== facing) {
      state.facing = facing;
      state.sprite.anims.play(facingToAnimKey(facing, spriteKey), true);
    }
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

    sprite.anims.play(facingToAnimKey(remote.facing, spriteKey), true);

    this.remotePlayers.set(remote.id, {
      sprite,
      label,
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
      case "npc.snapshot": {
        for (const npc of msg.npcs) {
          this._spawnNpc(npc.npcId, npc.x, npc.y, npc.facing, npc.spriteKey, npc.name);
        }
        break;
      }
      case "npc.state": {
        if (!this.npcAvatars.has(msg.npcId)) {
          this._spawnNpc(msg.npcId, msg.x, msg.y, msg.facing, msg.spriteKey, msg.name);
        } else {
          this._updateNpcState(msg.npcId, msg.x, msg.y, msg.facing, msg.spriteKey);
        }
        break;
      }
    }
  }
}
