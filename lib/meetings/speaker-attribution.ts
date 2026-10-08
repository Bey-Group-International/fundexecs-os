// lib/meetings/speaker-attribution.ts
// Working out which participant an utterance actually came from.
//
// Every client runs its own speech recognition against its own microphone, so
// the naive rule — "whatever my mic heard, I said" — is wrong twice over. A mic
// hears the room, which includes everyone else coming out of the laptop
// speakers, and it keeps hearing while the user believes they are muted (muting
// disables the outgoing WebRTC track; the recognizer has its own tap on the
// device). Both mistakes put someone else's words under your name.
//
// So attribution needs two inputs the transcript never had: whether each
// participant's mic is live, and who was actually making noise while the words
// were being spoken. This module holds that state and the rules over it.
//
// Pure: no DOM, no Web Audio, no timers. The component measures levels and
// broadcasts mic state; the decisions live here so they can be tested.

import { MODEL_CONFIDENCE_FLOOR, NOISE_NOTE } from "@/lib/meetings/transcript-quality";

/** The local participant is always keyed "local" — peers by their signaling id. */
export const LOCAL_SPEAKER_ID = "local";

/** Levels are 0–1 (see `levelFromSamples`). Below this is room tone, not speech. */
export const SPEAKING_LEVEL = 0.08;

/** How long a participant stays "speaking" in the UI after they fall silent. */
export const SPEAKING_HOLD_MS = 900;

/** Voice-activity samples older than this are dropped; utterances are shorter. */
export const ACTIVITY_WINDOW_MS = 30_000;

/** A window shorter than this carries too few samples to judge; treat as one tick. */
const MIN_WINDOW_MS = 250;

/** A peer must hold this much of the window before bleed is even considered. */
const ECHO_PEER_SHARE = 0.35;

/** And the local mic must have been this close to silent throughout. */
const ECHO_LOCAL_SHARE = 0.15;

/**
 * How much louder a same-room peer's own track must be than the local mic
 * before their voice heard HERE is handed back to them.
 *
 * In one room both microphones hear both voices at speech level, so the
 * share test that defends ownership everywhere else proves nothing — the
 * air defeats it. What survives is distance: a voice is far louder on its
 * own microphone than on one across the room. The margin is deliberately
 * wide because auto-gain pushes the two copies toward each other and the
 * cost of a wrong drop is somebody's words; anything short of clearly
 * stronger falls through to the ordinary rules, whose worst case is a
 * duplicated line flagged as overlapped rather than a lost one.
 */
export const SAME_ROOM_PEAK_RATIO = 1.5;

export interface ParticipantAudio {
  id: string;
  displayName: string;
  /** The participant's own report of their mic track: false while muted. */
  micOn: boolean;
  isLocal: boolean;
}

export interface ActivitySample {
  speakerId: string;
  /** 0–1 smoothed level measured locally from that participant's audio. */
  level: number;
  ts: number;
}

/** How much of a time window one participant was audible for. */
export interface ActivitySummary {
  speakerId: string;
  /** Fraction of samples in the window that were above `SPEAKING_LEVEL`. */
  share: number;
  /** Loudest level seen in the window. */
  peak: number;
  samples: number;
}

export type AttributionBasis =
  /** Local mic was live and the local voice dominated the window. */
  | "local-voice"
  /** Local mic was muted — the recognizer heard the room, not its owner. */
  | "mic-muted"
  /** Local mic was live but silent while a peer was talking: speaker bleed. */
  | "echo"
  /** Local and a peer overlapped closely enough that neither clearly owns it. */
  | "cross-talk"
  /** A peer in the same physical room, whose own track clearly carried it. */
  | "same-room"
  /** Nobody was measurably audible — usually a tail-end recognizer flush. */
  | "unattributed";

