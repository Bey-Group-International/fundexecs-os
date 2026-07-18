# Asset Authoring

Assets are **data**, not files: each is a `recipe` the procedural compositor
paints. This keeps the modular system honest — every asset shares one
registration origin, frame grid, and palette system.

## Asset file contract

Even though native runtime frames are composited on demand, exported/pre-baked
PNGs follow the contract:

- Transparent PNG, exact declared dimensions (32×32 native; 256×256 at 8×).
- Same frame origin (anchor `{x:16, y:30}`).
- No partially-transparent anti-aliased edges (the ground shadow is the only
  intentional semi-transparent element and lives on its own layer).
- Approved palette colors only; integer pixel placement.

### Naming convention

`{category}_{fitGroup}_{optionId}_{state}_{scale}.{ext}` — e.g.
`hair_f_bob01_walk_8x.png`, `outfit_u_suit01_talk_1x.png`. Use `u` for universal
assets. IDs never encode user-facing labels.

## Recipe kinds

The compositor (`compositor.ts`) dispatches on `recipe.kind`:

| kind | params | painter |
|---|---|---|
| `face` | width, jaw, brow, eyeSpacing, nose, age | jaw/cheek/brow shaping |
| `expression` | expression (neutral/smile/focused/talk) | eyes, brows, mouth |
| `hair` | coverage, length, volume, style | crown/fringe/back mass |
| `facialHair` | style, density | jaw/mustache coverage |
| `headCovering` | style, drape | crown/wrap/brim |
| `outfit` | part, skirt?, sheen?, neck? | garment sublayer |
| `accessory` | acc, shape? | per-accessory geometry |

## Adding an asset (existing kind)

1. Push an entry in the relevant `build*()` function in `manifest-build.ts`.
2. Give it a unique `[a-z0-9-]` id, slot, zIndex, fitGroups, material, and WA
   category.
3. Declare `requires` / `excludes` / `occludes` as needed (never self-exclude —
   the mutual lists are filtered).
4. `npm run pixel:manifest` (validates counts, refs, ramps) then
   `npm run pixel:assets` to re-render examples.

## Adding a recipe kind

Add a painter to the `painters` map in `compositor.ts` keyed by the new kind,
then reference it from an asset recipe. Painters receive `(ctx, palette, layer)`
where `ctx` carries the direction, pose, and target raster. Only use
`Raster.set/hline/vline/fillRect` at integer coordinates.

## Palette roles

Every material ramp defines: `deepShadow, shadow, base, midtone, highlight,
specular`. Painters reference roles, not literal colors, so a palette swap
recolors every pixel with zero per-asset duplication. `makeRamp()` guarantees a
monotonic, non-muddy ramp; `validate:assets` rejects inversions.
