# Virtual Office — Rendering Layer (Phase 2)

This directory holds the **rendering seam** for the FundExecs OS virtual
office: a framework-agnostic interface (`OfficeRenderer`) plus renderer
implementations that plug in behind it. The goal is a rendering layer that can
be upgraded — Canvas2D today, native 3D or cloud-rendered avatars later —
**without touching any other layer**.

## The five layers

The virtual office is deliberately separated into five layers. Only the
**Rendering** layer changes across phases; the other four are engine-agnostic
and stay put.

|          Layer          |                                         Owns                                         |                                Where it lives                                 |
|-------------------------|--------------------------------------------------------------------------------------|-------------------------------------------------------------------------------|
| **Office Intelligence** | Agents, rooms, risk tiers, task routing — *what should happen*                       | `program/officeProgram.ts`                                                    |
| **NPC Behavior**        | Path following, seating, facing, program→animation resolution — *how an actor moves* | `scenes/OfficeScene.ts` (pathing/seating), `avatar/ExecutiveAvatar.ts` (pose) |
| **Workflow State**      | Stages, approval gates, meetings, audit log                                          | `program/officeProgram.ts` + React state                                      |
| **Rendering**           | Pixels: floor, walls, furniture, avatars, camera                                     | **this directory** (`render/`)                                                |
| **Interaction**         | Pointer/keyboard events surfaced back to the layers above                            | `onActorClick` / `onFloorClick` on the renderer                               |

The Intelligence, Behavior, Workflow, and Interaction layers speak to the
renderer **only** through the `OfficeRenderer` interface. They never import
Phaser, Three.js, or any engine type. That is what makes the renderer
swappable.

## The seam: `OfficeRenderer`

`OfficeRenderer.ts` defines the whole contract. A renderer is a "dumb" view —
it draws what it is told and reports pointer events; it knows nothing about
tasks, sockets, or approvals.

- **Lifecycle** — `mount(container)`, `destroy()`, `update(deltaMs)`
- **World** — `buildFloor()`, `focusRoom(roomKey)`, `follow(actorId)`
- **Actors** — `addActor(spec)`, `removeActor(id)`, `moveActor(id, x, y)`,
  `setActorFacing(id, facing)`, `setActorState(id, state)`,
  `setActorSeated(id, seated)`
- **Interaction** — `onActorClick(cb)`, `onFloorClick(cb)`

The contract uses only plain data plus the domain enums (`AgentState`,
`RoomKey`) from the Intelligence layer — never an engine handle.

### How today's Phaser scene already conforms

`scenes/OfficeScene.ts` (Phaser Canvas2D) is not yet written *against* this
interface, but it already conforms to it conceptually — the mapping is
one-to-one:

|  `OfficeRenderer` method   |                 Phaser `OfficeScene` equivalent                  |
|----------------------------|------------------------------------------------------------------|
| `buildFloor()`             | `_createTilemap()` + `createWallVisuals()` + `createFurniture()` |
| `addActor(spec)`           | `_spawnNpc()` / `_spawnProgramAgents()`                          |
| `moveActor(id, x, y)`      | path-follow position writes in `_updateNpcAvatars()`             |
| `setActorFacing()`         | `ExecutiveAvatar.setFacing()`                                    |
| `setActorState()`          | the `program:npc-state` handler → `ExecutiveAvatar.setState()`   |
| `setActorSeated()`         | `_sitNpc()` / `_standNpc()`                                      |
| `focusRoom()` / `follow()` | `office:teleport` + `cameras.main.startFollow()`                 |
| `onActorClick()`           | the `npc:click` pointer wiring                                   |
| `onFloorClick()`           | click-to-walk in `_setupPointerTeleport()`                       |
| `update(deltaMs)`          | the scene `update()` loop                                        |

Extracting a thin `PhaserOfficeRenderer implements OfficeRenderer` adapter that
delegates to the existing scene is the natural next step; the scene logic does
not need to change, only be fronted by the interface.

### How a future renderer swaps in

Because callers depend on `OfficeRenderer` and not on a concrete class, a swap
is a one-line construction change at the composition root:

```ts
const renderer: OfficeRenderer = useThree
  ? new ThreeOfficeRenderer()
  : new PhaserOfficeRenderer();
```

Everything above the seam — task routing, path following, approval gates —
is untouched.

## Upgrade paths

All four target renderers implement the same `OfficeRenderer` surface. They
differ only in fidelity, where they run, and what they cost.

