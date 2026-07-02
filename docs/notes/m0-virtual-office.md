# M0 — Virtual Office: World + Local Movement

## Scope

Phaser 3 game embedded inside the existing Next.js `/dashboard/office` page.
Single player avatar (Earnest Fundmaker sprite) walks a 3×3 office grid with
tile collisions and camera follow. No server. No other players yet.

## Map Layout

Nine rooms in a 3×3 grid, each 384×288 px (12×9 at 32 px/tile).
Existing room PNG assets fill each cell as background images.

```
┌──────────────┬──────────────┬──────────────┐
│  CEO Office  │  Boardroom   │Trading Floor │  row 0
├──────────────┼──────────────┼──────────────┤
│ Research Hub │ Main Office  │  Ops Hub     │  row 1
├──────────────┼──────────────┼──────────────┤
│ Legal Corner │  Marketing   │  Reception   │  row 2
└──────────────┴──────────────┴──────────────┘
```

Total world: 1152 × 864 px.

## Walls & Doorways

- Perimeter: 8 px static physics walls on all 4 edges.
- Between rooms: thin vertical/horizontal wall strips with a 64 px doorway gap
  centered on each shared edge (one gap per shared edge).
- All wall bodies are invisible (alpha=0 graphics).

## Player

- Sprite: `/assets/fundexecs/characters/earnest-fundmaker/sprite.png`
- Frame: 32×32, rows 0–7 (idle/walkDown/walkUp/walkLeft/walkRight/talk/success/loading)
- Speed: 160 px/s; diagonal normalized.
- Camera: follow player with lerp 0.1, clamped to world bounds.

## Tech

- Phaser 3, imported dynamically (browser-only) via `next/dynamic`.
- React wrapper manages game lifecycle (create on mount, destroy on unmount).
- Rendered alongside existing ExecutiveHQ — user toggles between "HQ View" and
  "Virtual Office" via a tab in the office page.

