/**
 * FundExecs OS — Three.js native-browser 3D renderer.
 *
 * A WORKING `OfficeRenderer` (no longer a scaffold): it renders the virtual
 * office in real 3D on the client GPU via Three.js/WebGL — no cloud GPU, no
 * external engine. This is the "recreate the cloud-render fidelity natively"
 * path: rooms, door-split partition walls, desks, and avatars are all built
 * from the SAME 2D office data (`ROOMS` / walls / `WORKSTATIONS`) the Phaser
 * floor reads, projected onto the X-Z plane by `officeGeometry3D`, so the two
 * renderers stay congruent.
 *
 * Static world geometry (walls, desks) is drawn with `InstancedMesh` — one draw
 * call for all walls and one for all desks. Avatars are a small pool of grouped
 * meshes (body + head + name label) keyed by actor id. Picking is a `Raycaster`
 * against the avatar bodies then the floor plane. The renderer self-drives its
 * own `requestAnimationFrame` loop (camera easing, position lerp, idle bob), so
 * the interface `update()` is a no-op — callers need not pump it.
 *
 * SSR-safe: importing this module touches no DOM; WebGL/`document` are used
 * only inside `mount()`.
 */

import * as THREE from "three";
import type {
  ActorClickHandler,
  ActorFacing,
  ActorSpec,
  FloorClickHandler,
  OfficeRenderer,
} from "./OfficeRenderer";
import type { AgentState, RoomKey } from "../program/officeProgram";
import {
  floorCenter,
  floorSize,
  pixelsOf,
  roomAccentHex,
  roomCenterWorld,
  roomFloors,
  roomLabelAnchors,
  wallSegments,
  worldOf,
  yawOf,
  type Box3D,
} from "./officeGeometry3D";
import { officeFurniture3D, officeLampGlows, type FurnitureBox } from "./officeFurniture3D";
import { resolveClip, type AvatarClip } from "./avatarAnimation3D";
import {
  characterSpriteFor,
  frameIndexAt,
  spriteAnimationState,
  type CharacterSprite,
} from "./avatarSprite3D";

/** Per-actor scene handles + interpolation state. */
interface ActorHandle {
  spec: ActorSpec;
  group: THREE.Group;
  body: THREE.Mesh;
  bodyMat: THREE.MeshStandardMaterial;
  label: THREE.Sprite | null;
  facing: ActorFacing;
  state: AgentState;
  seated: boolean;
  /**
   * Current animation clip resolved from state+seated. With today's procedural
   * capsule avatar it is metadata; once a rigged glTF is loaded, the render
   * loop cross-fades an `AnimationMixer` to this clip (see avatarAnimation3D).
   */
  clip: AvatarClip;
  /** Target floor position (world units); the group lerps toward it. */
  target: { x: number; z: number };
  /** Idle-bob phase so figures don't all bob in lockstep. */
  bob: number;
  /**
   * Billboard character sprite (2.5D), when this actor maps to a character
   * sheet. Null for the capsule fallback (user / remote / sheet-less agents).
   */
  sprite: THREE.Sprite | null;
  spriteTex: THREE.Texture | null;
  charSprite: CharacterSprite | null;
  /** Sheet grid, learned once the texture image loads. */
  sheetCols: number;
  sheetRows: number;
  /** Elapsed ms feeding the sprite frame cycle. */
  animMs: number;
}

/** Emissive accent per program state, so an actor's activity reads at a glance. */
const STATE_EMISSIVE: Partial<Record<AgentState, number>> = {
  idle: 0x000000,
  listening: 0x1e3a5f,
  classifying: 0x3b2f6b,
  assigned: 0x264a6b,
  moving: 0x1f4d55,
  working: 0x14532d,
  collaborating: 0x155e63,
  waiting_for_approval: 0x5b1d1d,
  reviewing: 0x7c5312,
  complete: 0x2f6b3f,
  blocked: 0x6b1d1d,
};

const BODY_HEIGHT = 1.15; // world units (~ a person against 9-unit-tall rooms)
const BODY_RADIUS = 0.32;
const HEAD_RADIUS = 0.26;
const SEATED_DROP = 0.32; // lower the figure when seated at a desk

export class ThreeOfficeRenderer implements OfficeRenderer {
  private scene: THREE.Scene | null = null;
  private camera: THREE.PerspectiveCamera | null = null;
  private renderer: THREE.WebGLRenderer | null = null;
  private raycaster = new THREE.Raycaster();
  private container: HTMLElement | null = null;
  private resizeObserver: ResizeObserver | null = null;
  private rafId = 0;
  private lastTime = 0;