export interface Attribution {
  speakerId: string | null;
  displayName: string | null;
  /** 0–1. Below `LOW_CONFIDENCE` the line is shown with an "unsure" marker. */
  confidence: number;
  basis: AttributionBasis;
  /** Someone else was audible at the same time as the attributed speaker. */
  overlapped: boolean;
  /**
   * Whether this client should add the line to the transcript and broadcast it.
   *
   * False for anything we decided was another participant's voice: their own
   * client is transcribing it under their own name, and publishing our copy
   * too would duplicate the line — once correctly attributed, once not.
   */
  publish: boolean;
}

/** Below this, the transcript marks the line as uncertainly attributed. */
export const LOW_CONFIDENCE = 0.6;

/**
 * A short rolling history of who was audible when.
 *
 * The recognizer hands us an utterance after the fact ("here is a sentence that
 * ended just now"), so attribution has to look backwards over the seconds the
 * sentence was being spoken. That means keeping samples, not just a current
 * level. Old ones are pruned on write, so this stays bounded without a timer.
 */
export class VoiceActivityLog {
  private samples: ActivitySample[] = [];

  constructor(private readonly windowMs: number = ACTIVITY_WINDOW_MS) {}

  record(speakerId: string, level: number, ts: number): void {
    if (!Number.isFinite(level)) return;
    this.samples.push({ speakerId, level: Math.max(0, Math.min(1, level)), ts });
    const cutoff = ts - this.windowMs;
    // Pruned in batches, not on every write. Once the window is full the oldest
    // sample is past the cutoff on nearly every call, and filtering then meant
    // copying the whole window — thousands of samples, once per participant
    // every 120ms, for the length of the meeting. Letting a little slack build
    // up first makes the copy rare. summarize() bounds by time, so the extra
    // samples only matter to an utterance longer than the window itself.
    const slack = Math.max(1000, this.windowMs / 10);
    if (this.samples.length > 0 && this.samples[0].ts < cutoff - slack) {
      this.samples = this.samples.filter((s) => s.ts >= cutoff);
    }
  }

  clear(): void {
    this.samples = [];
  }

  get size(): number {
    return this.samples.length;
  }

  /** Per-speaker activity across [from, to], widened to at least one tick. */
  summarize(from: number, to: number): ActivitySummary[] {
    const start = Math.min(from, to - MIN_WINDOW_MS);
    const inWindow = this.samples.filter((s) => s.ts >= start && s.ts <= to);

    const byId = new Map<string, { loud: number; peak: number; total: number }>();
    for (const s of inWindow) {
      const acc = byId.get(s.speakerId) ?? { loud: 0, peak: 0, total: 0 };
      acc.total += 1;
      if (s.level >= SPEAKING_LEVEL) acc.loud += 1;
      if (s.level > acc.peak) acc.peak = s.level;
      byId.set(s.speakerId, acc);
    }

    return [...byId.entries()]
      .map(([speakerId, a]) => ({
        speakerId,
        share: a.total > 0 ? a.loud / a.total : 0,
        peak: a.peak,
        samples: a.total,
      }))
      .sort((a, b) => b.share - a.share || b.peak - a.peak);
  }
}

/** Whether a participant counts as speaking right now. */
export function isSpeaking(level: number, micOn: boolean): boolean {
  return micOn && Number.isFinite(level) && level >= SPEAKING_LEVEL;
}

/**
 * Ids still counted as speaking, given the last moment each was audible.
 *
 * The hold keeps a name from strobing between syllables — a "speaking" dot that
 * blinks off in every gap reads as a connection problem rather than a pause.
 */
export function speakingIds(lastAudibleAt: Map<string, number>, now: number, holdMs = SPEAKING_HOLD_MS): Set<string> {
  const out = new Set<string>();
  for (const [id, ts] of lastAudibleAt) {
    if (now - ts <= holdMs) out.add(id);
  }
  return out;
}

const NOT_MINE = { publish: false, overlapped: false } as const;

