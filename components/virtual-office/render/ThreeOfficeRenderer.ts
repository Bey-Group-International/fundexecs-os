/**
 * FundExecs OS — Phase-2 Three.js / WebGPU renderer scaffold.
 *
 * ⚠️  This file is a SCAFFOLD, not a working renderer. It documents, in code
 * plus comments, HOW a native-browser 3D implementation would satisfy every
 * `OfficeRenderer` method — so the Phase-2 work is a matter of filling the
 * `TODO(three)` bodies rather than redesigning the seam.
 *
 * It is intentionally DEPENDENCY-FREE: it does NOT import `three`,
 * `@react-three/*`, or any other package (none are installed). The Three.js
 * objects it would use are represented by the minimal LOCAL interface stubs
 * below (`Scene3D`, `Camera3D`, `Mesh3D`, …). When the `three` dependency is
 * actually added in Phase 2, these stubs are deleted and the real imports
 * (`import * as THREE from "three"`) take their place — the method contracts
 * and the mapping notes stay exactly the same.
 *
 * ── Coordinate mapping (2D top-down → 3D) ─────────────────────────────────
 * The current world is a top-down plane in pixels: +x right, +y DOWN, with
 * `yDepth(footY)` faking occlusion. In Three.js the floor becomes the X-Z
 * plane and +Y is up:
 *
 *     world2D (px)      →     world3D (world units)
 *     ( x , y )         →     ( x * S , 0 , y * S )
 *
 * where S is a pixels→meters scale. The fake y-depth sort disappears — real
 * depth is handled by the GPU z-buffer, and a perspective (or tilted ortho)
 * camera replaces Phaser's zoomed top-down view. Avatar "facing" maps to a
 * yaw rotation about +Y.
 *
 * ── Renderer choice ──────────────────────────────────────────────────────
 * Prefer `WebGPURenderer` (three/webgpu) when `navigator.gpu` is present,
 * falling back to `WebGLRenderer`. Both satisfy the same scene-graph API, so
 * the fallback is a single branch in `mount()`.
 */

import type {
  ActorClickHandler,
  ActorFacing,
  ActorSpec,
  FloorClickHandler,
  OfficeRenderer,
} from "./OfficeRenderer";
import type { AgentState, RoomKey } from "../program/officeProgram";

// ─── Minimal local stand-ins for Three.js objects ──────────────────────────────
// These exist ONLY so this scaffold type-checks without the `three` package.
// In Phase 2 each is replaced by the corresponding real class from `three`:
//   Scene3D → THREE.Scene, Camera3D → THREE.PerspectiveCamera,
//   Renderer3D → THREE.WebGPURenderer | THREE.WebGLRenderer,
//   Mesh3D → THREE.Mesh, InstancedMesh3D → THREE.InstancedMesh,
//   Object3D → THREE.Object3D, Raycaster3D → THREE.Raycaster.

/** Stand-in for THREE.Object3D — anything with a transform in the scene graph. */
interface Object3D {
  position: { x: number; y: number; z: number };
  rotation: { x: number; y: number; z: number };
  visible: boolean;
}

/** Stand-in for THREE.Scene. */
interface Scene3D {
  add(obj: Object3D): void;
  remove(obj: Object3D): void;
}

/** Stand-in for THREE.PerspectiveCamera / OrthographicCamera. */
interface Camera3D extends Object3D {
  lookAt(x: number, y: number, z: number): void;
}

/** Stand-in for a WebGPU/WebGL renderer. */
interface Renderer3D {
  domElement: HTMLCanvasElement;
  setSize(w: number, h: number): void;
  render(scene: Scene3D, camera: Camera3D): void;
  dispose(): void;
}

/** Stand-in for THREE.Mesh. */
interface Mesh3D extends Object3D {
  dispose?(): void;
}

/**
 * Stand-in for THREE.InstancedMesh — one draw call for N identical rooms,
 * desks, or avatar bodies, with a per-instance transform matrix.
 */
interface InstancedMesh3D extends Object3D {
  count: number;
  setInstanceTransform(index: number, x: number, y: number, z: number, yaw: number): void;
}

/** Stand-in for THREE.Raycaster — used for GPU/CPU pointer picking. */
interface Raycaster3D {
  setFromCamera(ndcX: number, ndcY: number, camera: Camera3D): void;
  intersect(scene: Scene3D): Array<{ actorId: string | null; point: { x: number; z: number } }>;
}

/** Per-actor GPU handle set. In Phase 2 this holds real THREE objects. */
interface ActorHandle {
  spec: ActorSpec;
  /** Instanced-pool slot for this actor's body, or a dedicated skinned mesh. */
  instanceIndex: number;
  facing: ActorFacing;
  state: AgentState;
  seated: boolean;
  root: Object3D | null;
}

