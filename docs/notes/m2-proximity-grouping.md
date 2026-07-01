# M2 — Proximity Grouping Design

## Goal

When two or more avatars move within `BUBBLE_RADIUS` pixels of each other they
form a **bubble**.  Bubbles dissolve when all members drift beyond
`BUBBLE_RADIUS + HYSTERESIS` (a dead-band that prevents flickering on the
boundary).  No media yet — M2 proves the grouping is correct and stable first.

## Constants

```
BUBBLE_RADIUS   = 160 px   (~5 tiles)  enter threshold
HYSTERESIS      =  40 px   exit threshold = BUBBLE_RADIUS + HYSTERESIS = 200 px
MAX_BUBBLE_SIZE =   4       mesh limit (mediasoup kicks in at M4)
```

## Server spatial index

We use a coarse **cell grid** (`CELL_SIZE = BUBBLE_RADIUS`) over the world
(1152 × 864).  Each player maps to a cell; neighbours are the 3×3 block of
cells around the player's cell.  This keeps the per-move check O(1) amortised
rather than O(n²).

On each `player.move` the server:
1. Updates the player's cell in the grid.
2. Queries the 3×3 neighbourhood.
3. Filters to players within `BUBBLE_RADIUS` (Euclidean).
4. Runs the **bubble reconciler** (see below).

## Bubble state machine

Each bubble has a stable UUID and a `Set<playerId>`.

**Reconciler per player (called after every move):**

```
closeSet  = {players within BUBBLE_RADIUS of me}
farSet    = {players I'm currently grouped with but now > EXIT_RADIUS}

for each p in farSet:
    if bubble(me).size == 2:  dissolve bubble
    else: remove p from bubble(me); if p now alone: dissolve their bubble

for each p in closeSet not in my bubble:
    if no bubble exists for p:  add p to my bubble (or create new)
    else if bubble(p).size < MAX and bubble(me) != bubble(p):
        merge smaller into larger bubble
```

Merges produce a single canonical bubble (pick the one with the lower UUID).
Splits are natural — when removal leaves a player alone they get no bubble.

## Wire messages (new in M2)

Added to `shared/src/messages.ts`:

```typescript
// Server → Client
{ type: "bubble.join",  bubbleId: string, members: string[] }   // you joined a bubble
{ type: "bubble.leave", bubbleId: string }                       // you left / bubble dissolved
{ type: "bubble.update",bubbleId: string, members: string[] }   // member joined/left your bubble
```

No client→server messages; grouping is fully server-authoritative.

## Client overlay

A thin React component `BubbleOverlay` renders a pill at the top-right of the
game canvas listing the display names of everyone in your current bubble.
State is managed in `VirtualOfficeGame.tsx` via a `bubbleMembers` useState and
forwarded to the scene via `game.events.emit("bubble:update", members)`.

## Hysteresis proof

A player ping-ponging on the boundary at radius `R`:
- enters at `< 160` → join event
- exits at `> 200` → leave event
- re-enters at `< 160` → join event
This produces at most one join/leave pair per crossing, not continuous churn.

## Not in M2

- Audio / video — M3
- Spatial audio attenuation — M3
- mediasoup upgrade — M4
- Chat — M5

