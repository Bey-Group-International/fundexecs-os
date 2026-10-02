// lib/meetings/room-layout.ts
// How the call screen arranges what it has to show: how many columns the grid
// gets, how a large call is split into pages, and which of the stacked notices
// above the stage are on screen at once.
//
// The grid used to stop at three columns. A twelve-person call was four rows of
// three, each tile a strip, and past that the stage scrolled — so the faces
// below the fold were faces nobody saw, and the scrollbar sat over the video.
// Columns now grow with the call and a call too big for one screen is paged,
// which keeps every tile a usable size. Paging is a picture-only decision:
// everybody's audio still plays whatever page is showing, because the audio
// elements are not the tiles.
//
// Pure: no DOM, no React.

/** Whether the screen is phone-sized: fewer, larger tiles and fewer per page. */
export type RoomViewport = "mobile" | "desktop";

/** How many tiles fit one page of the grid before it pages. */
export const TILES_PER_PAGE: Record<RoomViewport, number> = { mobile: 6, desktop: 16 };

/**
 * Columns for a grid of `count` tiles.
 *
 * Desktop: one, then two up to four, three up to nine, four up to sixteen.
 * Nothing beyond four, because a page never holds more than sixteen. A phone
 * is a single column for one tile and two otherwise: three across a 360px
 * screen is three thumbnails.
 */
export function gridColumns(count: number, viewport: RoomViewport): number {
  const n = Math.max(1, Math.floor(count));
  if (n === 1) return 1;
  if (viewport === "mobile") return 2;
  if (n <= 4) return 2;
  if (n <= 9) return 3;
  return 4;
}

/** How many pages `count` tiles take. Never fewer than one. */
export function pageCount(count: number, viewport: RoomViewport): number {
  return Math.max(1, Math.ceil(Math.max(0, count) / TILES_PER_PAGE[viewport]));
}

/** A page index pulled back inside the range — the call shrank under it. */
export function clampPage(page: number, count: number, viewport: RoomViewport): number {
  const last = pageCount(count, viewport) - 1;
  return Math.min(Math.max(0, Math.floor(page)), last);
}

/**
 * The tiles on one page.
 *
 * Your own tile stays on every page, first: losing sight of yourself because
 * you paged to see the people at the back is how people end up on camera
 * eating. So each page holds `perPage - 1` others plus you, and the call takes
 * one more page than its raw size suggests when that runs over.
 */
export function pageTiles<T>(
  self: T | null,
  others: readonly T[],
  page: number,
  viewport: RoomViewport,
): { tiles: T[]; page: number; pages: number } {
  const perPage = TILES_PER_PAGE[viewport];
  const slots = self === null ? perPage : perPage - 1;
  const pages = Math.max(1, Math.ceil(others.length / slots));
  const at = Math.min(Math.max(0, Math.floor(page)), pages - 1);
  const slice = others.slice(at * slots, at * slots + slots);
  return { tiles: self === null ? slice : [self, ...slice], page: at, pages };
}

/** One of the notices that can stack above the stage. */
export interface RoomNotice {
  id: string;
  /**
   * Shown whatever else is showing. The recording notice is pinned because
   * several jurisdictions require every party to know a call is recorded, and
   * a notice folded behind "+2 more" is one a guest may never open; the "your
   * microphone is not working" notice because it is about whether you are in
   * the meeting at all.
   */
  pinned?: boolean;
  /** Higher shows first among the unpinned ones. */
  priority: number;
}

/**
 * Which notices are on screen, and how many are folded away.
 *
 * Every pinned notice shows. Of the rest, only the most urgent does unless the
 * person asks for all of them — a stage that opens under three amber bars is a
 * stage with a third less room for the faces, which is what the notices were
 * pushing aside. Order among equals is the order given.
 */
export function visibleNotices<T extends RoomNotice>(
  notices: readonly T[],
  expanded: boolean,
): { shown: T[]; hidden: number } {
  const pinned = notices.filter((n) => n.pinned);
  const rest = notices
    .map((n, i) => ({ n, i }))
    .filter(({ n }) => !n.pinned)
    .sort((a, b) => b.n.priority - a.n.priority || a.i - b.i)
    .map(({ n }) => n);
  if (expanded || rest.length <= 1) return { shown: [...pinned, ...rest], hidden: 0 };
  return { shown: [...pinned, rest[0]], hidden: rest.length - 1 };
}

/** How long the pointer may rest before the controls fade, in ms. */
export const CONTROLS_IDLE_MS = 3500;

/**
 * Whether the controls may fade.
 *
 * Only on a screen with a mouse — a phone has no hover to bring them back, and
 * a tap that first reveals a button and then has to be repeated to press it is
 * worse than a bar that stays. And never while something wants the host's
 * attention, a menu is open, or focus is inside the bar: hiding a control
 * somebody is using, or the count of people held at the door, is not tidying.
 */
export function controlsMayHide(state: {
  finePointer: boolean;
  live: boolean;
  waitingCount: number;
  menuOpen: boolean;
  focusInside: boolean;
}): boolean {
  return state.finePointer && state.live && state.waitingCount === 0 && !state.menuOpen && !state.focusInside;
}