/**
 * Whether the local mic was live while the words were being SPOKEN.
 *
 * The recognizer hands a sentence over after it ends — half a second to two
 * seconds after. "Say your piece, hit mute" lands the click exactly in that
 * gap, and judging the mic by the moment the result arrived threw away the
 * host's last sentence before every mute as "heard while you were muted".
 * The words were spoken on a live microphone; the mic that matters is the
 * one during the utterance window, not the one at delivery.
 *
 * `lastOnTs` is the most recent moment the mic was observed live (the voice
 * meter's tick, so it is at most one tick stale). A mic that went off DURING
 * or after the utterance counts as live for it — the voice-activity shares
 * still decide ownership, and any muted stretch inside the window records
 * level zero, so the room's words under a mostly-muted mic still fall to the
 * echo and cross-talk rules rather than being relabelled as the owner's.
 * Null — no meter ever saw the mic on — falls back to the mic's state now.
 */
export function micLiveDuring(
  window: { startedAt: number },
  micOnNow: boolean,
  lastOnTs: number | null,
): boolean {
  if (micOnNow) return true;
  return lastOnTs !== null && lastOnTs >= window.startedAt;
}

/**
 * Decide who spoke an utterance the local recognizer just finalized.
 *
 * The order matters. A muted mic is decisive on its own: whatever was heard,
 * its owner did not say it. Only once we know the mic was live does the
 * question become one of degree, and there the comparison is local share
 * against the loudest peer's share over the same window.
 */
export function attributeUtterance(
  window: { startedAt: number; endedAt: number },
  log: VoiceActivityLog,
  participants: ParticipantAudio[],
  options: { localMicOn: boolean; sameRoomPeerIds?: ReadonlySet<string> } = { localMicOn: true },
): Attribution {
  const nameOf = (id: string) => participants.find((p) => p.id === id)?.displayName ?? null;
  const summaries = log.summarize(window.startedAt, window.endedAt);
  const local = summaries.find((s) => s.speakerId === LOCAL_SPEAKER_ID);
  const peers = summaries.filter((s) => s.speakerId !== LOCAL_SPEAKER_ID && s.share > 0);
  const loudestPeer = peers[0] ?? null;

  // 1. Muted. The words exist, but not from this microphone's owner.
  if (!options.localMicOn) {
    return {
      ...NOT_MINE,
      speakerId: loudestPeer?.speakerId ?? null,
      displayName: loudestPeer ? nameOf(loudestPeer.speakerId) : null,
      confidence: loudestPeer ? 0.5 : 0,
      basis: "mic-muted",
    };
  }

  const localShare = local?.share ?? 0;
  const peerShare = loudestPeer?.share ?? 0;

  // 2. A peer in the same physical room. This mic hears their real voice at
  //    full speech level through the air, so a high local share is exactly
  //    what THEIR talking produces here — the share test cannot defend
  //    ownership, and before this rule every sentence either of you said went
  //    into the transcript twice, once under the wrong name flagged as
  //    cross-talk. Distance still tells: when their own track is clearly the
  //    stronger copy, the words are theirs and their device is transcribing
  //    them. Anything short of clearly stronger falls through — a duplicated
  //    line flagged overlapped beats a dropped one.
  if (
    loudestPeer
    && options.sameRoomPeerIds?.has(loudestPeer.speakerId)
    && peerShare >= ECHO_PEER_SHARE
    && loudestPeer.peak >= SAME_ROOM_PEAK_RATIO * (local?.peak ?? 0)
  ) {
    return {
      ...NOT_MINE,
      speakerId: loudestPeer.speakerId,
      displayName: nameOf(loudestPeer.speakerId),
      confidence: Math.min(0.8, 0.5 + peerShare * 0.4),
      basis: "same-room",
    };
  }

  // 3. Nobody audible: a recognizer flush with no voice behind it in our log.
  //    Keep it — dropping real speech is worse than an unlabelled line — but
  //    say plainly that we could not place it.
  if (localShare === 0 && peerShare === 0) {
    return {
      speakerId: LOCAL_SPEAKER_ID,
      displayName: nameOf(LOCAL_SPEAKER_ID),
      confidence: 0.35,
      basis: "unattributed",
      overlapped: false,
      publish: true,
    };
  }

  // 4. Live mic, but the local voice was essentially absent while a peer held
  //    the floor: speaker bleed picked up by an open mic. The peer's own client
  //    is transcribing it.
  //
  //    The bar for this is deliberately high. Suppressing a line is unrecoverable
  //    — the words are gone from the transcript — so "quieter than the peer" is
  //    not enough. A short "yes, agreed" over someone else's sentence is a low
  //    local share against a high peer one, and it is real speech that belongs to
  //    the person who said it. Only a local mic that never once crossed the
  //    speech threshold, against a peer who clearly did, counts as bleed.
  if (peerShare >= ECHO_PEER_SHARE && localShare <= ECHO_LOCAL_SHARE) {
    return {
      ...NOT_MINE,
      speakerId: loudestPeer!.speakerId,
      displayName: nameOf(loudestPeer!.speakerId),
      confidence: Math.min(0.75, 0.4 + peerShare * 0.4),
      basis: "echo",
    };
  }

  const overlapped = peerShare > 0 && peerShare >= localShare * 0.5;

  // 5. Both talking at once. It is ours to publish — our mic heard our voice —
  //    but the recognizer may well have merged two people's words, so the line
  //    goes out flagged rather than asserted.
  if (overlapped) {
    return {
      speakerId: LOCAL_SPEAKER_ID,
      displayName: nameOf(LOCAL_SPEAKER_ID),
      confidence: 0.5,
      basis: "cross-talk",
      overlapped: true,
      publish: true,
    };
  }

  // 6. The ordinary case: live mic, local voice dominant.
  return {
    speakerId: LOCAL_SPEAKER_ID,
    displayName: nameOf(LOCAL_SPEAKER_ID),
    confidence: Math.min(1, 0.7 + localShare * 0.3),
    basis: "local-voice",
    overlapped: false,
    publish: true,
  };
}