const PX_TO_WORLD = 1 / 32; // pixels → world units (1 tile = 1 unit)

/**
 * Phase-2 native-browser 3D renderer. Every method is a scaffold: it either
 * no-ops or throws `NOT_WIRED`, but the type surface and the `TODO(three)`
 * notes describe the real implementation precisely.
 */
export class ThreeOfficeRenderer implements OfficeRenderer {
  private static readonly NOT_WIRED =
    "ThreeOfficeRenderer is a Phase-2 scaffold — not yet wired";

  // ── Engine handles (null until mount(); typed as the local stand-ins) ──
  private scene: Scene3D | null = null;
  private camera: Camera3D | null = null;
  private renderer: Renderer3D | null = null;
  private raycaster: Raycaster3D | null = null;

  /** GPU instance pools for the static world and the avatar bodies. */
  private roomPool: InstancedMesh3D | null = null;
  private deskPool: InstancedMesh3D | null = null;
  private avatarPool: InstancedMesh3D | null = null;

  /** Per-actor handles keyed by actor id. */
  private readonly actors = new Map<string, ActorHandle>();

  /** Interaction callbacks, wired to raycaster hits in the pointer handler. */
  private actorClick: ActorClickHandler | null = null;
  private floorClick: FloorClickHandler | null = null;

  /** Actor the camera is currently following, or null for free framing. */
  private followId: string | null = null;

  // ── Lifecycle ─────────────────────────────────────────────────────────────

  mount(container: HTMLElement): void {
    // TODO(three): create the renderer, scene, and camera, then attach the
    // canvas to `container` and start a requestAnimationFrame loop:
    //   const useGPU = typeof navigator !== "undefined" && "gpu" in navigator;
    //   this.renderer = useGPU ? new THREE.WebGPURenderer({ antialias: true })
    //                          : new THREE.WebGLRenderer({ antialias: true });
    //   this.renderer.setSize(container.clientWidth, container.clientHeight);
    //   container.appendChild(this.renderer.domElement);
    //   this.scene = new THREE.Scene();
    //   this.camera = new THREE.PerspectiveCamera(50, aspect, 0.1, 1000);
    //   // key + fill + ambient lights approximating the current gold key light
    //   this.raycaster = new THREE.Raycaster();
    //   // pointer listeners → _handlePointer() for actor/floor picking
    //   // ResizeObserver → this.renderer.setSize + camera.aspect update
    void container;
    throw new Error(ThreeOfficeRenderer.NOT_WIRED);
  }

  destroy(): void {
    // TODO(three): stop the RAF loop, dispose geometries/materials/instanced
    // pools, remove pointer + resize listeners, and drop the canvas:
    //   this.renderer?.dispose();
    //   for (const geo of geometries) geo.dispose();
    //   this.renderer?.domElement.remove();
    this.actors.clear();
    this.roomPool = null;
    this.deskPool = null;
    this.avatarPool = null;
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.raycaster = null;
  }

  update(deltaMs: number): void {
    // TODO(three): advance skeletal/state animation mixers and interpolate any
    // in-flight actor transforms, then render:
    //   this.mixers.forEach((m) => m.update(deltaMs / 1000));
    //   if (this.followId) this._trackCameraTo(this.followId, deltaMs);
    //   if (this.scene && this.camera) this.renderer?.render(this.scene, this.camera);
    void deltaMs;
    // No-op in the scaffold: nothing is mounted, so there is nothing to draw.
  }

  // ── World ─────────────────────────────────────────────────────────────────

  buildFloor(): void {
    // TODO(three): build the static world once, reading the SAME data the
    // Phaser floor reads (ROOMS / WORKSTATIONS / LAYOUT from officeEnvironment
    // + types), so the two renderers stay pixel-congruent:
    //   • Rooms: one InstancedMesh of box/plane geometry, one instance per
    //     room, positioned at (col*ROOM_W, 0, row*ROOM_H) * PX_TO_WORLD.
    //   • Walls: extruded box segments split around each DOOR_GAP, matching
    //     _createWalls() so doorways line up with the collision model.
    //   • Furniture/desks: an InstancedMesh per repeated piece type (desk,
    //     screens, shelf, plant …) — one draw call for all desks on the floor.
    //   this.roomPool = new THREE.InstancedMesh(roomGeo, roomMat, ROOMS.length);
    //   this.deskPool = new THREE.InstancedMesh(deskGeo, deskMat, totalDesks);
    throw new Error(ThreeOfficeRenderer.NOT_WIRED);
  }

