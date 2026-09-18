// lib/meetings/hands.ts
// Making a raised hand as hard to miss as an unread message.
//
// A hand went up and the room said so in two places: a ✋ on that person's
// tile, and a ✋ beside their name in the people list. Both are invisible most
// of the time — the tile is off-screen in speaker layout or below the fold in
// a large grid, and the people list is a tab inside a sidebar that is closed
// by default. So the person whose hand is up is waiting on somebody happening
// to look, while a one-word chat message lights a badge on the toolbar.
//
// Two rules close that, and both are here rather than in the room because both
// are about order and wording, which is the part worth pinning down: hands are
// answered in the order they went up, and the label has to read as a sentence
// at any count.

export interface Raiser {
  id: string;
  displayName: string;
}

/**
 * The people with a hand up, oldest first, excluding the viewer's own.
 *
 * Order comes from `raised` rather than from the participant list: a Set keeps
 * insertion order, and insertion order here is the order the hands went up,
 * which is the order a chair would take them in. Your own hand is dropped
 * because you know about it — it is the others you are being told about.
 */
export function raisedBy(
  raised: Iterable<string>,
  participants: readonly Raiser[],
  selfId = "local",
): Raiser[] {
  const byId = new Map(participants.map((p) => [p.id, p]));
  const out: Raiser[] = [];
  for (const id of raised) {
    if (id === selfId) continue;
    const person = byId.get(id);
    // A hand from somebody who has since left is not a hand anyone can answer.
    if (person) out.push(person);
  }
  return out;
}

/**
 * How the room says it out loud, for a tooltip and for a screen reader.
 *
 * Names to two, then a count: "Nadia, Sam and 3 others" is still a sentence,
 * where six names in a tooltip is a list nobody reads.
 */
export function handsUpLabel(raisers: readonly Raiser[]): string {
  const names = raisers.map((r) => r.displayName).filter((n) => n.trim().length > 0);
  if (names.length === 0) return "";
  const plural = names.length === 1 ? "a hand up" : "hands up";
  if (names.length === 1) return `${names[0]} has ${plural}`;
  if (names.length === 2) return `${names[0]} and ${names[1]} have ${plural}`;
  const rest = names.length - 2;
  return `${names[0]}, ${names[1]} and ${rest} other${rest === 1 ? "" : "s"} have ${plural}`;
}

/**
 * The people list, with raised hands at the top.
 *
 * Stable otherwise: everyone who has not raised a hand keeps the order they
 * were in, so the list does not reshuffle itself under the cursor every time
 * somebody's microphone opens. Among raised hands, oldest first — the same
 * order `raisedBy` gives, for the same reason.
 */
export function handsFirst<T extends { id: string }>(
  participants: readonly T[],
  raised: Iterable<string>,
): T[] {
  const order = new Map<string, number>();
  let n = 0;
  for (const id of raised) order.set(id, n++);
  return [...participants].sort((a, b) => {
    const ra = order.get(a.id);
    const rb = order.get(b.id);
    if (ra === undefined && rb === undefined) return 0;
    if (ra === undefined) return 1;
    if (rb === undefined) return -1;
    return ra - rb;
  });
}
