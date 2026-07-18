# FundExecs Pixel Character & Map Studio

A production browser-based **raster pixel-art** studio that replaces the legacy
vector avatar system with a modular, manifest-driven executive-character editor
and a 32×32 tile map editor. It is WorkAdventure-compatible for export and
Spot-inspired for customization depth, with a separate PBR material-preview
mode.

> **Art-pipeline note.** Rather than shipping thousands of hand-authored PNGs,
> the full inventory is produced by a **deterministic procedural raster
> compositor**: the manifest declares palettes, materials, layers, and per-asset
> pixel *recipes*, and the compositor paints them onto a canvas at integer
> coordinates with smoothing disabled. This is genuine raster pixel art (hard
> edges, limited palettes, nearest-neighbor only) — there is **no vector/SVG
> rendering and no anti-aliasing** in the native output. See
> [`PBR_PIPELINE.md`](./PBR_PIPELINE.md) and [`ASSET_AUTHORING.md`](./ASSET_AUTHORING.md).

---

## 1. Installation

```bash
npm install          # installs deps incl. tsx (used by the pixel scripts)
```

Node 20+ is required (the repo runs on Node 22). The pixel scripts run through
`tsx`; the app runs under Next.js 16 / React 19 like the rest of the repo.

## 2. Development commands

```bash
npm run dev                 # start the FundExecs app (Next.js)
# then open:
#   /virtual-office/pixel-studio        → Character Studio
#   /virtual-office/pixel-studio/map    → Map Studio

npm run pixel:manifest      # (re)generate public/pixel-studio/manifest.json + validate
npm run pixel:assets        # headlessly render the 8 example sprite sheets (native + 8×)
npm run pixel:export        # export every example (WA + extended) and every map template to /exports
```

## 3. Validation & tests

```bash
npm run validate:assets     # manifest schema + semantics + inventory counts + image checks
npm run validate:exports    # bundle assembly + Tiled round-trip integrity
npm test -- pixel-studio     # jest unit + integration suite
npm run typecheck           # tsc --noEmit (whole repo, includes pixel-studio)
```

The build gates on validation: `validate:assets` and `validate:exports` exit
non-zero on any critical error.

## 4. Production build

```bash
npm run build && npm start
```

## 5. Architecture

Concerns are separated into pure domain/rendering libraries (`lib/pixel-studio`)
and React UI (`components/pixel-studio`), wired by thin App-Router pages.

```
lib/pixel-studio/
  types.ts              domain types (single source of truth)
  ramp.ts               palette-ramp construction
  palette-engine.ts     color parsing, resolved palettes, ramp health
  rng.ts                seeded mulberry32 PRNG
  schema-validate.ts    dependency-free JSON-Schema (draft-07 subset) validator
  manifest-build.ts     builds the complete inventory-complete manifest
  manifest.ts           manifest access + full validation (schema+semantics+counts)
  asset-registry.ts     indexed lookups + data-driven compatibility/occlusion
  character.ts          config defaults, randomization, migration, share tokens
  raster.ts             DOM-free RGBA pixel buffer (nearest-neighbor)
  pose.ts               per-frame animation offsets
  compositor.ts         procedural pixel painters → native frames/sheets
  animation-player.ts   frame-index sequencing
  canvas.ts             browser canvas bridge (smoothing off)
  pbr/pbr-preview.ts    software PBR shader + pixel bake
  adapters/
    workadventure.ts    6-category Woka walk-sheet adapter + report
    tiled.ts            MapProject ↔ Tiled TMJ + collision/floorLayer + report
  map/
    map-assets.ts       tile/object catalog
    map-compositor.ts   tile/object painters, map preview, tileset atlas
    map-project.ts      blank/template projects + edit operations
  zip.ts / zip-read.ts  dependency-free STORE ZIP writer/reader
  export-service.ts     the three isomorphic export bundles
  node/png.ts           NODE-ONLY PNG encoder/decoder (scripts/tests)

components/pixel-studio/
  PixelCanvas.tsx           animated pixel/PBR canvas
  useCharacterStudio.ts     character studio store (reducer + localStorage)
  PixelCharacterStudio.tsx  three-panel character editor
  MapCanvas.tsx             map render + tile interaction
  useMapStudio.ts           map studio store
  PixelMapStudio.tsx        map editor
  exports-client.ts         browser export/download helpers

app/(app)/virtual-office/pixel-studio/            Character Studio route
app/(app)/virtual-office/pixel-studio/map/        Map Studio route
schemas/                                          manifest / character / map JSON Schemas
scripts/pixel-studio/                             generate + validate + export CLIs
```

## 6. Character assembly & internal layer order

A character is a stack of resolved layers, ordered by `zIndex` then the internal
`layerOrder`:

