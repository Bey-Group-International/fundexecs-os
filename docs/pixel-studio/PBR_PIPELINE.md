# PBR Showcase Pipeline

PBR Showcase is a **material-aware raster preview**, separate from the native
pixel runtime. It exists to review materials and lighting — it never replaces or
mutates the native asset, and its renders are stored separately under
`pbr-showcase/`.

## Implementation

`lib/pixel-studio/pbr/pbr-preview.ts` is a per-pixel software shader (an
"equivalent shader layer"; a WebGL2 port can drop in behind the same interface):

1. The compositor produces a **material frame** — the native color raster plus a
   parallel per-pixel material-index map (`composeFrameWithMaterials`).
2. A **height field** is generated from each material's `relief` modulated by
   local luminance; **surface normals** come from a Sobel derivative of that
   field. These are the deterministic normal/height masks — no random detail.
3. Each pixel is lit with a directional **key light** (adjustable angle +
   intensity), a **fill** term, and an **ambient** term scaled by `ao`.
4. Response uses the material's `roughness` (specular lobe sharpness),
   `metallic` (tints specular by base color, darkens diffuse), `specular`
   intensity, and `emissive` (screens/LEDs self-illuminate).

## Material presets

`skin, wool-matte, cotton, silk, leather, hair-matte, metal-brushed,
metal-polished, glass, plastic, wood, stone, screen` — the 13 required presets,
each with `roughness/metallic/ao/specular/emissive/relief`.

## Adjustable lighting

`LightRig` exposes `keyDir` (direction), `keyIntensity`, `fillIntensity`,
`ambient`. The Character Studio wires angle + key intensity sliders; the Map
Studio exposes a PBR toggle for floor/metal/glass/screen/fabric response.

## Pixel bake

`bakeToPalette(shaded, hexes)` quantizes a PBR-lit frame back to a fixed palette
with **hard transitions** (nearest-color, no filtered downsampling). Because the
palette's brightest entries are few, specular naturally collapses to one or two
pixels — matching the native pixel-art contract. Baked results never introduce
colors outside the palette.

## Guarantees (tested)

- `renderPbr` returns a new raster; the native frame is byte-identical before
  and after (`pixel-studio.test.ts` → "does not mutate the native frame").
- Output changes with light direction ("responds to light direction").
- Exported native/runtime PNGs come from the pixel compositor, never from PBR.