  /** Static-world instanced pools + the pickable floor plane. */
  private wallMesh: THREE.InstancedMesh | null = null;
  private floorPlane: THREE.Mesh | null = null;
  private readonly disposables: Array<{ dispose(): void }> = [];

  private readonly actors = new Map<string, ActorHandle>();
  private readonly bodyToActor = new Map<THREE.Object3D, string>();

  private actorClick: ActorClickHandler | null = null;
  private floorClick: FloorClickHandler | null = null;

  /** Camera easing state: where it looks, and its offset above/behind. */
  private camLook = { x: 0, z: 0 };
  private camLookTarget = { x: 0, z: 0 };
  private followId: string | null = null;
  // Steep near-top-down 2.5D framing, echoing the 2D office's isometric view.
  private readonly camHeight = 27;
  private readonly camDist = 9;

  private readonly onPointerDown = (ev: PointerEvent) => this.handlePointer(ev);

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  async mount(container: HTMLElement): Promise<void> {
    if (typeof document === "undefined") {
      throw new Error("ThreeOfficeRenderer requires a browser environment.");
    }
    this.container = container;
    const width = container.clientWidth || 1;
    const height = container.clientHeight || 1;

    const renderer = new THREE.WebGLRenderer({ antialias: true });
    renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
    renderer.setSize(width, height);
    renderer.shadowMap.enabled = false;
    container.appendChild(renderer.domElement);
    this.renderer = renderer;

    const scene = new THREE.Scene();
    scene.background = new THREE.Color(0x0b0e14);
    this.scene = scene;

    const camera = new THREE.PerspectiveCamera(50, width / height, 0.1, 2000);
    this.camera = camera;

    // Lighting: soft hemisphere fill + a warm gold key, echoing the 2D floor's
    // "light from above" gold key light.
    scene.add(new THREE.HemisphereLight(0xbcc6dc, 0x140f0a, 0.85));
    // Warm gold key from above, echoing the 2D office's light-from-above.
    const key = new THREE.DirectionalLight(0xffe0a8, 1.35);
    key.position.set(6, 24, 8);
    scene.add(key);
    // Cool fill from the opposite side softens the shadows the key casts.
    const fill = new THREE.DirectionalLight(0x9fb4d6, 0.3);
    fill.position.set(-8, 12, -6);
    scene.add(fill);
    scene.add(new THREE.AmbientLight(0x4a4034, 0.6));

    this.buildStaticIfReady();

    // Frame the whole floor to start.
    const c = floorCenter();
    this.camLook = { ...c };
    this.camLookTarget = { ...c };

    // Pointer picking + responsive resize.
    renderer.domElement.addEventListener("pointerdown", this.onPointerDown);
    this.resizeObserver = new ResizeObserver(() => this.resize());
    this.resizeObserver.observe(container);

    this.lastTime = performance.now();
    this.loop();
  }

  destroy(): void {
    cancelAnimationFrame(this.rafId);
    this.rafId = 0;
    this.resizeObserver?.disconnect();
    this.resizeObserver = null;
    this.renderer?.domElement.removeEventListener("pointerdown", this.onPointerDown);

    for (const actor of this.actors.values()) this.disposeActor(actor);
    this.actors.clear();
    this.bodyToActor.clear();

    for (const d of this.disposables) d.dispose();
    this.disposables.length = 0;
    this.wallMesh = null;
    this.floorPlane = null;

    if (this.renderer) {
      this.renderer.dispose();
      this.renderer.domElement.remove();
      this.renderer = null;
    }
    this.scene = null;
    this.camera = null;
    this.container = null;
  }

  update(_deltaMs: number): void {
    // No-op: the renderer self-drives its own RAF loop (see `loop`), so callers
    // do not need to pump frames. Kept to satisfy the interface.
    void _deltaMs;
  }

  // ── World ─────────────────────────────────────────────────────────────────

  buildFloor(): void {
    // Static world is built in `mount` once the scene exists; if `buildFloor`
    // is called before mount (unusual), this defers to `buildStaticIfReady`.
    this.buildStaticIfReady();
  }

  focusRoom(roomKey: RoomKey): void {
    const c = roomCenterWorld(roomKey);
    if (!c) return;
    this.followId = null;
    this.camLookTarget = { x: c.x, z: c.z };
  }

  follow(actorId: string | null): void {
    this.followId = actorId;
    if (!actorId) {
      const c = floorCenter();
      this.camLookTarget = { ...c };
    }
  }

