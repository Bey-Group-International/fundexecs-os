# Virtual Office — Spot-reference roadmap

A phased plan for evolving the FundExecs OS Virtual Office (`app/(app)/office`,
`public/office/map.html`) using **Spot** (spotvirtual.com) as a reference point,
grounded in what the codebase already has.

> **Positioning:** Spot now markets itself as a *"virtual workspace for humans
>
>> **and AI agents**."* FundExecs OS is already deeper on the agent axis (persona
>> teammates with introspection + delegation + Brains). The goal is **not** to
>> clone Spot — it is to reach parity on the spatial/presence basics we lack while
>> keeping our agent lead. Where Spot has humans in a room, we have humans *and* a
>> living AI staff.

---

## 0 · Reference → capability map

What Spot does, and where we stand today.

|                            Spot capability                             |                               FundExecs OS today                               |                      Gap                       |
|------------------------------------------------------------------------|--------------------------------------------------------------------------------|------------------------------------------------|
| Avatar-based spatial office (2.5D)                                     | ✅ `map.html` — top-down + first-person, cover-fit stage                        | —                                              |
| Build mode (floorplan, rooms, doors, props, zones, branding, ambience) | ✅ Full Build Mode + layers panel + brand/environment tabs + saved layouts      | —                                              |
| Customizable personal avatar                                           | ✅ Character Selector (`office/builder`) → `office_member_prefs.avatar`         | Not yet shown in the office                    |
| Presence status (available/busy/away/dnd)                              | ✅ status rings on persona avatars                                              | Only on AI personas, not the user/teammates    |
| "See who's around" (live humans)                                       | ❌ single-user + AI NPCs only                                                   | **Multiplayer presence**                       |
| Move your avatar around                                                | ❌ user has no in-world avatar                                                  | **You on the floor**                           |
| Proximity **spatial audio/video**                                      | ❌                                                                              | **Spatial A/V** (highest infra cost)           |
| Meetings without links (walk into a room → session)                    | Partial — `/meetings`, `/meeting-room` exist but aren't wired to the floor     | **In-room meetings**                           |
| In-office chat + search                                                | ❌ (app has `/inbox`, not in-office chat)                                       | **Office chat**                                |
| Reactions / emotes / high-fives                                        | ❌                                                                              | **Reactions**                                  |
| Screenshare / whiteboard / shared browser                              | ❌ in office (elsewhere in app)                                                 | Later                                          |
| Locked rooms / knock-to-enter                                          | ❌                                                                              | Later (with meetings)                          |
| Live activity on the walls                                             | Dormant `postMessage({type:'fx-activity'})` hook in `map.html`                 | Wire it up                                     |
| AI teammates that *do things*                                          | ✅ intent bubbles (`/api/avatars/introspect`), delegation, corridor pathfinding | **Our differentiator — extend, don't rebuild** |

**Decisions locked for this round**

- **Single-user now.** No multiplayer infra is added in Phase 1.
- **When real-time lands, use Supabase Realtime** (migration `0012_realtime` is
  already provisioned) — presence, positions, chat all ride Realtime channels.
  No new infra service.

---

## Phase 1 — "You" on the floor  *(this round, single-user)*

Make the character we just built actually present in the office.

- `/office` (server) loads the member's saved `AvatarConfig` from
  `office_member_prefs` and hands it to the client, which posts it into the
  `map.html` iframe (`postMessage({type:'fx-you', config})`).
- `map.html` renders **you** as a paper-doll billboard from the config, placed at
  a spawn point on the open floor, depth-sorted into the scene like the persona
  avatars, with a **name chip + status ring**.
- **Movement:** click-to-walk on walkable floor; pathing reuses the existing
  corridor graph (`NODE`/`EDGE`/`bfs`) and room/doorway logic so you never walk
  through walls. Keyboard nudge (WASD/arrows) as a bonus.
- **Shared renderer:** extract `renderAvatarPaperDollSvg(config)` (a pure SVG
  *string* builder in `lib/office/avatarPaperDoll.ts`) as the single source of
  truth used by both the React `AvatarPaperDoll` component and vanilla `map.html`.

**Done when:** a member who saved a character sees that exact character on the
floor and can walk it around, verified headless (inject config → avatar node
exists → click → position changes).

---

## Phase 2 — Live presence *(Supabase Realtime)*

Turn the diorama into a shared space.

- A `presence` channel per org room (`office:${orgId}`) tracks each online
  member's `{principalId, config, x, y, status, room}` via Realtime **Presence**.
- Render every present teammate as their own paper-doll (reusing Phase 1's
  renderer + movement), depth-sorted with the AI staff.
- Broadcast position on a throttled cadence (~8–10 Hz, interpolated client-side)
  on a Realtime **broadcast** channel to keep Presence state small.
- Respect the existing analytics **opt-in** (`office_member_prefs.analytics_opt_in`)
  and privacy posture; presence is ephemeral, not persisted.

**Done when:** two browsers in the same org see each other move in real time.

---

## Phase 3 — Walk-into-a-room meetings

Spot's "meetings without links," bridged to what we already have.

- Room objects gain an optional `meetingKey`. Walking your avatar into the room
  (or an "Enter" affordance) joins/creates the session using the existing
  `/meeting-room/[roomId]` stack — no calendar link.
- Show room occupancy (who's inside) on the floor; **locked rooms** + a simple
  **knock-to-enter** for private rooms (HR/1:1 parity with Spot).
- Reuse Phase 2 presence to populate the room's participant list.

**Done when:** entering a floor room opens the live meeting for everyone in it.

---

## Phase 4 — In-office chat + reactions

Lightweight, spatial, ephemeral.

- Realtime **broadcast** channel for office chat (proximity-scoped or floor-wide)
  and **reactions/emotes** (high-five, 👍, 🎉) that pop over the sender's avatar.
- Optional: pipe app events into the dormant `fx-activity` hook so raises,
  deals, and runs surface as ambient "living office" moments on the walls.

**Done when:** members can chat and react in the office without leaving it.

---

## Phase 5 — Spatial A/V *(only if it's a real goal)*

Highest cost, deferred deliberately.

- Proximity audio/video via WebRTC with an SFU (e.g., LiveKit/mediasoup) — a real
  infra commitment (TURN, media servers, bandwidth) beyond Supabase Realtime.
- Gate behind a clear product decision; Phases 1–4 deliver most of Spot's
  day-to-day value without it.

---

## Guardrails

- **`map.html` stays self-contained.** It's a static asset; new logic is vanilla
  JS inside it, fed by `postMessage`. The single shared piece of code is the
  avatar SVG string builder, kept framework-agnostic.
- **One renderer, one identity.** The paper-doll builder and the `AvatarConfig`
  catalog are the source of truth for how a person looks, everywhere.
- **Privacy first.** Presence honors opt-in; positions are ephemeral; locked
  rooms mean locked.
- **Agent lead is the moat.** Every phase should make humans and the AI staff
  share one legible space — not bolt humans onto a separate system.