### 1. Three.js — native browser 3D *(implemented)*

`ThreeOfficeRenderer.ts` is a **working** renderer built on `three` (WebGL). It
runs on the client GPU — no cloud, no external engine — and is the native way
to get real 3D fidelity. It stays fully additive: nothing constructs it yet, so
the live Phaser floor is untouched until a composition root opts in.

- **Coordinate mapping + geometry** — all 2D→3D translation lives in the pure,
  unit-tested `officeGeometry3D.ts`: the top-down plane (`+x` right, `+y`
  **down**) becomes the X-Z floor plane with `+y` up, real GPU depth replaces
  the fake `yDepth`, and facing → yaw about `+Y`. It reads the **same** `ROOMS`
  / walls / `WORKSTATIONS` data as the Phaser floor (door-split partition walls
  included), so the two stay congruent.
- **Draw calls** — rooms are accent-tinted floor quads; walls and desks are each
  a single **`InstancedMesh`** (one draw call for all walls, one for all desks).
  Avatars are a small pool of grouped meshes (capsule body + head + canvas name
  sprite), colored by role accent and lit by an emissive tint per `AgentState`.
- **Picking** — a `Raycaster` tests avatar bodies first, then the floor plane,
  mapping hits to `onActorClick` / `onFloorClick` (floor hits converted back to
  top-down pixels for the behavior layer).
- **Loop + camera** — self-drives its own `requestAnimationFrame` loop (so the
  interface `update()` is a no-op): eased camera for `focusRoom` / `follow`,
  position lerp, and a gentle idle bob. `WebGPURenderer` can slot in behind the
  same scene-graph API later.
- **Runs** on the client; no server GPU. Best near-term upgrade.

The pure geometry mapping is covered by `officeGeometry3D.test.ts`, so the
2D↔3D translation is verified headlessly without a GPU.

### 2. Unity WebGL — richer avatar controllers

A Unity build compiled to WebGL, embedded in a canvas, driven from JS.

- **Where it plugs in** — a `UnityOfficeRenderer` holds the Unity instance;
  each `OfficeRenderer` call becomes a `SendMessage` into Unity, and Unity
  raises `onActorClick` / `onFloorClick` back out via the JS bridge.
- **Why** — mature animation state machines / blend trees for the avatar work
  states (typing, reviewing, presenting) and richer materials/lighting than
  hand-rolled Three.js, at the cost of a larger WASM/WebGL payload and load
  time.

### 3. Unreal Pixel Streaming — cloud-rendered MetaHuman office

Unreal Engine renders on a cloud GPU and streams video + input to the browser.

- **Where it plugs in** — an `UnrealPixelStreamRenderer` sends the
  `OfficeRenderer` calls as data-channel messages to the Unreal instance;
  pointer events arrive back over the same channel. The browser only shows a
  video element + input capture.
- **Why** — the highest visual fidelity (MetaHuman executives, cinematic
  lighting) with no client GPU requirement, at the cost of per-session cloud
  GPU spend and streaming latency. Suited to demos / premium sessions rather
  than always-on floors.

### 4. NVIDIA Omniverse / ACE — digital twin + AI avatar presence

Omniverse (USD-based digital twin) with **ACE** for AI-driven avatar voice,
animation, and presence.

- **Where it plugs in** — the same `OfficeRenderer` surface drives the USD
  stage; ACE consumes the existing `AgentState` (already modeled on a
  Unity-style animation set, see `ExecutiveAvatar.AnimationState`) to drive
  audio2face + gesture, so an agent's `working` / `presenting` / `waiting`
  state becomes real facial + voice presence.
- **Why** — turns the office into a true digital twin with conversational AI
  avatars. Heaviest infrastructure (Omniverse + ACE microservices, cloud
  streaming); the long-horizon target, not a near-term swap.

## Practical sequencing

1. Wrap the existing Phaser scene in a `PhaserOfficeRenderer` adapter so the
   app depends on `OfficeRenderer`, not the scene directly.
2. ✅ `ThreeOfficeRenderer` is implemented (real `three`/WebGL, reads the same
   `ROOMS` data via `officeGeometry3D`). Next: wire a composition root that can
   opt into it, then enrich avatar fidelity (skinned meshes / animation clips).
3. Evaluate Unity / Unreal / Omniverse only where the extra fidelity justifies
   the payload, latency, or cloud-GPU cost — each behind the same interface.

