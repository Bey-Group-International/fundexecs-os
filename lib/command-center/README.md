# Command Center — spatial office world

A Gather-style, top-down office re-skinned for FundExecs OS. Earn (the COO,
rendered as the real `/earn-coin.png`) orchestrates the executive team across
private-market workflow offices while the operator watches in a split-pane view.

Original work — inspired by the _style_ of Gather (top-down tiles, spatial
rooms, walk/idle motion) and Pokémon Gen-II overworld motion, but no proprietary
assets are used. Office dressing follows the Gather 2.0 look (soft rounded
furniture, ambient room glows) on the FundExecs dark/institutional brand.

## Layout

```
lib/command-center/
  types.ts        Pure data shapes (tiles, rooms, avatars, chat, status)
  map.ts          Deterministic 6-zone floor: hub + 5 offices, 2-wide corridors
  pathfinding.ts  A* over the tile grid (zero deps)
  roster.ts       Maps the real lib/agents.ts catalog → world avatars
  engine.ts       Deterministic simulation + scripted-scenario runner
  flows.ts        Flow A (delegate) and Flow B (Earn executes) timelines
  adapter.ts      Data + Earn-driver seam for swapping in live data later

app/(app)/command-center/
  page.tsx          Authed route shell
  CommandCenter.tsx Split-pane orchestrator (chat · world · panels · minimap)
  ChatPane.tsx      Earn composer, recommendations, approve/automate
  WorldCanvas.tsx   Canvas renderer (humanoid sprites + Earn coin)
```

## The two flows

- **Flow A — User-Driven Automation:** user prompts → Earn recommends → user
  approves → Earn delegates → executives walk to their offices and execute in
  parallel.
- **Flow B — Earn-Driven Execution:** same opening, but Earn takes the work
  directly (walks to the relevant desk) while executives assist.

Both run as deterministic `Step[]` scripts (`flows.ts`) with approval + arrival
gates, so the demo is identical every time.

## Extending

- **Add a room:** append a `RoomDef` to `ROOMS` in `map.ts` (rect, door, desks,
  stand cells, accent) and add a corridor to wire it to the hub. Pathfinding and
  rendering pick it up automatically.
- **Station an executive:** add an entry to `STATIONING` in `roster.ts`.
- **New scenario:** author a `Step[]` in `flows.ts` (or generate one at runtime).

## Live-data seam

`adapter.ts` defines `WorldDataSource` (executives) and `EarnDriver` (turns a
prompt into a `Step[]`). v1 ships `demoDataSource` + `scriptedEarnDriver`. A
later pass can implement a live `EarnDriver` over the repo's `earn-conversation`
+ `@anthropic-ai/sdk` and a live `WorldDataSource` over `team-tasks` / Supabase
without touching geometry, rendering, or the engine.

## Rendering notes

- `WorldCanvas` is a dependency-free Canvas renderer driving the engine via
  `requestAnimationFrame`. A future upgrade to Three.js + GSAP (per AGENT.md's
  avatar protocol) can replace the renderer while reusing `engine` + `map`.
- Executives are procedural humanoid "trainer" sprites (4-direction, 2-frame
  walk); Earn is the coin asset with a neural-green halo and a delegate burst.

