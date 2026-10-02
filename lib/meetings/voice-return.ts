// lib/meetings/voice-return.ts
// Voice return: a peer whose audio is carrying THIS member's own voice back.
//
// `observeEcho` in ./echo looks for the classic echo — call audio leaking out
// of a speaker and back into the same machine's microphone, quieter than the
// voice it came from. It cannot see the case people actually hit when they try
// the product: two devices in one room. There the second device's microphone
// hears the member's real voice, live and at full volume, and sends it back.
// Nothing about that is quieter than anything, so to `observeEcho` it looks
// exactly like two people talking at once, and it stays silent. No echo
// canceller can remove it either: the canceller removes what its own machine
// PLAYED, and a voice in the room was never played by anybody.
//
// What does identify it is time. The member speaks, and a fraction of a second
// later one peer's audio has the same shape — every syllable, at a fixed delay
// (that peer's network and jitter buffer). Conversation never does that: people
// answer AFTER each other, so a peer's level falls as the member's rises.
//
// So this rule correlates the member's own level with each peer's level at
// delays from one meter sample up to about a second, and flags a peer whose
// audio tracks the member's voice closely and consistently. It catches both
// directions of the same-room problem: on the speaking device the peer's audio
// is the member's voice coming back; on the device across the room the
// microphone hears the speaker live and then the call plays them again.
//
// Pure: no AudioContext, no timers, no clock beyond what is passed in. It runs
// on the levels the room's voice meter already computes.

/** Samples kept, at one per meter tick (~120ms): about ten seconds. */
export const RETURN_SAMPLES = 84;

/** Shortest delay considered, in samples. Zero lag is two people at once. */
export const RETURN_MIN_LAG = 1;

/** Longest delay considered, in samples: about a second at 120ms. */
export const RETURN_MAX_LAG = 8;

/** A local level at or above this is the member making a sound. */
export const RETURN_LOCAL_ACTIVE = 0.05;

/**
 * Fewest samples of the member actually speaking before any verdict.
 *
 * About two and a half seconds of speech. Below that a correlation is a
 * coincidence of two words, not evidence.
 */
export const RETURN_MIN_ACTIVE = 20;

/**
 * How closely a peer's audio must follow the member's voice to count.
 *
 * Deliberately high. The action this drives silences a person, and a false
 * verdict would cut somebody out of a call; a missed one leaves an echo the
 * member can still fix with headphones.
 */
export const RETURN_CORRELATION = 0.7;

/** Below this a raised verdict clears. Lower than the raise, so it cannot flap. */
export const RETURN_CLEAR = 0.35;

/** Consecutive over-threshold evaluations before a verdict is raised. */
export const RETURN_CONFIRM = 4;

interface PeerTrace {
  levels: Float32Array;
  /** Samples written for this peer since they appeared. */
  filled: number;
  streak: number;
  raised: boolean;
}

/** The rule's memory. Fixed-size rings: written on every meter tick. */
export interface ReturnWatch {
  local: Float32Array;
  cursor: number;
  filled: number;
  peers: Map<string, PeerTrace>;
}

export function createReturnWatch(): ReturnWatch {
  return { local: new Float32Array(RETURN_SAMPLES), cursor: 0, filled: 0, peers: new Map() };
}

/** One meter tick. */
export interface ReturnSample {
  /** The member's raw microphone level, 0–1. Zero while muted. */
  local: number;
  /** Each remote participant's raw level, 0–1, by peer id. */
  remotes: ReadonlyMap<string, number>;
}

export interface ReturnVerdict {
  /** Peers whose audio started carrying the member's voice on this tick. */
  started: string[];
  /** Peers whose audio stopped carrying it on this tick. */
  cleared: string[];
}

const level = (v: number) => (Number.isFinite(v) && v > 0 ? v : 0);

