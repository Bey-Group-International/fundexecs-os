# FundExecs OS — Unity + Fab 2.5D Office World

**Target:** Unity 2022+ / URP · Orthographic 2.5D (dimetric) · Fab modular kits · Cinemachine · NavMesh
**Scope:** map, rooms, props, lighting, navigation. **No** pixel art, **no** character sprites.
**World unit:** `1 uu = 1 m`. **Grid module:** `M = 2 m`. **Wall height:** `H = 3.2 m`. **Slab thickness:** `0.2 m`.
**Floor plate:** `60 m (X) × 38 m (Z)` interior, `+2 m` service margin.

---

## 1 · UPGRADED MAP BLUEPRINT

### 1.1 Zone plan (top-down, +Z up / +X right)

```
Z=38 ┌──────────────────────────────────────────────────────────────────────┐
     │  ░░ perimeter curtain-wall (glass) + LED cove ░░                       │
     │ ┌───────────────────┐ ┌──────────────────┐ ┌───────────────────────┐  │
     │ │  EXECUTIVE PODS    │ │ DILIGENCE ROOMS  │ │   CAPITAL STACK LAB    │  │
     │ │  A1  A2  A3        │ │  D1 │ D2 │ D3     │ │  quant rigs · tickers  │  │
     │ │  (glass offices)   │ │  (data rooms)     │ │  cool 5000K + glow     │  │
Z=22 │ └─────────┬─────────┘ └────────┬─────────┘ └───────────┬───────────┘  │
     │           │  glass partition + sliding door nodes        │            │
     │ ┌─────────┴─────────┐ ┌────────┴──────────┐ ┌───────────┴───────────┐ │
     │ │   STRATEGY HUB    │ │  COMMAND CENTER   │ │   WORKFLOW TERMINALS   │ │
     │ │  whiteboard walls │ │  reception + live │ │   open-plan bullpen    │ │
     │ │  collab pods      │ │  ops video wall   │ │   6× benching desks    │ │
     │ └───────────────────┘ └─────────┬─────────┘ └───────────────────────┘ │
     │                          WELCOME │ portal (glass airlock)              │
Z=0  └──────────────────────────────────┴───────────────────────────────────┘
     X=0                                                                    X=60
```

### 1.2 Zone → legacy-map mapping

|   New Unity zone   |     Legacy 2D room(s)      |                   Role                    |
|--------------------|----------------------------|-------------------------------------------|
| Command Center     | Reception + Operations Hub | Arrival, live ops video wall, routing hub |
| Executive Pods     | CEO Office                 | Glass-walled exec offices (A1–A3)         |
| Workflow Terminals | Trading desks / bullpen    | Open-plan benching workstations           |
| Diligence Rooms    | Boardroom + Legal Corner   | Enclosed data/meeting rooms (D1–D3)       |
| Capital Stack Lab  | Trading Floor              | Multi-monitor quant/exec rigs             |
| Strategy Hub       | Research Hub + Marketing   | Whiteboard collab, campaign/brand wall    |

### 1.3 Zone rects (interior, metres)

```json
{
  "zones": {
    "executive_pods":     { "origin": [2, 24],  "size": [18, 12], "kit": "KIT_GLASS_OFFICE" },
    "diligence_rooms":    { "origin": [21, 24], "size": [17, 12], "kit": "KIT_DATA_ROOM" },
    "capital_stack_lab":  { "origin": [39, 24], "size": [19, 12], "kit": "KIT_QUANT_LAB" },
    "strategy_hub":       { "origin": [2, 2],   "size": [18, 20], "kit": "KIT_COLLAB" },
    "command_center":     { "origin": [21, 2],  "size": [17, 20], "kit": "KIT_HUB" },
    "workflow_terminals": { "origin": [39, 2],  "size": [19, 20], "kit": "KIT_BENCH" }
  },
  "circulation": { "type": "cross_spine", "corridor_width": 2.0, "material": "MAT_GLASS_WALKWAY" }
}
```

### 1.4 Depth layers (render + sorting order)

