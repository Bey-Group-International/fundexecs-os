# Scrapeyard

Archived prototypes and experiments that are **not** part of the Next.js app
build. Nothing here is imported by the application; these files are kept for
reference only.

## `map-builder.html`

A self-contained, single-file **Map Builder** for the FundExecs OS virtual
office — a navy + gold, Spot-inspired institutional office designer. Open it
directly in any browser (no server or build step required).

Highlights:
- Dual projection: top-down 2.5D and a first-person walkthrough (WASD + mouse).
- Spot-style **Build Mode**: Add / Floorplan / Environment / Brand tabs, search,
  a category icon rail, big thumbnail catalog, and a floating action toolbar.
- Rich institutional asset library with per-object **style galleries**
  (tables, seating, desks, storage…) and swappable finishes (mahogany, walnut,
  oak, ebony, marble) and executive leathers.
- Rooms, corridors, doors, walls, walkable tiles, full-office templates, and a
  live-activity simulation (raise stations tick, jumbotron leaderboard) with a
  `window.FundExecsActivity` / `postMessage` API for real data.
- Double-click to unlock movement; single-file, self-persisting via
  `localStorage`.

This is the design prototype behind the in-app office map component
(`app/(app)/dashboard/office/`).