  // ── Actors ────────────────────────────────────────────────────────────────

  addActor(spec: ActorSpec): void {
    if (!this.scene || this.actors.has(spec.id)) return;
    // Role accent drives the body color; fall back to the gold house accent.
    const accent = new THREE.Color(spec.accent ?? roomAccentHex("__default__"));

    const group = new THREE.Group();
    const w = worldOf(spec.x, spec.y);
    group.position.set(w.x, 0, w.z);
    group.rotation.y = yawOf(spec.facing);

    const bodyGeo = new THREE.CapsuleGeometry(BODY_RADIUS, BODY_HEIGHT - BODY_RADIUS * 2, 4, 12);
    const bodyMat = new THREE.MeshStandardMaterial({
      color: accent,
      roughness: 0.55,
      metalness: 0.1,
      emissive: new THREE.Color(STATE_EMISSIVE[spec.state ?? "idle"] ?? 0x000000),
      emissiveIntensity: 0.9,
    });
    const body = new THREE.Mesh(bodyGeo, bodyMat);
    body.position.y = BODY_HEIGHT / 2;
    body.userData.actorId = spec.id;
    group.add(body);
    this.bodyToActor.set(body, spec.id);

    const headGeo = new THREE.SphereGeometry(HEAD_RADIUS, 16, 12);
    const headMat = new THREE.MeshStandardMaterial({ color: 0xe8d6b8, roughness: 0.7 });
    const head = new THREE.Mesh(headGeo, headMat);
    head.position.y = BODY_HEIGHT + HEAD_RADIUS * 0.6;
    head.userData.actorId = spec.id;
    group.add(head);
    this.bodyToActor.set(head, spec.id);

    const label = this.makeLabel(spec.name);
    if (label) {
      label.position.y = BODY_HEIGHT + HEAD_RADIUS * 2.2 + 0.35;
      group.add(label);
    }

    this.scene.add(group);
    this.disposables.push(bodyGeo, bodyMat, headGeo, headMat);

    const handle: ActorHandle = {
      spec,
      group,
      body,
      bodyMat,
      label,
      facing: spec.facing,
      state: spec.state ?? "idle",
      seated: spec.seated ?? false,
      clip: resolveClip(spec.state ?? "idle", { seated: spec.seated ?? false }),
      target: { x: w.x, z: w.z },
      bob: Math.abs((spec.x * 13 + spec.y * 7) % 6.28),
      sprite: null,
      spriteTex: null,
      charSprite: null,
      sheetCols: 1,
      sheetRows: 1,
      animMs: 0,
    };

    // If this actor maps to a character sprite sheet, draw it as a billboard
    // (2.5D) and hide the capsule fallback — this brings the real executives
    // and NPCs into the 3D office using the existing sprite art.
    const charSprite = characterSpriteFor(spec.spriteKey);
    if (charSprite) {
      const tex = new THREE.TextureLoader().load(charSprite.sheetUrl, (loaded) => {
        const img = loaded.image as { width?: number; height?: number } | undefined;
        if (img?.width && img?.height) {
          handle.sheetCols = Math.max(1, Math.round(img.width / charSprite.frameWidth));
          handle.sheetRows = Math.max(1, Math.round(img.height / charSprite.frameHeight));
          loaded.repeat.set(1 / handle.sheetCols, 1 / handle.sheetRows);
          loaded.needsUpdate = true;
        }
      });
      tex.magFilter = THREE.NearestFilter;
      tex.minFilter = THREE.NearestFilter;
      tex.colorSpace = THREE.SRGBColorSpace;
      const spriteMat = new THREE.SpriteMaterial({ map: tex, transparent: true });
      const sprite = new THREE.Sprite(spriteMat);
      const spriteH = 2.7;
      sprite.scale.set(spriteH * (charSprite.frameWidth / charSprite.frameHeight), spriteH, 1);
      sprite.position.y = spriteH / 2;
      sprite.userData.actorId = spec.id;
      group.add(sprite);
      this.bodyToActor.set(sprite, spec.id);
      body.visible = false;
      head.visible = false;
      this.disposables.push(tex, spriteMat);

      handle.sprite = sprite;
      handle.spriteTex = tex;
      handle.charSprite = charSprite;
    }

    this.applySeated(handle);
    this.actors.set(spec.id, handle);
  }

  removeActor(id: string): void {
    const handle = this.actors.get(id);
    if (!handle) return;
    this.scene?.remove(handle.group);
    this.disposeActor(handle);
    this.actors.delete(id);
  }