```
Layer 0  FLOOR SLAB        z-sort base   static, receives shadow/AO
Layer 1  FLOOR OVERLAY     rugs, LED inlays, walkway glass (decals)
Layer 2  PROPS (low)       desks, cabinets, couches   dynamic shadow casters
Layer 3  PROPS (tall)      server racks, partitions, plants
Layer 4  WALLS             modular Fab panels, glass, doors
Layer 5  CEILING RIG       light coves, LED panels, HVAC (culled at top-down cam)
Layer 6  FX / OVERLAY      volumetric light, dust motes, holographic dashboards
```

Sorting is **baseline-Y (world Z)** for Layer 2–3 so nearer props draw over farther; Layers 0–1 and 4–6 use fixed render-queue offsets.

---

## 2 · ROOM MODULES (Fab Style)

Each **kit** is a set of snap-to-grid modular prefabs (`2 m` snap in XZ, `0.4 m` in Y). Kits share a socket API so walls/doors/glass interchange.

### 2.1 Modular kit schema

```json
{
  "KIT_GLASS_OFFICE": {
    "label": "Executive Pod",
    "module": 2.0,
    "wall_height": 3.2,
    "pieces": {
      "wall_solid":   { "prefab": "Fab_Wall_Walnut_2x3",  "thickness": 0.2, "material": "MAT_WALNUT_VENEER" },
      "wall_glass":   { "prefab": "Fab_Glass_Frameless_2x3","thickness": 0.05,"material": "MAT_GLASS_CLEAR" },
      "door_slide":   { "prefab": "Fab_Door_Slide_Glass",   "clear_width": 1.0, "nav": "portal" },
      "corner_post":  { "prefab": "Fab_Post_Alu_0.2",       "material": "MAT_ALU_BRUSHED" },
      "ceiling_panel":{ "prefab": "Fab_Ceiling_Acoustic_2x2","material": "MAT_FELT_CHARCOAL", "emissive": false }
    },
    "floor": "MAT_CARPET_LOOP_NAVY",
    "lighting_profile": "LP_EXEC_WARM",
    "workstations": 1,
    "interaction_zones": ["exec_desk", "guest_seating"]
  },

  "KIT_DATA_ROOM": {
    "label": "Diligence Room",
    "module": 2.0, "wall_height": 3.2,
    "pieces": {
      "wall_solid":  { "prefab": "Fab_Wall_Acoustic_2x3", "material": "MAT_FELT_CHARCOAL" },
      "wall_glass":  { "prefab": "Fab_Glass_Frosted_2x3",  "material": "MAT_GLASS_FROST" },
      "door_swing":  { "prefab": "Fab_Door_Swing_Alu",     "clear_width": 0.9, "nav": "portal" },
      "ceiling_panel":{ "prefab": "Fab_Ceiling_LED_2x2",   "material": "MAT_LED_PANEL", "emissive": true }
    },
    "floor": "MAT_CARPET_LOOP_GRAPHITE",
    "lighting_profile": "LP_FOCUS_TABLE",
    "count": 3, "split": "vertical",
    "interaction_zones": ["conf_table", "data_wall"]
  },

  "KIT_QUANT_LAB": {
    "label": "Capital Stack Lab",
    "module": 2.0, "wall_height": 3.2,
    "pieces": {
      "wall_solid":  { "prefab": "Fab_Wall_Alu_2x3",   "material": "MAT_ALU_BRUSHED" },
      "wall_glass":  { "prefab": "Fab_Glass_Clear_2x3", "material": "MAT_GLASS_CLEAR" },
      "ceiling_panel":{ "prefab": "Fab_Ceiling_LED_Cool_2x2","material":"MAT_LED_PANEL_COOL","emissive":true }
    },
    "floor": "MAT_CONCRETE_POLISHED",
    "lighting_profile": "LP_LAB_COOL",
    "workstations": 6,
    "interaction_zones": ["quant_rig", "ticker_wall"]
  },

  "KIT_HUB": {
    "label": "Command Center",
    "module": 2.0, "wall_height": 3.2,
    "pieces": {
      "wall_glass":   { "prefab": "Fab_Glass_Curtain_2x3", "material": "MAT_GLASS_CLEAR" },
      "video_wall":   { "prefab": "Fab_VideoWall_6x3",     "material": "MAT_LED_VIDEO", "emissive": true },
      "recept_desk":  { "prefab": "Fab_Reception_Curved",  "material": "MAT_ALU_BRUSHED" }
    },
    "floor": "MAT_CONCRETE_POLISHED",
    "lighting_profile": "LP_HUB_NEUTRAL",
    "interaction_zones": ["reception", "ops_wall", "atrium"]
  },

  "KIT_BENCH": {
    "label": "Workflow Terminals",
    "module": 2.0, "wall_height": 3.2,
    "floor": "MAT_CARPET_LOOP_SLATE",
    "lighting_profile": "LP_OPEN_EVEN",
    "workstations": 6,
    "interaction_zones": ["bench_desk"]
  },

  "KIT_COLLAB": {
    "label": "Strategy Hub",
    "module": 2.0, "wall_height": 3.2,
    "pieces": {
      "whiteboard_wall": { "prefab": "Fab_Wall_Whiteboard_2x3", "material": "MAT_WHITEBOARD" },
      "wall_glass":      { "prefab": "Fab_Glass_Clear_2x3",     "material": "MAT_GLASS_CLEAR" }
    },
    "floor": "MAT_CARPET_LOOP_TEAL",
    "lighting_profile": "LP_COLLAB_ACCENT",
    "interaction_zones": ["collab_pod", "brand_wall"]
  }
}
```