```
shadow → accessory.back → hair.back → headCovering.back → body.skin →
outfit.lower → outfit.base → outfit.shirt → outfit.outer → outfit.shoes →
face.base → face.features → expression → facialHair → hair.front →
headCovering.front → neckwear → eyewear → accessory.front → handheld → state.effect
```

The body skin is painted first (from the skin palette); every other layer is a
registered asset painted by its recipe. Compatibility (`requires`/`excludes`/
`occludes`/`fitGroups`) is **data only** — the UI asks the registry to resolve
the stack (`AssetRegistry.resolveLayers`) and never hardcodes rules.

## 7. WorkAdventure layer mapping

The internal model collapses to the six Woka categories on export:

| Internal slots | Woka category |
|---|---|
| body.skin, face.base | `body` |
| expression, face.features | `eyes` |
| hair.*, facialHair, headCovering.* | `hairs` / `hats` |
| outfit.* , neckwear | `clothes` |
| accessory.*, eyewear, handheld | `accessories` |

Each category is rendered to a **96×128** three-frame walk sheet (down/left/
right/up). See [`WORKADVENTURE_EXPORT.md`](./WORKADVENTURE_EXPORT.md).

## 8. Extending the system (no app-code changes)

All of the following are edits to `manifest-build.ts` only (then `npm run
pixel:manifest`):

- **Add a face** — push to `buildFaces()` with `recipe.kind:"face"` params
  (`width/jaw/brow/eyeSpacing/nose/age`) and a `masculine-fit`/`feminine-fit` tag.
- **Add a hairstyle** — push to `buildHair()` with `recipe.kind:"hair"`
  (`coverage/length/volume/style`).
- **Add facial hair** — push to `buildFacialHair()` (`recipe.kind:"facialHair"`).
- **Add a head covering** — push to `buildHeadCoverings()`; set `occludes:
  ["hair.front"]` if it replaces front hair.
- **Add an outfit system** — add a spec to `buildOutfits()` with its sublayer
  `parts` and ≥3 `colorways` (palette id per slot).
- **Add an accessory** — add to `buildAccessories()` with slot/z/material and a
  `recipe.kind:"accessory"` `acc` param; add a painter branch in
  `compositor.ts` if it needs new geometry.
- **Add an animation** — add to `manifest.animations` and a case in `pose.ts`.
- **Add a palette / hair color / skin tone** — add to `buildPalettes()` via
  `makePalette(id, label, group, baseHex)`.

The compositor dispatches painters by `recipe.kind`; adding a brand-new *kind*
means adding a painter function. Adding new *assets of an existing kind* needs
no code.

## 9. 8× review assets

`Raster.scaleNearest(8)` is the only scaling permitted for review images — an
exact 256×256 replica of each 32×32 frame with no interpolation. `validate:
assets` re-derives the enlargement and asserts the bytes match.

## 10. PBR material authoring & pixel baking

See [`PBR_PIPELINE.md`](./PBR_PIPELINE.md). In short: materials declare
`roughness/metallic/ao/specular/emissive/relief`; the software shader lights the
native frame using generated normal/height masks; `bakeToPalette` quantizes the
result back to hard palette pixels. **PBR never mutates the native asset** and
its renders are stored separately (`pbr-showcase/`).

## 11. Map creation, Tiled I/O, collision, branding

See [`MAP_AUTHORING.md`](./MAP_AUTHORING.md). The map editor is a 32×32
orthogonal grid; export produces WorkAdventure-compatible Tiled JSON with a
`floorLayer`, `collides` tile properties, spawn/exit objects, embedded tileset
metadata, and a compatibility report.

## 12. Schema migration

`character.ts#migrateConfig` upgrades old configs: unknown assets fall back to
defaults with human-readable notes, and the manifest version is bumped.
Non-breaking manifest additions keep old configs loadable.

## 13. Known compatibility limitations

- **Native runtime art is pixel art. PBR Showcase is a separate raster
  preview** used for material/lighting review only — it is never exported as
  runtime art.
- **Extended animation states (idle / talk / approve) are FundExecs
  extensions.** The standard WorkAdventure Woka format only defines the walk
  sheet, so those states ship only in the extended bundle and require FundExecs
  or custom runtime support. The WA report marks them `unsupported` explicitly.
- Left/right profiles are simplified relative to front/back (shared silhouette
  with side-weighted features) — legible at 1× but less detailed than the front.
- Hairstyles are modeled as single `hair.front` assets; a full head covering
  occludes `hair.front` in whole. The internal model reserves `hair.back` for a
  future split.
- The compositor is procedural; art is intentionally institutional/minimal
  rather than highly ornamented.
```
