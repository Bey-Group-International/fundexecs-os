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
  wallSegments,
  workstations3D,
  worldOf,
  yawOf,
  type Box3D,
} from "./officeGeometry3D";

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
  /** Target floor position (world units); the group lerps toward it. */
  target: { x: number; z: number };
  /** Idle-bob phase so figures don't all bob in lockstep. */
  bob: number;
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
  private deskMesh: THREE.InstancedMesh | null = null;
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
  private readonly camHeight = 16;
  private readonly camDist = 15;

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
    scene.add(new THREE.HemisphereLight(0x9fb4d6, 0x0b0e14, 0.9));
    const key = new THREE.DirectionalLight(0xffe6b0, 1.1);
    key.position.set(6, 20, 8);
    scene.add(key);
    scene.add(new THREE.AmbientLight(0x404a5c, 0.6));

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
    this.deskMesh = null;
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
      target: { x: w.x, z: w.z },
      bob: Math.abs((spec.x * 13 + spec.y * 7) % 6.28),
    };
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
  }

  setActorSeated(id: string, seated: boolean): void {
    const handle = this.actors.get(id);
    if (!handle) return;
    handle.seated = seated;
    this.applySeated(handle);
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
    const floorMat = new THREE.MeshStandardMaterial({ color: 0x151a24, roughness: 0.95 });
    const floor = new THREE.Mesh(floorGeo, floorMat);
    floor.rotation.x = -Math.PI / 2;
    floor.position.set(c.x, 0, c.z);
    scene.add(floor);
    this.floorPlane = floor;
    this.disposables.push(floorGeo, floorMat);

    // Per-room accent tint quads, just above the floor.
    for (const { roomKey, box } of roomFloors()) {
      const geo = new THREE.PlaneGeometry(box.width * 0.82, box.depth * 0.72);
      const mat = new THREE.MeshBasicMaterial({
        color: new THREE.Color(roomAccentHex(roomKey)),
        transparent: true,
        opacity: 0.06,
      });
      const tile = new THREE.Mesh(geo, mat);
      tile.rotation.x = -Math.PI / 2;
      tile.position.set(box.cx, 0.01, box.cz);
      scene.add(tile);
      this.disposables.push(geo, mat);
    }

    // Walls + desks as instanced boxes (one draw call each).
    this.wallMesh = this.buildInstancedBoxes(wallSegments(), 0x2b3242, 0.85);
    this.deskMesh = this.buildInstancedBoxes(
      workstations3D().map((w) => w.desk),
      0x39414f,
      0.7,
    );
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

    // Actor position lerp, facing, and a gentle idle bob when standing.
    for (const a of this.actors.values()) {
      const g = a.group;
      g.position.x += (a.target.x - g.position.x) * Math.min(1, dt * 6);
      g.position.z += (a.target.z - g.position.z) * Math.min(1, dt * 6);
      g.rotation.y += (yawOf(a.facing) - g.rotation.y) * Math.min(1, dt * 8);
      if (!a.seated) {
        a.bob += dt * 2.2;
        a.group.position.y = Math.sin(a.bob) * 0.03;
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