### 2.2 Procedural material library (Substance / Shader Graph)

|       Material ID       |       Base        |                 Procedural params                 |   Lighting response    |
|-------------------------|-------------------|---------------------------------------------------|------------------------|
| `MAT_CARPET_LOOP_*`     | Loop-pile carpet  | tint, pile-noise scale, tri-planar, roughness 0.9 | matte, high AO uptake  |
| `MAT_CONCRETE_POLISHED` | Polished concrete | clearcoat 0.3, smoothness 0.6, subtle SSR         | soft specular          |
| `MAT_GLASS_CLEAR`       | Glass             | transmission 0.92, IOR 1.5, thin-wall, edge-tint  | refractive, no shadow  |
| `MAT_GLASS_FROST`       | Frosted glass     | roughness 0.5, translucency, blur backdrop        | diffuse transmit       |
| `MAT_ALU_BRUSHED`       | Brushed metal     | anisotropic 0.7, streak-noise, metallic 1.0       | anisotropic highlight  |
| `MAT_LED_PANEL*`        | LED panel         | emissive HDR (nits), grid mask, flicker off       | **emissive light src** |
| `MAT_LED_VIDEO`         | Video wall        | RenderTexture input (live dashboards), bloom      | **emissive**           |
| `MAT_WALNUT_VENEER`     | Wood veneer       | grain-noise, satin coat, warm tint                | warm diffuse           |
| `MAT_FELT_CHARCOAL`     | Acoustic felt     | fiber-noise, roughness 1.0                        | fully matte, deep AO   |
| `MAT_WHITEBOARD`        | Gloss white       | smoothness 0.85, marker decals layer              | bright, spec ping      |
| `MAT_GLASS_WALKWAY`     | Structural glass  | frosted core, edge LED, footfall decals           | emissive edge          |

### 2.3 Lighting profiles

```json
{
  "LP_EXEC_WARM":    { "key_K": 3000, "key_lux": 320, "fill_ratio": 0.6, "shadow": "soft_2048", "accent": "desk_lamp_warm" },
  "LP_FOCUS_TABLE":  { "key_K": 3500, "key_lux": 500, "throw": "table_only", "fill_ratio": 0.4, "shadow": "soft_1024" },
  "LP_LAB_COOL":     { "key_K": 5000, "key_lux": 400, "fill_ratio": 0.7, "emissive_bounce": true, "shadow": "hard_2048" },
  "LP_HUB_NEUTRAL":  { "key_K": 4000, "key_lux": 450, "fill_ratio": 0.8, "video_wall_bounce": true, "shadow": "soft_2048" },
  "LP_OPEN_EVEN":    { "key_K": 4500, "key_lux": 420, "fill_ratio": 0.9, "grid": "2x2_panel", "shadow": "soft_1024" },
  "LP_COLLAB_ACCENT":{ "key_K": 4000, "key_lux": 380, "fill_ratio": 0.7, "accent": "wallwash_teal", "shadow": "soft_1024" }
}
```