  moveActor(id: string, x: number, y: number): void {
    const handle = this.actors.get(id);
    if (!handle) return;
    handle.target = worldOf(x, y); // lerped toward in the loop
  }

  setActorFacing(id: string, facing: ActorFacing): void {
    const handle = this.actors.get(id);
    if (handle) handle.facing = facing;
  }

  setActorState(id: string, state: AgentState): void {
    const handle = this.actors.get(id);
    if (!handle) return;
    handle.state = state;
    handle.bodyMat.emissive.setHex(STATE_EMISSIVE[state] ?? 0x000000);
    handle.clip = resolveClip(state, { seated: handle.seated });
  }

  setActorSeated(id: string, seated: boolean): void {
    const handle = this.actors.get(id);
    if (!handle) return;
    handle.seated = seated;
    this.applySeated(handle);
    handle.clip = resolveClip(handle.state, { seated });
  }

  // ── Interaction ───────────────────────────────────────────────────────────

  onActorClick(cb: ActorClickHandler): void {
    this.actorClick = cb;
  }

  onFloorClick(cb: FloorClickHandler): void {
    this.floorClick = cb;
  }

  // ── Internal: static world ──────────────────────────────────────────────────

  private buildStaticIfReady(): void {
    if (!this.scene || this.floorPlane) return; // build once
    const scene = this.scene;
    const { width, depth } = floorSize();
    const c = floorCenter();

    // Floor plane (pickable for click-to-walk).
    const floorGeo = new THREE.PlaneGeometry(width, depth);
    // Warm charcoal base, echoing the 2D office's warm-lit wood floors.
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x1a1613, roughness: 0.92 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(c.x, 0, c.z);
    scene.add(floor);
    this.floorPlane = floor;
    this.disposables.push(floorGeo, floorMat);

    // Per-room floor, built procedurally (no room-image textures): a department
    // wash over the whole room, plus a bordered central rug — mirroring the 2D
    // office's drawn rugs. Furniture sits on top of this.
    for (const { roomKey, box } of roomFloors()) {
      const accent = new THREE.Color(roomAccentHex(roomKey));

      const tintGeo = new THREE.PlaneGeometry(box.width, box.depth);
      const tintMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.1 });
      const tint = new THREE.Mesh(tintGeo, tintMat);
      tint.rotation.x = -Math.PI / 2;
      tint.position.set(box.cx, 0.01, box.cz);
      scene.add(tint);
      this.disposables.push(tintGeo, tintMat);

