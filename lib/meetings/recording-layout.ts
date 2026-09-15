// lib/meetings/recording-layout.ts
// Deciding what a frame of the recording shows.
//
// A mesh call has no canonical picture. Every participant sees their own
// arrangement — who they pinned, how wide their window is, whether they are in
// grid or speaker view — and none of that is the recording. The recording is a
// separate composition that has to be decided frame by frame, on the host's
// machine, while the host is also in the meeting.
//
// Three rules, in order:
//
//  1. A shared screen takes the frame. Somebody sharing is somebody saying
//     "look at this", and a grid that shrinks it to a sixth of the picture has
//     thrown away the reason the meeting was recorded.
//  2. Otherwise, whoever is speaking gets the large tile — but only once they
//     have been speaking long enough to mean it, and only while nobody else is
//     competing. Crosstalk falls back to the grid rather than flicking between
//     two people, which is the failure mode that makes a recording unwatchable.
//  3. Otherwise, the grid.
//
// Pure: rectangles and decisions, no canvas. The hysteresis is the part that
// cannot be checked by looking at it, so it is the part that is tested.

/** A participant as the composer sees them. */
export interface StageParticipant {
  id: string;
  displayName: string;
  /** Whether this tile has live video to draw. A camera-off tile is drawn as a name card. */
  hasVideo: boolean;
}

/** How loud someone has been over the sampling window — from VoiceActivityLog.summarize. */
export interface StageActivity {
  speakerId: string;
  /** 0-1: the fraction of samples in which they were above the speaking threshold. */
  share: number;
}

export interface Rect { x: number; y: number; width: number; height: number }

export interface StageTile extends StageParticipant {
  rect: Rect;
  /** The focused tile in speaker or screen mode; drives the name banner. */
  primary: boolean;
}

export type StageMode = "screen" | "speaker" | "grid";

export interface Stage {
  mode: StageMode;
  tiles: StageTile[];
  /** Set in screen mode: the share is drawn from a different source than a camera tile. */
  screenRect: Rect | null;
}

/**
 * How loud someone must be, relative to the room, to take the large tile.
 *
 * A share is the fraction of recent samples in which a person was above the
 * speaking threshold, so 0.35 is "talking for about a third of the last few
 * seconds" — a sentence, not a cough and not a door.
 */
export const SPEAKER_SHARE = 0.35;

/**
 * How far ahead of the runner-up they must be.
 *
 * Without this, two people in a genuine back-and-forth swap the large tile
 * every couple of seconds and the recording is exhausting to watch. When
 * nobody is clearly holding the floor, the grid is the honest picture.
 */
export const SPEAKER_MARGIN = 0.15;

/**
 * How long a new speaker must hold the floor before the frame changes, in ms.
 *
 * The cost of being wrong is asymmetric: switching late is unnoticeable,
 * switching early is a visible flick to somebody who said "mm-hm". So this is
 * generous.
 */
export const SPEAKER_SETTLE_MS = 1_500;

/** Padding between tiles, in pixels at the recording's own resolution. */
export const TILE_GAP = 8;

/**
 * Who should hold the large tile, given who is talking and who holds it now.
 *
 * Returns the current holder unchanged unless a challenger is both clearly
 * loudest and clearly ahead — the caller then decides, using `sinceMs`,
 * whether that challenger has held it long enough to be worth a cut.
 */
export function loudestSpeaker(activity: readonly StageActivity[]): string | null {
  if (!activity.length) return null;
  const ranked = [...activity].sort((a, b) => b.share - a.share);
  const top = ranked[0];
  if (top.share < SPEAKER_SHARE) return null;
  const second = ranked[1];
  if (second && top.share - second.share < SPEAKER_MARGIN) return null;
  return top.speakerId;
}

export interface FocusState {
  /** Who currently holds the large tile. */
  speakerId: string | null;
  /** Who is challenging for it, and since when. */
  pendingId: string | null;
  pendingSince: number;
}

export const NO_FOCUS: FocusState = { speakerId: null, pendingId: null, pendingSince: 0 };

/**
 * Advance the focus state by one sample.
 *
 * The whole point is that it does NOT follow `loudestSpeaker` directly. A
 * challenger has to stay loudest for SPEAKER_SETTLE_MS before the frame cuts
 * to them; anything shorter is an interjection, and cutting to interjections
 * is what makes an auto-directed recording look broken.
 *
 * Losing the floor, by contrast, is not urgent: when nobody is clearly
 * speaking, the last speaker keeps the tile. Cutting to the grid during every
 * pause for breath would be its own kind of flicker.
 */
export function stepFocus(
  state: FocusState,
  activity: readonly StageActivity[],
  now: number,
): FocusState {
  const loudest = loudestSpeaker(activity);

  // Nobody is clearly holding the floor. Keep the current framing and forget
  // any half-formed challenge — a challenger who stopped talking is not one.
  if (loudest === null) {
    return state.pendingId === null ? state : { ...state, pendingId: null, pendingSince: 0 };
  }

  if (loudest === state.speakerId) {
    return state.pendingId === null ? state : { ...state, pendingId: null, pendingSince: 0 };
  }

  if (loudest !== state.pendingId) {
    return { speakerId: state.speakerId, pendingId: loudest, pendingSince: now };
  }

  if (now - state.pendingSince >= SPEAKER_SETTLE_MS) {
    return { speakerId: loudest, pendingId: null, pendingSince: 0 };
  }

  return state;
}

/**
 * The grid's shape for a given number of tiles.
 *
 * Columns before rows, and never more columns than tiles: four people are 2×2,
 * not 4×1, because a 4×1 row inside a 16:9 frame is four slivers.
 */