---

## 3 · ENVIRONMENT PROPS (Low-poly 3D)

### 3.1 Prop catalog with metadata

```json
[
  { "id": "PROP_DESK_BENCH",   "tris": 900,  "footprint": [1.6,0.8], "height": 0.74,
    "collision": "box", "height_offset": 0.0, "lighting": "static_shadow_caster",
    "fab_variants": ["oak","white","graphite"], "sockets": ["monitor","keyboard","chair"] },

  { "id": "PROP_DESK_EXEC",    "tris": 1600, "footprint": [2.0,0.9], "height": 0.75,
    "collision": "box", "lighting": "static_shadow_caster",
    "fab_variants": ["walnut","black_glass"], "sockets": ["dual_monitor","lamp","laptop"] },

  { "id": "PROP_QUANT_RIG",    "tris": 2400, "footprint": [1.8,0.9], "height": 1.3,
    "collision": "box", "lighting": "emissive_dynamic",
    "fab_variants": ["4mon","6mon"], "sockets": ["monitor_array","cpu_tower"],
    "emissive": { "source":"MAT_LED_VIDEO", "nits": 180 } },

  { "id": "PROP_SERVER_RACK",  "tris": 1800, "footprint": [0.8,1.0], "height": 2.1,
    "collision": "box", "lighting": "emissive_dynamic",
    "emissive": { "leds":"blink_seq", "nits": 40 }, "sockets": ["cable_tray"] },

  { "id": "PROP_VIDEO_WALL",   "tris": 300,  "footprint": [6.0,0.2], "height": 3.0,
    "collision": "none", "mount": "wall", "lighting": "emissive_dynamic",
    "emissive": { "source":"RenderTexture_OpsDashboard", "nits": 220 } },

  { "id": "PROP_CONF_TABLE",   "tris": 1200, "footprint": [3.2,1.2], "height": 0.74,
    "collision": "box", "lighting": "static_shadow_caster",
    "fab_variants": ["boat","rect"], "sockets": ["table_mic","screen_puck","chair×8"] },

  { "id": "PROP_RECEPTION",    "tris": 2000, "footprint": [3.6,1.1], "height": 1.1,
    "collision": "box", "curved": true, "lighting": "static_shadow_caster",
    "fab_variants": ["alu_wood","stone"], "sockets": ["logo_sign","monitor"] },

  { "id": "PROP_GLASS_PART",   "tris": 120,  "footprint": [2.0,0.05], "height": 2.4,
    "collision": "box_thin", "lighting": "refractive", "fab_variants": ["clear","frosted","fluted"] },

  { "id": "PROP_LOUNGE_SOFA",  "tris": 1400, "footprint": [2.2,0.9], "height": 0.8,
    "collision": "box", "lighting": "static_shadow_caster", "fab_variants": ["navy","teal","tan"] },

  { "id": "PROP_PLANT_TALL",   "tris": 1100, "footprint": [0.6,0.6], "height": 1.6,
    "collision": "capsule", "lighting": "dynamic_shadow_caster", "wind": "subtle_vertex" },

  { "id": "PROP_WHITEBOARD",   "tris": 200,  "footprint": [2.0,0.1], "height": 1.4,
    "collision": "none", "mount": "wall", "lighting": "spec_response",
    "decal_layer": "marker_notes" },

  { "id": "PROP_LED_TICKER",   "tris": 150,  "footprint": [4.0,0.15], "height": 0.5,
    "collision": "none", "mount": "wall", "lighting": "emissive_dynamic",
    "emissive": { "source":"RenderTexture_Ticker", "nits": 160 } }
]
```

**Metadata contract (per prop):**
- `collision` — `box | box_thin | capsule | none`; drives NavMesh carving + physics.
- `height_offset` — Y lift above slab for stacking on rugs/platforms.
- `lighting` — `static_shadow_caster | dynamic_shadow_caster | emissive_dynamic | refractive | spec_response`; sets light-probe usage, shadow mode, and whether the prop is a light source.
- `sockets` — named attach points for Fab-variant swaps (procedural dressing).

### 3.2 Fab procedural variation (dressing pass)

