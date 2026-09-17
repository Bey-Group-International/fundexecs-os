// lib/meetings/stage.ts
// Who the room is looking at, and how the tiles are arranged to show them.
//
// A meeting has two things competing to be the big tile: whoever is talking,
// and whoever is sharing their screen. Until this existed only the first was
// ever considered, and the consequence was that screen sharing did not really
// work. `sharingPeers` was tracked, broadcast and kept up to date — and read by
// nothing but the recording composer. In the live room a shared screen arrived
// as one cell of the grid, the same size as a face, so in a six-person call
// nobody could read it; the layout defaults to grid, and nothing switched it.
//
// Switching to speaker view by hand did not fix it either, because the
// spotlight follows the audio meter. A presenter who stops talking to let
// somebody ask a question loses the big tile to the person asking, mid-slide.
//
// The rules are the two below, and they are the ones the recording composer
// has always used — `recording-layout.ts` gives the sharer the large rect and
// everyone else a strip. This is the same decision for the live room, in one
// place both can be reasoned about.
//
// Pure: no DOM, no React, no media.

/** A layout the member can choose for themselves. */
export type StageLayout = "grid" | "speaker";

/**
 * The tile that should be large, or null for an even grid.
 *
 * A screen share outranks the active speaker, and deliberately does not decay:
 * the whole point of sharing is that the screen is the subject for as long as
 * it is up, whoever happens to be speaking over it.
 */
export function stageFocusId(input: {
  /** Whoever is sharing a screen, or null when nobody is. */
  screenSharerId: string | null;
  /** Whoever the audio meter currently credits, or null. */
  activeSpeakerId: string | null;
}): string | null {
  return input.screenSharerId ?? input.activeSpeakerId;
}

/**
 * The layout actually used, which a live share overrides.
 *
 * An even grid cannot show a screen: at six people a shared document is drawn
 * at about a sixth of the area and read by nobody. So a share forces speaker
 * view for as long as it lasts, and the member's own choice is remembered
 * underneath rather than overwritten — when the share ends they are back in
 * whichever layout they picked, without having to pick it again.
 */
export function effectiveLayout(chosen: StageLayout, screenSharerId: string | null): StageLayout {
  return screenSharerId ? "speaker" : chosen;
}

/**
 * Whether the member's layout button is currently being overridden.
 *
 * The button is left working — someone who wants the grid back mid-share can
 * still ask for it — but the room says why it looks the way it does rather
 * than appearing to ignore the press.
 */
export function layoutIsForced(chosen: StageLayout, screenSharerId: string | null): boolean {
  return screenSharerId !== null && chosen === "grid";
}

/**
 * Whoever the room should treat as sharing, given what everyone has announced.
 *
 * Local first: our own share is the one fact we are certain of, and it needs no
 * round trip. Otherwise the first remote sharer in iteration order, which is
 * join order — two people sharing at once is an argument the room is having and
 * not one the layout has to arbitrate, which is the rule the recording already
 * follows.
 */
export function screenSharerId(input: {
  localIsSharing: boolean;
  localId: string;
  /** Peer ids in join order, with what each last announced. */
  peers: Iterable<readonly [string, { sharing?: boolean }]>;
}): string | null {
  if (input.localIsSharing) return input.localId;
  for (const [id, state] of input.peers) if (state.sharing) return id;
  return null;
}