/** Why a line was withheld, phrased for the transcript's own status row. */
export function suppressionReason(basis: AttributionBasis, displayName: string | null): string {
  const who = displayName ?? "another participant";
  if (basis === "mic-muted") return `Heard while you were muted — not added to the transcript`;
  if (basis === "echo") return `Heard ${who} through your speakers — their device is transcribing it`;
  if (basis === "same-room") return `Heard ${who} from across the room — their own device is transcribing them`;
  return "Not attributed to you";
}

export interface AttributedLine {
  speaker: string;
  text: string;
  confidence?: number;
  overlapped?: boolean;
}

/**
 * Render a line for the notes and report models.
 *
 * Uncertain attribution is marked rather than hidden. A model handed a clean
 * "Grace: send the deck" will assign that action item to Grace and put her name
 * in a follow-up email; if we only half-believe it was Grace, it needs to see
 * that doubt, not inherit our guess as fact.
 */
export function formatTranscriptLine(line: AttributedLine): string {
  const confidence = line.confidence ?? 1;
  const speaker = line.speaker || "Unknown speaker";
  if (confidence >= LOW_CONFIDENCE && !line.overlapped) return `${speaker}: ${line.text}`;
  // Below the floor the honest word is not "uncertain" but "noise". An engine
  // that scores its own output this low was not hearing speech, and a line
  // marked merely doubtful is one a summariser will still try to use — which is
  // how an hour of a microphone listening to a room became a meeting's minutes.
  // The note stays in the record, where a reader is better served by it than by
  // a gap; `transcriptForModel` is what keeps it away from the model.
  const note = confidence < MODEL_CONFIDENCE_FLOOR
    ? NOISE_NOTE
    : line.overlapped ? "uncertain — people speaking over each other" : "uncertain";
  return `${speaker} (${note}): ${line.text}`;
}

/**
 * A stable colour index for a speaker id, so a name keeps its colour for the
 * whole call — and the same colour on every participant's screen, since the id
 * is the shared signaling id rather than a local list position.
 */
export function speakerColorIndex(speakerId: string, total: number): number {
  let hash = 0;
  for (let i = 0; i < speakerId.length; i++) {
    hash = (hash * 31 + speakerId.charCodeAt(i)) | 0;
  }
  return Math.abs(hash) % Math.max(1, total);
}