```csharp
// Deterministic per-instance variation so scenes are reproducible.
void DressProp(PropInstance p, int seed) {
    var rng = new System.Random(seed ^ p.gridId);
    p.material   = p.fabVariants[rng.Next(p.fabVariants.Length)];
    p.yaw        = p.snapYaw ? Snap90(rng) : 0;
    p.wearMask   = rng.NextDouble() * 0.15f;          // edge wear / dust
    foreach (var s in p.sockets) TryAttach(s, rng);   // monitors, lamps, chairs
    p.lightingResponse = ResolveLighting(p.meta.lighting);
}
```

---

## 4 · NAVIGATION MAP

### 4.1 Node graph (topology)

```
[EXEC A1]─[EXEC A2]─[EXEC A3]        [D1]─[D2]─[D3]  (diligence)
     │        │         │              │    │    │
  (idle)   (idle)    (idle)          (meet)(meet)(meet)
     └────────┴────┬────┴──────┬────────┴────┴────┘
                [SPINE_N]───[SPINE_NE]───────► [LAB_RIG×6]
                    │            │               (work)
[STRATEGY]──[SPINE_W]──[HUB_CORE]──[SPINE_E]──[BENCH×6]
 (collab)                  │        (routing)     (work)
                      [RECEPTION]
                           │
                       [WELCOME]  (spawn / portal)
```

### 4.2 Node + edge definitions

```json
{
  "nodes": [
    { "id": "WELCOME",    "type": "portal", "pos": [30, 1],  "capacity": 8 },
    { "id": "RECEPTION",  "type": "idle",   "pos": [30, 5],  "capacity": 3, "dwell": [4,10] },
    { "id": "HUB_CORE",   "type": "junction","pos":[30, 11], "capacity": 12 },
    { "id": "SPINE_W",    "type": "junction","pos":[12, 11] },
    { "id": "SPINE_E",    "type": "junction","pos":[48, 11] },
    { "id": "SPINE_N",    "type": "junction","pos":[12, 23] },
    { "id": "SPINE_NE",   "type": "junction","pos":[48, 23] },
    { "id": "EXEC_A1",    "type": "workstation","pos":[5, 30],  "role":"exec",   "urgency": 0.4 },
    { "id": "LAB_RIG_1",  "type": "workstation","pos":[42, 28], "role":"quant",  "urgency": 0.9 },
    { "id": "BENCH_1",    "type": "workstation","pos":[42, 6],  "role":"ops",    "urgency": 0.7 },
    { "id": "D1_TABLE",   "type": "meeting","pos":[24, 30], "seats": 8, "booking": "schedule" },
    { "id": "STRAT_POD",  "type": "meeting","pos":[8, 8],   "seats": 6, "mode":"standup" }
  ],
  "edges": [
    { "a": "WELCOME",   "b": "RECEPTION", "w": 1.0, "bi": true },
    { "a": "RECEPTION", "b": "HUB_CORE",  "w": 1.0, "bi": true },
    { "a": "HUB_CORE",  "b": "SPINE_E",   "w": 1.2, "bi": true },
    { "a": "SPINE_E",   "b": "BENCH_1",   "w": 1.0, "bi": true },
    { "a": "SPINE_E",   "b": "SPINE_NE",  "w": 1.4, "bi": true },
    { "a": "SPINE_NE",  "b": "LAB_RIG_1", "w": 0.8, "bi": true }
  ]
}
```

### 4.3 Weighted routing (workflow urgency)

`effective_cost = base_distance × (1 / lane_priority) × congestion(node)`
where `lane_priority` rises with the destination's `urgency` — a Capital Stack Lab escalation out-prioritises an idle stroll to the lounge.

```csharp
float EdgeCost(Node from, Node to, WorkContext ctx) {
    float dist   = Vector2.Distance(from.pos, to.pos);
    float pri    = Mathf.Lerp(0.5f, 2.0f, to.urgency);      // urgency → priority lane
    float cong   = 1f + 0.25f * to.occupancy;               // avoid crowded nodes
    float ctxMul = ctx.escalation && to.role == "quant" ? 0.6f : 1f;  // fast-track escalations
    return (dist / pri) * cong * ctxMul;
}
// A* over the node graph; re-plan on booking/escalation events.
List<Node> Route(Node start, Node goal, WorkContext ctx) => AStar(start, goal, EdgeCost, ctx);
```