/**
 * The strongest correlation between the member's voice and a peer's audio at
 * any delay in range, or null when there is not enough of the member speaking
 * to say anything.
 *
 * `n` is how many of the most recent samples both traces hold; sample `j`
 * (0 oldest) sits at `(end - n + j) mod size`.
 */
export function returnCorrelation(
  local: ArrayLike<number>,
  remote: ArrayLike<number>,
  end: number,
  n: number,
): number | null {
  const size = local.length;
  const at = (arr: ArrayLike<number>, j: number) => arr[(end - n + j + size * 2) % size];

  let best: number | null = null;
  for (let lag = RETURN_MIN_LAG; lag <= RETURN_MAX_LAG; lag++) {
    const pairs = n - lag;
    if (pairs < RETURN_MIN_ACTIVE) break;

    let active = 0;
    let sx = 0, sy = 0;
    for (let j = lag; j < n; j++) {
      const x = at(local, j - lag);
      if (x >= RETURN_LOCAL_ACTIVE) active += 1;
      sx += x;
      sy += at(remote, j);
    }
    if (active < RETURN_MIN_ACTIVE) continue;

    const mx = sx / pairs, my = sy / pairs;
    let cov = 0, vx = 0, vy = 0;
    for (let j = lag; j < n; j++) {
      const dx = at(local, j - lag) - mx;
      const dy = at(remote, j) - my;
      cov += dx * dy; vx += dx * dx; vy += dy * dy;
    }
    // A peer who is silent throughout has nothing to correlate.
    if (vx <= 1e-9 || vy <= 1e-9) continue;
    const r = cov / Math.sqrt(vx * vy);
    if (best === null || r > best) best = r;
  }
  return best;
}

/**
 * Fold one meter tick in and say which peers have started, or stopped,
 * sending the member's own voice back.
 *
 * Mutates `watch`. A peer who is absent from `remotes` has left, and is
 * forgotten; a peer who returns starts from nothing.
 */
export function observeVoiceReturn(watch: ReturnWatch, sample: ReturnSample): ReturnVerdict {
  const i = watch.cursor;
  watch.local[i] = level(sample.local);

  for (const id of [...watch.peers.keys()]) {
    if (!sample.remotes.has(id)) watch.peers.delete(id);
  }
  for (const [id, v] of sample.remotes) {
    let p = watch.peers.get(id);
    if (!p) {
      p = { levels: new Float32Array(RETURN_SAMPLES), filled: 0, streak: 0, raised: false };
      watch.peers.set(id, p);
    }
    p.levels[i] = level(v);
    if (p.filled < RETURN_SAMPLES) p.filled += 1;
  }
  watch.cursor = (i + 1) % RETURN_SAMPLES;
  if (watch.filled < RETURN_SAMPLES) watch.filled += 1;

  const started: string[] = [];
  const cleared: string[] = [];
  for (const [id, p] of watch.peers) {
    const r = returnCorrelation(watch.local, p.levels, watch.cursor, Math.min(watch.filled, p.filled));
    // Not enough of the member speaking: no evidence either way, so nothing moves.
    if (r === null) continue;
    if (r >= RETURN_CORRELATION) {
      p.streak += 1;
      if (!p.raised && p.streak >= RETURN_CONFIRM) {
        p.raised = true;
        started.push(id);
      }
    } else {
      p.streak = 0;
      if (p.raised && r < RETURN_CLEAR) {
        p.raised = false;
        cleared.push(id);
      }
    }
  }
  return { started, cleared };
}

/** What the room says when it has silenced somebody to stop the echo. */
export function voiceReturnNotice(names: readonly string[]): string {
  const who = names.length === 1 ? names[0] : `${names.slice(0, -1).join(", ")} and ${names[names.length - 1]}`;
  const verb = names.length === 1 ? "seems" : "seem";
  return `${who} ${verb} to be in the same room as you, so their audio is muted on this device to stop the echo. You can still hear them in person, and everyone else still hears them.`;
}
