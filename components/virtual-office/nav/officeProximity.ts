/**
 * FundExecs OS — office proximity detection (pure geometry, no renderer).
 *
 * Answers "which executive agent is the user standing next to?" so a
 * proximity/NPC-dialogue feature can pop a greeting or dialogue card when the
 * avatar draws near an agent. It only does distance math over labelled points;
 * deciding what card to show is left to the caller.
 *
 * Renderer-agnostic and dependency-free (no Three.js, no Phaser, no DOM, no
 * React): both the 2D floor and the 3D `ThreeOfficeRenderer` can feed it their
 * actor positions. Pure and fully unit-testable.
 *
 * Coordinate space is the shared top-down office pixel space (`+x` right, `+y`
 * down), the same one `ROOMS` / walls / `officePathfinding` are defined in.
 */

/** A labelled point in office pixel space (avatar, agent, desk seat, …). */
export type ActorPoint = { id: string; x: number; y: number };

/** An actor found within a proximity radius, with its distance in pixels. */
export type ProximityHit = { id: string; distance: number };

/**
 * Default "adjacent desk" greeting radius, in office pixels.
 *
 * Rooms are 384×288 and tiles are 32px, so neighbouring desks sit a few tiles
 * apart. ~110px covers roughly three tiles — close enough to read as "standing
 * next to" an agent without firing across a whole room.
 */
export const DEFAULT_GREET_RADIUS_PX = 110;

/** Euclidean distance between two points, in pixels. */
export function distancePx(a: { x: number; y: number }, b: { x: number; y: number }): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

/**
 * All actors within `radiusPx` of `focus`, sorted nearest-first. Any actor
 * whose id equals `excludeId` is skipped (e.g. the focus actor itself). Ties
 * in distance keep their input order (stable sort).
 */
export function actorsWithin(
  focus: { x: number; y: number },
  actors: ActorPoint[],
  radiusPx: number,
  excludeId?: string,
): ProximityHit[] {
  const hits: ProximityHit[] = [];
  for (const actor of actors) {
    if (actor.id === excludeId) continue;
    const distance = distancePx(focus, actor);
    if (distance <= radiusPx) hits.push({ id: actor.id, distance });
  }
  hits.sort((a, b) => a.distance - b.distance);
  return hits;
}

/**
 * The single nearest actor within `radiusPx` of `focus`, or `null` if none.
 * Any actor whose id equals `excludeId` is skipped.
 */
export function nearestWithin(
  focus: { x: number; y: number },
  actors: ActorPoint[],
  radiusPx: number,
  excludeId?: string,
): ProximityHit | null {
  let best: ProximityHit | null = null;
  for (const actor of actors) {
    if (actor.id === excludeId) continue;
    const distance = distancePx(focus, actor);
    if (distance > radiusPx) continue;
    if (best === null || distance < best.distance) best = { id: actor.id, distance };
  }
  return best;
}

/**
 * Set diff of near-actor ids between frames: who newly `entered` proximity and
 * who `exited` it. Lets a UI fire a greeting only on ENTER, not every frame.
 * Order follows `current` for entered and `prev` for exited; duplicates within
 * either input are collapsed.
 */
export function enterExitTransitions(
  prev: string[],
  current: string[],
): { entered: string[]; exited: string[] } {
  const prevSet = new Set(prev);
  const currentSet = new Set(current);
  const entered: string[] = [];
  const exited: string[] = [];
  const seen = new Set<string>();
  for (const id of current) {
    if (!prevSet.has(id) && !seen.has(id)) {
      entered.push(id);
      seen.add(id);
    }
  }
  seen.clear();
  for (const id of prev) {
    if (!currentSet.has(id) && !seen.has(id)) {
      exited.push(id);
      seen.add(id);
    }
  }
  return { entered, exited };
}