### 4.4 Integration points (routing logic hooks)

- `OnDealEscalation(dealId)` → boosts `urgency` on Capital Stack + Diligence nodes, triggers re-plan.
- `OnMeetingBooked(roomId, t)` → reserves `meeting` node capacity window, blocks pathing seats.
- `OnAgentIdle(agentId)` → routes to nearest `idle` node weighted by role affinity.
- NavMesh + node-graph hybrid: node graph for **intent/scheduling**, baked NavMesh for **local steering & avoidance**.

---

## 5 · TILE ATLAS (2.5D Hybrid)

A logical atlas maps authoring tiles → modular prefabs so the legacy 2D grid can be re-baked into the 3D world. Each tile carries physical metadata.

```json
{
  "tile_size_m": 2.0,
  "floor": [
    { "id":"F_CARPET_NAVY",  "prefab":"Slab_Carpet_2x2","material":"MAT_CARPET_LOOP_NAVY",  "collision":"walk","height":0.0,"light":"matte_ao" },
    { "id":"F_CONCRETE",     "prefab":"Slab_Concrete_2x2","material":"MAT_CONCRETE_POLISHED","collision":"walk","height":0.0,"light":"soft_spec" },
    { "id":"F_GLASS_WALK",   "prefab":"Slab_Glass_2x2","material":"MAT_GLASS_WALKWAY",       "collision":"walk","height":0.02,"light":"emissive_edge" },
    { "id":"F_CARPET_TEAL",  "prefab":"Slab_Carpet_2x2","material":"MAT_CARPET_LOOP_TEAL",   "collision":"walk","height":0.0,"light":"matte_ao" }
  ],
  "wall": [
    { "id":"W_GLASS",   "prefab":"Fab_Glass_Clear_2x3",  "collision":"block","height":3.2,"light":"refractive","occludes":false },
    { "id":"W_ALU",     "prefab":"Fab_Wall_Alu_2x3",     "collision":"block","height":3.2,"light":"aniso_spec","occludes":true },
    { "id":"W_FAB_MOD", "prefab":"Fab_Wall_Panel_2x3",   "collision":"block","height":3.2,"light":"matte","occludes":true },
    { "id":"W_WHITEBRD","prefab":"Fab_Wall_Whiteboard_2x3","collision":"block","height":3.2,"light":"gloss","occludes":true },
    { "id":"D_SLIDE",   "prefab":"Fab_Door_Slide_Glass", "collision":"portal","height":3.2,"light":"refractive","nav":"portal" }
  ],
  "prop": [
    { "id":"P_BENCH",   "prefab":"PROP_DESK_BENCH", "collision":"box","height":0.74,"light":"shadow_caster" },
    { "id":"P_DASH",    "prefab":"PROP_VIDEO_WALL", "collision":"none","height":3.0,"light":"emissive","mount":"wall" },
    { "id":"P_PART",    "prefab":"PROP_GLASS_PART", "collision":"box_thin","height":2.4,"light":"refractive" },
    { "id":"P_RACK",    "prefab":"PROP_SERVER_RACK","collision":"box","height":2.1,"light":"emissive" }
  ]
}
```

**Atlas metadata contract:** `collision ∈ {walk, block, portal, box, box_thin, none}` · `height` in metres (drives wall extrude + NavMesh) · `light` = shading/lighting behaviour · `occludes` = blocks the top-down camera's ceiling cull & GI.

```csharp
// Re-bake legacy 2D grid → 3D world
foreach (var cell in legacyGrid) {
    var t = atlas.Resolve(cell.tileId);
    var go = Instantiate(t.prefab, GridToWorld(cell.xy, t.height), Quaternion.identity);
    if (t.collision == "block" || t.collision == "box") NavMesh.Carve(go);
    if (t.light == "emissive") RegisterLightSource(go);
}
```

---

## 6 · CAMERA & LIGHTING SPEC

### 6.1 Orthographic 2.5D camera