  focusRoom(roomKey: RoomKey): void {
    // TODO(three): look up the room's center from ROOM_BY_KEY, convert to
    // world units, and tween the camera + look-at target there:
    //   const c = roomCenterWorld(roomKey);
    //   this.followId = null;
    //   tweenCamera(this.camera, c, this.renderer); // ease over ~400ms
    void roomKey;
    // No-op in the scaffold (no camera yet).
  }

  follow(actorId: string | null): void {
    // TODO(three): store the target; update() lerps the camera toward the
    // actor's world position each frame (mirrors Phaser startFollow lerp).
    this.followId = actorId;
  }

  // ── Actors ────────────────────────────────────────────────────────────────

  addActor(spec: ActorSpec): void {
    // TODO(three): claim an avatar-pool instance slot (or instantiate a
    // skinned MetaHuman-lite mesh), set its initial transform from spec.x/y →
    // world, apply role accent to its material, and register a name-tag
    // sprite. Store the handle for later mutators:
    //   const index = this._claimAvatarSlot();
    //   this.avatarPool?.setInstanceTransform(index, ...worldOf(spec.x, spec.y), yawOf(spec.facing));
    const handle: ActorHandle = {
      spec,
      instanceIndex: this.actors.size,
      facing: spec.facing,
      state: spec.state ?? "idle",
      seated: spec.seated ?? false,
      root: null,
    };
    this.actors.set(spec.id, handle);
  }

  removeActor(id: string): void {
    // TODO(three): free the avatar-pool slot (or dispose the dedicated mesh)
    // and its name tag, then compact the instance buffer.
    const handle = this.actors.get(id);
    if (handle?.root && this.scene) this.scene.remove(handle.root);
    this.actors.delete(id);
  }

  moveActor(id: string, x: number, y: number): void {
    // TODO(three): write the actor's instance transform, mapping the top-down
    // (x, y) pixel position onto the X-Z floor plane:
    //   const wx = x * PX_TO_WORLD, wz = y * PX_TO_WORLD;
    //   this.avatarPool?.setInstanceTransform(h.instanceIndex, wx, 0, wz, yawOf(h.facing));
    const handle = this.actors.get(id);
    if (!handle || !handle.root) return;
    handle.root.position.x = x * PX_TO_WORLD;
    handle.root.position.z = y * PX_TO_WORLD;
  }

  setActorFacing(id: string, facing: ActorFacing): void {
    // TODO(three): convert facing → yaw about +Y and set the instance/mesh
    // rotation (down = toward camera, up = away, left/right = ±90°).
    const handle = this.actors.get(id);
    if (handle) handle.facing = facing;
  }

  setActorState(id: string, state: AgentState): void {
    // TODO(three): resolve program state → animation clip (typing, reviewing,
    // presenting, analyzing, celebrating) and cross-fade the actor's mixer;
    // update its aura/rim emissive color to match the state palette.
    const handle = this.actors.get(id);
    if (handle) handle.state = state;
  }

  setActorSeated(id: string, seated: boolean): void {
    // TODO(three): switch between the standing rig and a seated pose clip so
    // the figure reads as working at a desk (seated is the idle stance).
    const handle = this.actors.get(id);
    if (handle) handle.seated = seated;
  }

  // ── Interaction ───────────────────────────────────────────────────────────

  onActorClick(cb: ActorClickHandler): void {
    // Wired to raycaster hits against the avatar pool in the pointer handler.
    this.actorClick = cb;
  }

  onFloorClick(cb: FloorClickHandler): void {
    // Wired to raycaster hits against the floor plane in the pointer handler.
    this.floorClick = cb;
  }

  // ── Internal (Phase-2) ─────────────────────────────────────────────────────

  /**
   * Pointer → pick. In Phase 2 this converts the pointer to normalized device
   * coordinates, raycasts against the avatar pool then the floor plane, and
   * dispatches to `actorClick` / `floorClick`. Kept here (referencing the
   * handler + raycaster fields) so the interaction wiring is explicit.
   */
  private _handlePointer(ndcX: number, ndcY: number): void {
    // TODO(three): GPU-assisted picking is preferable at scale — render actor
    // ids to an off-screen id buffer and read back one pixel — but a CPU
    // Raycaster is fine for the current ~11 agents + a few humans.
    if (!this.raycaster || !this.scene || !this.camera) return;
    this.raycaster.setFromCamera(ndcX, ndcY, this.camera);
    const hits = this.raycaster.intersect(this.scene);
    const top = hits[0];
    if (!top) return;
    if (top.actorId && this.actorClick) {
      this.actorClick(top.actorId);
    } else if (this.floorClick) {
      // Map the floor hit (world units) back to top-down pixels for the
      // behavior layer, which still reasons in the 2D coordinate system.
      this.floorClick(top.point.x / PX_TO_WORLD, top.point.z / PX_TO_WORLD);
    }
  }
}