      // Rug: a stronger accent runner with a lighter inset border.
      const rugGeo = new THREE.PlaneGeometry(box.width * 0.44, box.depth * 0.42);
      const rugMat = new THREE.MeshBasicMaterial({ color: accent, transparent: true, opacity: 0.22 });
      const rug = new THREE.Mesh(rugGeo, rugMat);
      rug.rotation.x = -Math.PI / 2;
      rug.position.set(box.cx, 0.02, box.cz);
      scene.add(rug);
      this.disposables.push(rugGeo, rugMat);
    }

    // Warm floor glow pools under each lamp — the soft light spill of the 2D
    // office, as additive accent discs on the floor.
    for (const g of officeLampGlows()) {
      const geo = new THREE.CircleGeometry(g.radius, 24);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(g.color),
        transparent: true,
        opacity: 0.14,
        blending: THREE.AdditiveBlending,
        depthWrite: false,
      });
      const disc = new THREE.Mesh(geo, mat);
      disc.rotation.x = -Math.PI / 2;
      disc.position.set(g.x, 0.03, g.z);
      scene.add(disc);
      this.disposables.push(geo, mat);
    }

    // Walls (one instanced draw call) + the full per-room furniture set.
    this.wallMesh = this.buildInstancedBoxes(wallSegments(), 0x2b3242, 0.85);
    this.buildFurniture(officeFurniture3D());

    // Per-room polish: a floating department sign + a warm accent point light,
    // so each room reads as its department at a glance.
    for (const anchor of roomLabelAnchors()) {
      const accentHex = roomAccentHex(anchor.roomKey);
      const glow = new THREE.PointLight(new THREE.Color(accentHex), 0.28, 9, 2);
      glow.position.set(anchor.x, 3, anchor.z);
      scene.add(glow);
      const sign = this.makeRoomSign(anchor.label, accentHex);
      if (sign) {
        sign.position.set(anchor.x, 4.4, anchor.z);
        scene.add(sign);
      }
    }
  }

  /** A floating department sign — a billboarded canvas label tinted by accent. */
  private makeRoomSign(label: string, accentHex: string): THREE.Sprite | null {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    canvas.width = 512;
    canvas.height = 96;
    ctx.font = "700 44px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    const w = Math.min(500, ctx.measureText(label).width + 48);
    ctx.fillStyle = "rgba(9,12,20,0.78)";
    ctx.fillRect((512 - w) / 2, 18, w, 60);
    ctx.fillStyle = accentHex;
    ctx.fillRect((512 - w) / 2, 72, w, 4); // accent underline
    ctx.fillStyle = "#f4f7fb";
    ctx.fillText(label, 256, 46);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(5.2, 0.98, 1);
    this.disposables.push(tex, mat);
    return sprite;
  }

  /**
   * Build the office furniture: group the colored boxes by color and draw each
   * group as one `InstancedMesh`, so the whole floor's furniture is a handful of
   * draw calls regardless of piece count.
   */
  private buildFurniture(boxes: FurnitureBox[]): void {
    if (!this.scene) return;
    // Group by (color, glow) so lit surfaces (monitors) become emissive.
    const byKey = new Map<string, FurnitureBox[]>();
    for (const b of boxes) {
      const key = `${b.color}|${b.glow ? 1 : 0}`;
      const group = byKey.get(key) ?? [];
      group.push(b);
      byKey.set(key, group);
    }
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    for (const group of byKey.values()) {
      const first = group[0];
      const color = new THREE.Color(first.color);
      const mat = new THREE.MeshStandardMaterial({
        color,
        roughness: first.glow ? 0.4 : 0.7,
        metalness: 0.05,
        emissive: first.glow ? color : new THREE.Color(0x000000),
        emissiveIntensity: first.glow ? 0.8 : 0,
      });
      const geo = new THREE.BoxGeometry(1, 1, 1);
      const mesh = new THREE.InstancedMesh(geo, mat, group.length);
      group.forEach((b, i) => {
        pos.set(b.cx, b.height / 2, b.cz);
        scale.set(b.width, b.height || 0.01, b.depth);
        m.compose(pos, q, scale);
        mesh.setMatrixAt(i, m);
      });
      mesh.instanceMatrix.needsUpdate = true;
      this.scene.add(mesh);
      this.disposables.push(geo, mat);
    }
  }

  private buildInstancedBoxes(boxes: Box3D[], color: number, roughness: number): THREE.InstancedMesh | null {
    if (!this.scene || boxes.length === 0) return null;
    const geo = new THREE.BoxGeometry(1, 1, 1);
    const mat = new THREE.MeshStandardMaterial({ color, roughness, metalness: 0.05 });
    const mesh = new THREE.InstancedMesh(geo, mat, boxes.length);
    const m = new THREE.Matrix4();
    const q = new THREE.Quaternion();
    const pos = new THREE.Vector3();
    const scale = new THREE.Vector3();
    boxes.forEach((b, i) => {
      pos.set(b.cx, b.height / 2, b.cz);
      scale.set(b.width, b.height || 0.01, b.depth);
      m.compose(pos, q, scale);
      mesh.setMatrixAt(i, m);
    });
    mesh.instanceMatrix.needsUpdate = true;
    this.scene.add(mesh);
    this.disposables.push(geo, mat);
    return mesh;
  }

  // ── Internal: actors ────────────────────────────────────────────────────────

  private applySeated(handle: ActorHandle): void {
    handle.group.position.y = handle.seated ? -SEATED_DROP : 0;
  }

  private makeLabel(name: string): THREE.Sprite | null {
    if (typeof document === "undefined") return null;
    const canvas = document.createElement("canvas");
    const ctx = canvas.getContext("2d");
    if (!ctx) return null;
    canvas.width = 256;
    canvas.height = 64;
    ctx.font = "600 30px system-ui, sans-serif";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillStyle = "rgba(9,12,20,0.72)";
    const w = Math.min(248, ctx.measureText(name).width + 24);
    ctx.fillRect((256 - w) / 2, 12, w, 40);
    ctx.fillStyle = "#e8eef5";
    ctx.fillText(name, 128, 33);
    const tex = new THREE.CanvasTexture(canvas);
    tex.colorSpace = THREE.SRGBColorSpace;
    const mat = new THREE.SpriteMaterial({ map: tex, transparent: true, depthTest: false });
    const sprite = new THREE.Sprite(mat);
    sprite.scale.set(2, 0.5, 1);
    this.disposables.push(tex, mat);
    return sprite;
  }

  private disposeActor(handle: ActorHandle): void {
    this.bodyToActor.delete(handle.body);
    handle.group.traverse((obj) => {
      if (obj !== handle.body) this.bodyToActor.delete(obj);
    });
    handle.body.geometry.dispose();
    handle.bodyMat.dispose();
    if (handle.sprite) {
      (handle.sprite.material as THREE.SpriteMaterial).dispose();
      handle.spriteTex?.dispose();
    }
    // Head + label geometries/materials are tracked in `disposables` and freed
    // wholesale in `destroy`; nulling the group reference lets GC reclaim them
    // when an actor is removed mid-session.
  }

  // ── Internal: loop, camera, picking ─────────────────────────────────────────

  private loop = (): void => {
    if (!this.renderer || !this.scene || !this.camera) return;
    const now = performance.now();
    const dt = Math.min(0.05, (now - this.lastTime) / 1000);
    this.lastTime = now;

    // Ease camera look toward its target (room center, followed actor, or floor).
    if (this.followId) {
      const followed = this.actors.get(this.followId);
      if (followed) {
        this.camLookTarget = { x: followed.group.position.x, z: followed.group.position.z };
      }
    }
    this.camLook.x += (this.camLookTarget.x - this.camLook.x) * Math.min(1, dt * 4);
    this.camLook.z += (this.camLookTarget.z - this.camLook.z) * Math.min(1, dt * 4);
    this.camera.position.set(this.camLook.x, this.camHeight, this.camLook.z + this.camDist);
    this.camera.lookAt(this.camLook.x, 0, this.camLook.z);

    // Actor position lerp, facing, a gentle idle bob, and sprite animation.
    for (const a of this.actors.values()) {
      const g = a.group;
      const moving = Math.hypot(a.target.x - g.position.x, a.target.z - g.position.z) > 0.05;
      g.position.x += (a.target.x - g.position.x) * Math.min(1, dt * 6);
      g.position.z += (a.target.z - g.position.z) * Math.min(1, dt * 6);
      // A billboard sprite always faces the camera; only rotate the (capsule)
      // fallback, whose facing is conveyed by yaw rather than the walk row.
      if (!a.sprite) g.rotation.y += (yawOf(a.facing) - g.rotation.y) * Math.min(1, dt * 8);
      if (!a.seated) {
        a.bob += dt * 2.2;
        a.group.position.y = Math.sin(a.bob) * 0.03;
      }

      if (a.sprite && a.spriteTex && a.charSprite) {
        a.animMs += dt * 1000;
        const anim = a.charSprite.animations[spriteAnimationState(a.state, a.facing, moving)];
        const col = frameIndexAt(anim, a.animMs);
        a.spriteTex.repeat.set(1 / a.sheetCols, 1 / a.sheetRows);
        a.spriteTex.offset.set(col / a.sheetCols, 1 - (anim.row + 1) / a.sheetRows);
      }
    }

    this.renderer.render(this.scene, this.camera);
    this.rafId = requestAnimationFrame(this.loop);
  };

  private resize(): void {
    if (!this.renderer || !this.camera || !this.container) return;
    const w = this.container.clientWidth || 1;
    const h = this.container.clientHeight || 1;
    this.renderer.setSize(w, h);
    this.camera.aspect = w / h;
    this.camera.updateProjectionMatrix();
  }

  private handlePointer(ev: PointerEvent): void {
    if (!this.camera || !this.renderer) return;
    const rect = this.renderer.domElement.getBoundingClientRect();
    const ndc = new THREE.Vector2(
      ((ev.clientX - rect.left) / rect.width) * 2 - 1,
      -((ev.clientY - rect.top) / rect.height) * 2 + 1,
    );
    this.raycaster.setFromCamera(ndc, this.camera);

    // Avatars first, then the floor plane.
    const bodies = Array.from(this.bodyToActor.keys());
    const actorHits = this.raycaster.intersectObjects(bodies, false);
    if (actorHits.length > 0) {
      const id = this.bodyToActor.get(actorHits[0].object);
      if (id && this.actorClick) this.actorClick(id);
      return;
    }
    if (this.floorPlane && this.floorClick) {
      const floorHits = this.raycaster.intersectObject(this.floorPlane, false);
      const hit = floorHits[0];
      if (hit) {
        const px = pixelsOf(hit.point.x, hit.point.z);
        this.floorClick(px.x, px.y);
      }
    }
  }
}