```json
{
  "projection": "orthographic",
  "ortho_size": 11.0,
  "pitch_deg": 32,           "yaw_deg": 45,     
  "clip": { "near": 0.1, "far": 120 },
  "pixel_snap": false,
  "render_pipeline": "URP",
  "note": "Dimetric 2:1 read; pitch 30–35° gives wall-face depth without true perspective."
}
```

### 6.2 Cinemachine zone framing

```json
{
  "brain": { "default_blend": "EaseInOut", "blend_time": 0.8 },
  "vcams": [
    { "id":"VCAM_OVERVIEW", "priority":10, "ortho_size":16, "follow":"none",       "confiner":"WholeFloor" },
    { "id":"VCAM_HUB",      "priority":0,  "ortho_size":9,  "lookat":"HUB_CORE",   "confiner":"CommandCenter" },
    { "id":"VCAM_LAB",      "priority":0,  "ortho_size":8,  "lookat":"LAB_CENTROID","confiner":"CapitalStackLab" },
    { "id":"VCAM_EXEC",     "priority":0,  "ortho_size":7,  "lookat":"EXEC_CENTROID","confiner":"ExecutivePods" }
  ],
  "transition": "raise target vcam priority on zone focus; CinemachineConfiner2D clamps to zone bounds"
}
```

```csharp
void FocusZone(string zoneId) {
    foreach (var v in vcams) v.Priority = (v.zone == zoneId) ? 20 : 0;
    overview.Priority = string.IsNullOrEmpty(zoneId) ? 10 : 0;   // fall back to overview
    // CinemachineBrain auto-blends (0.8s EaseInOut).
}
```

### 6.3 Lighting rig (URP)

|      Element      |                                                    Setup                                                    |
|-------------------|-------------------------------------------------------------------------------------------------------------|
| Sun / key         | Single directional, 35° elevation, 4200K, soft shadows (2048, 2 cascades)                                   |
| Ambient           | Gradient IBL (sky 4500K / floor bounce warm), intensity 0.35                                                |
| Room key lights   | Per-zone `Light` from `lighting_profile` (K + lux above)                                                    |
| Emissive sources  | LED panels / video walls / rigs contribute via **light probes + reflection probes** (baked+realtime hybrid) |
| Light probes      | 3 m grid, denser (1.5 m) around emissive walls                                                              |
| Reflection probes | 1 per room, boxed to zone bounds, blended on glass/metal                                                    |
| Ceiling cull      | Layer 5 fades out above camera pitch threshold (keeps top-down read)                                        |

### 6.4 Ambient occlusion & shadow rules

```json
{
  "ssao": { "enabled": true, "intensity": 0.6, "radius": 0.35, "falloff": 2.0, "downsample": true },
  "contact_shadows": { "enabled": true, "distance": 0.5 },
  "shadow_rules": {
    "static_props": "baked into lightmap + SSAO",
    "dynamic_props": "realtime soft, max_distance 25m, fade last 5m",
    "glass": "no shadow cast, receives caustic-lite decal",
    "emissive": "no shadow cast; drives GI bounce only"
  },
  "post": { "bloom": { "threshold": 1.1, "intensity": 0.25 }, "vignette": 0.18, "color_grade": "cool_enterprise_LUT" }
}
```

### 6.5 Depth & clarity guidance

- Keep **wall faces visible** (32° pitch) but **cull ceilings** so the plan stays legible — the core 2.5D contract.
- Grounded **SSAO + contact shadows** replace the 2D drop-shadows; every prop reads as seated on the slab.
- **Emissive-only** GI from LED/video walls gives the "enterprise sim" glow without blowing out clarity.
- Cool enterprise LUT + restrained bloom = clean, modern, high-clarity finish.

---

## Build order (recommended)

1. Grey-box zones from §1.3 rects (ProBuilder) → validate orthographic read.
2. Drop Fab kits (§2) on 2 m snap; assign procedural materials.
3. Scatter props (§3) with the dressing pass; bake NavMesh + carve.
4. Author node graph (§4) as ScriptableObject; wire routing hooks.
5. Place lighting rig + probes (§6.3); bake GI.
6. Cinemachine vcams + confiners (§6.2); tune blends.
7. Re-bake legacy 2D grid via the atlas (§5) for parity checks.

