# Map Authoring

The Map Studio (`/virtual-office/pixel-studio/map`) is a 32×32 orthogonal tile
editor for FundExecs workspaces.

## Workflows

- **Create** from a template (Open Office, Meeting Room, Reception) or blank.
- **Place / erase / select** tools; click-drag paints. Assets snap to tiles.
- **Layers**: exterior, ground, floor, walls, furniture, technology, signage,
  screens, decor, collisions, interactions, spawns, entrances, exits, overhead —
  each toggle-able for visibility and lock.
- **Resize** the grid, toggle the grid overlay, zoom.
- **Branding**: company name + primary/secondary colors drive signage, logos,
  rugs, and screens.
- **PBR toggle** previews floor roughness / metal / glass / screen emission /
  fabric under directional light (preview only).
- **Undo/redo**, **save/load** named projects (localStorage), **autosave**.
- **Import** Tiled JSON/TMJ, **export** `.tmj` or a full map bundle ZIP.

## Collision authoring

Colliding assets (walls, desks, tables, servers) automatically stamp cells into
the **collisions** layer on placement. On export these become a dedicated
collision tile layer with a `collides:true` tile property (WorkAdventure reads
the property; the layer preserves the data on round-trip).

## Interaction & markers

Spawn, exit, entrance, meeting, silent, and openWebsite markers are placed like
any asset and export as typed Tiled objects (`start` point, `exitUrl`,
`jitsiRoom`, `openWebsite`, `silent`). Only typed WA interaction objects are
emitted — arbitrary object-layer behavior is not relied upon.

## Map bundle (`{mapId}.zip`)

```
{mapId}.tmj                 Tiled JSON (orthogonal, 32px, floorLayer, tileset)
tileset.png                 rendered tileset atlas (16 cols)
preview.png                 flattened map preview
map-assets.json             asset manifest (collision/interaction/material)
pbr-sidecar.json            preview-only PBR metadata (runtime tiles stay raster)
compatibility-report.json   valid / missing / unsupported / flattened checks
ATTRIBUTION.txt
```

## WorkAdventure compatibility

The Tiled adapter (`adapters/tiled.ts`) guarantees: 32×32 orthogonal grid, a
required **floorLayer** object group, embedded tileset metadata, collision tile
properties, transparent tiles (gid 0), spawn/`start` metadata, exits, and a
map/tileset copyright property. Characters render below the `overhead` layer
(marked `wa:overhead`, rendered last). Every export ships a compatibility report
that identifies valid requirements, missing requirements, unsupported
properties, flattened layers, and attribution gaps.
