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

// ─── Room label overlay ────────────────────────────────────────────────────────

type RoomZone = { zone: Phaser.GameObjects.Zone; key: string; label: string };

export class OfficeScene extends Phaser.Scene {
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

  constructor() {
    super({ key: "OfficeScene" });
  }

  // ── preload ─────────────────────────────────────────────────────────────────

  preload() {
    // Room background images
    for (const room of ROOMS) {
      this.load.image(room.key, room.imagePath);
    }

    // Player sprite sheet (Earnest Fundmaker: 32×32 frames, 8 rows × 4–6 frames)
    this.load.spritesheet("earnest", "/assets/fundexecs/characters/earnest-fundmaker/sprite.png", {
      frameWidth: 32,
      frameHeight: 32,
    });
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
    this._setupCamera();
    this._setupInput();
  }

  // ── update ──────────────────────────────────────────────────────────────────

  update() {
    this._handleMovement();
    this._updateRoomLabel();
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
    // Spawn in CEO room center
    const spawnX = ROOM_W / 2;
    const spawnY = ROOM_H / 2;
    this.player = this.physics.add.sprite(spawnX, spawnY, "earnest");
    this.player.setScale(2);
    this.player.setCollideWorldBounds(true);
    this.player.setDepth(10);
    // Physics body slightly smaller than the visual frame
    this.player.setBodySize(20, 20);
    this.player.setOffset(6, 12);

    this.physics.add.collider(this.player, this.walls);
  }

  private _createAnimations() {
    const fps = 8;
    // Sprite sheet is 512×512 at 32px/frame = 16 frames per row
    const FRAMES_PER_ROW = 16;
    const frames = (row: number, count: number) =>
      Array.from({ length: count }, (_, i) => ({ key: "earnest", frame: row * FRAMES_PER_ROW + i }));

    const defs: Array<{ key: string; row: number; frames: number }> = [
      { key: "earnest-idle",      row: ANIM_ROWS.idle,      frames: 4 },
      { key: "earnest-walkDown",  row: ANIM_ROWS.walkDown,  frames: 4 },
      { key: "earnest-walkUp",    row: ANIM_ROWS.walkUp,    frames: 4 },
      { key: "earnest-walkLeft",  row: ANIM_ROWS.walkLeft,  frames: 4 },
      { key: "earnest-walkRight", row: ANIM_ROWS.walkRight, frames: 4 },
    ];

    for (const def of defs) {
      if (!this.anims.exists(def.key)) {
        this.anims.create({
          key: def.key,
          frames: frames(def.row, def.frames),
          frameRate: fps,
          repeat: -1,
        });
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
    if (vx < 0)      this.player.anims.play("earnest-walkLeft",  true);
    else if (vx > 0) this.player.anims.play("earnest-walkRight", true);
    else if (vy < 0) this.player.anims.play("earnest-walkUp",    true);
    else if (vy > 0) this.player.anims.play("earnest-walkDown",  true);
    else             this.player.anims.play("earnest-idle",      true);
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
}