export function gridShape(count: number): { cols: number; rows: number } {
  if (count <= 1) return { cols: 1, rows: 1 };
  const cols = Math.ceil(Math.sqrt(count));
  const rows = Math.ceil(count / cols);
  return { cols, rows };
}

/** Lay `count` equal cells out inside a box, centred, preserving the box's shape. */
export function gridRects(count: number, width: number, height: number): Rect[] {
  if (count <= 0) return [];
  const { cols, rows } = gridShape(count);
  const cellW = (width - TILE_GAP * (cols + 1)) / cols;
  const cellH = (height - TILE_GAP * (rows + 1)) / rows;
  const rects: Rect[] = [];
  for (let i = 0; i < count; i++) {
    const row = Math.floor(i / cols);
    const col = i % cols;
    // The last row is usually short; centring it stops a five-person call
    // ending on one lonely tile pinned to the left.
    const inRow = Math.min(cols, count - row * cols);
    const rowWidth = inRow * cellW + (inRow - 1) * TILE_GAP;
    const offset = (width - rowWidth) / 2;
    rects.push({
      x: offset + col * (cellW + TILE_GAP),
      y: TILE_GAP + row * (cellH + TILE_GAP),
      width: cellW,
      height: cellH,
    });
  }
  return rects;
}

/**
 * The strip of small tiles beside a screen share or a large speaker.
 *
 * Capped, because a fifteen-person call would otherwise produce a column of
 * postage stamps that costs a draw call each and shows nothing. The people who
 * survive the cap are the ones the caller ordered first, which is by recent
 * speech.
 */
export const MAX_STRIP_TILES = 4;

/** Compose one frame. */
export function composeStage(input: {
  participants: readonly StageParticipant[];
  activity: readonly StageActivity[];
  focus: FocusState;
  screenSharerId: string | null;
  width: number;
  height: number;
}): Stage {
  const { participants, screenSharerId, width, height } = input;

  if (!participants.length) return { mode: "grid", tiles: [], screenRect: null };

  // Somebody sharing is somebody saying "look at this".
  if (screenSharerId) {
    const others = participants.filter((p) => p.id !== screenSharerId).slice(0, MAX_STRIP_TILES);
    const stripW = others.length ? Math.round(width * 0.18) : 0;
    const screenRect: Rect = {
      x: TILE_GAP,
      y: TILE_GAP,
      width: width - stripW - TILE_GAP * 2,
      height: height - TILE_GAP * 2,
    };
    const tileH = others.length
      ? (height - TILE_GAP * (others.length + 1)) / others.length
      : 0;
    return {
      mode: "screen",
      screenRect,
      tiles: others.map((p, i) => ({
        ...p,
        primary: false,
        rect: {
          x: width - stripW,
          y: TILE_GAP + i * (tileH + TILE_GAP),
          width: stripW - TILE_GAP,
          height: tileH,
        },
      })),
    };
  }

  const focused = input.focus.speakerId
    ? participants.find((p) => p.id === input.focus.speakerId) ?? null
    : null;

  // One person in the room is a grid of one — a "speaker view" of the only
  // participant is the same picture with more code behind it.
  if (!focused || participants.length <= 1) {
    const rects = gridRects(participants.length, width, height);
    return {
      mode: "grid",
      screenRect: null,
      tiles: participants.map((p, i) => ({ ...p, primary: false, rect: rects[i] })),
    };
  }

  const others = participants.filter((p) => p.id !== focused.id).slice(0, MAX_STRIP_TILES);
  const stripW = others.length ? Math.round(width * 0.18) : 0;
  const tileH = others.length ? (height - TILE_GAP * (others.length + 1)) / others.length : 0;

  return {
    mode: "speaker",
    screenRect: null,
    tiles: [
      {
        ...focused,
        primary: true,
        rect: {
          x: TILE_GAP,
          y: TILE_GAP,
          width: width - stripW - TILE_GAP * 2,
          height: height - TILE_GAP * 2,
        },
      },
      ...others.map((p, i) => ({
        ...p,
        primary: false,
        rect: {
          x: width - stripW,
          y: TILE_GAP + i * (tileH + TILE_GAP),
          width: stripW - TILE_GAP,
          height: tileH,
        },
      })),
    ],
  };
}

/**
 * Fit a source frame inside a tile without distorting it.
 *
 * Cover, not contain: a letterboxed portrait phone camera inside an already
 * small tile leaves almost nothing of the person. Cropping the edges of a
 * frame loses less than shrinking all of it.
 */
export function coverRect(
  srcWidth: number,
  srcHeight: number,
  dest: Rect,
): { sx: number; sy: number; sWidth: number; sHeight: number } {
  if (srcWidth <= 0 || srcHeight <= 0 || dest.width <= 0 || dest.height <= 0) {
    return { sx: 0, sy: 0, sWidth: Math.max(0, srcWidth), sHeight: Math.max(0, srcHeight) };
  }
  const srcAspect = srcWidth / srcHeight;
  const destAspect = dest.width / dest.height;
  if (srcAspect > destAspect) {
    const sWidth = srcHeight * destAspect;
    return { sx: (srcWidth - sWidth) / 2, sy: 0, sWidth, sHeight: srcHeight };
  }
  const sHeight = srcWidth / destAspect;
  return { sx: 0, sy: (srcHeight - sHeight) / 2, sWidth: srcWidth, sHeight };
}

/**
 * Order participants for the strip: most recently vocal first.
 *
 * So the four faces kept beside a shared screen are the four people taking
 * part, not the four who happened to join first.
 */
export function byRecentVoice(
  participants: readonly StageParticipant[],
  activity: readonly StageActivity[],
): StageParticipant[] {
  const share = new Map(activity.map((a) => [a.speakerId, a.share]));
  return [...participants].sort((a, b) => (share.get(b.id) ?? 0) - (share.get(a.id) ?? 0));
}
