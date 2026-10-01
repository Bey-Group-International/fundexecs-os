// lib/meetings/echo.ts
// Echo: the two halves of it the room can actually do something about.
//
// Echo in a call is the room's own loudspeaker output arriving back at its own
// microphone and going out to everybody else, so each of them hears themselves
// a beat late. The browser has an echo canceller for exactly this, and
// `constraintsFor` turns it on for every path that opens a microphone.
//
// THAT IS NOT ENOUGH, for a reason worth writing down because it is not
// obvious from the constraint: the canceller works by subtracting what is being
// PLAYED from what is being CAPTURED, so it needs a reference copy of the
// playback. The browser has that reference for its own default render device.
// `setSinkId` moves call audio off that device — and the capture's canceller
// does not follow it. Audio then leaves a speaker the canceller cannot hear,
// nothing is subtracted, and the call acquires an echo it did not have.
//
// That is the same shape of bug as the one `switchMic` carried until it was
// fixed: a device picker quietly dropping echo cancellation. It was fixed on
// the input side and never looked at on the output side.
//
// So this module is two rules:
//
//   echoRisk        before the fact, from the devices chosen. Spec-backed
//                   (`groupId`), not a guess at product names.
//   observeEcho     after the fact, from levels the voice meter already
//                   computes. Costs no new capture, no new AudioContext and no
//                   new analyser.
//
// Pure: no navigator, no AudioContext, no timers, no clock beyond what is
// passed in.

// ── Before the fact: which device combination has no reference signal ────────

/**
 * The id browsers use for "whatever the system default is".
 *
 * Both spellings are real. `""` is what a never-chosen sink reports, and
 * `"default"` is what Chrome enumerates its default device as — so a member who
 * explicitly picks the entry labelled "Default" ends up with the string, and one
 * who never opened the picker ends up with the empty value. They mean the same
 * thing and both have to count as the default, or the check below reports the
 * person who changed nothing.
 */
const DEFAULT_SINKS: readonly string[] = ["", "default"];

export function isDefaultSink(deviceId: string | null | undefined): boolean {
  return DEFAULT_SINKS.includes(deviceId ?? "");
}

/** Why a device combination is likely to echo, or that it is not. */
export type EchoRisk =
  /** Output is the default device, so the canceller has its reference. */
  | "none"
  /** Microphone and speaker are one physical device — a headset. Best case. */
  | "same-device"
  /**
   * Output has been moved off the default device and is NOT the microphone's
   * own. The canceller is subtracting the wrong thing, or nothing.
   */
  | "output-off-default"
  /** Not enough is known about the devices to say. */
  | "unknown";

/** The part of `MediaDeviceInfo` this rule reads. */
export interface EchoDevice {
  deviceId: string;
  /**
   * Devices that belong to one physical unit share this.
   *
   * A spec guarantee rather than an inference, which is why the rule is built
   * on it. The tempting alternative is to read `label` for "Headset", "AirPods"
   * or "Headphones" — which is a product-name guess, breaks in every locale but
   * English, and would confidently mis-handle a USB speakerphone whose label
   * says neither.
   */
  groupId: string;
}

/**
 * Whether the chosen devices leave the echo canceller able to do its job.
 *
 * Three answers matter and they are not a severity ladder, they are different
 * situations:
 *
 *   `same-device`         the microphone and the speaker are one unit. A
 *                         headset: the capture and the render are the same
 *                         hardware, so the canceller has its reference and
 *                         there is barely any acoustic path anyway.
 *
 *   `none`                output is on the default device, which is the one
 *                         the canceller references. It may still echo
 *                         acoustically in a hard room, but nothing in the
 *                         configuration has disabled the thing that prevents
 *                         that. `observeEcho` is what catches the rest.
 *
 *   `output-off-default`  the member moved output to a specific device that is
 *                         not their microphone's. This is the one this module
 *                         exists for.
 *
 * Deliberately NOT a blocker. A member who routes call audio to their good
 * speakers usually has a reason, and some of them are on a hardware
 * speakerphone doing its own cancellation far better than the browser would.
 * The job here is to say so, not to overrule them.
 */
export function echoRisk(input: {
  micId: string | null | undefined;
  speakerId: string | null | undefined;
  devices?: readonly EchoDevice[];
}): EchoRisk {
  const { micId, speakerId } = input;
  const devices = input.devices ?? [];

  if (isDefaultSink(speakerId)) return "none";

  // A chosen output. The question is now only whether it is the microphone's
  // own hardware.
  const mic = devices.find((d) => d.deviceId === micId);
  const speaker = devices.find((d) => d.deviceId === speakerId);

  // The speaker is chosen but unknown to us, or the microphone is the system
  // default and so has no row to compare against. Either way there is no
  // `groupId` to reason from, and guessing in the reassuring direction is how
  // this check would come to mean nothing.
  if (!mic?.groupId || !speaker?.groupId) return "unknown";

  return mic.groupId === speaker.groupId ? "same-device" : "output-off-default";
}

/** What to tell the member about a risky combination, or null when there is nothing to say. */
export function echoRiskNotice(risk: EchoRisk): string | null {
  if (risk === "output-off-default") {
    return "Call audio is going to a speaker your microphone cannot hear, so echo cancellation cannot remove it. If others hear themselves back, use headphones or switch output to your system default.";
  }
  if (risk === "unknown") {
    return "Call audio is going to a speaker other than your system default. If others hear themselves back, use headphones or switch output back.";
  }
  return null;
}

// ── After the fact: catching an echo that is actually happening ──────────────

/**
 * How loud a remote voice has to be before its playback could feed back.
 *
 * Above the noise the meter reads on an idle call, below ordinary speech. A
 * floor rather than a gate on absolute loudness: what matters is whether there
 * is something playing for the microphone to pick up at all.
 */
export const ECHO_REMOTE_FLOOR = 0.12;

/** How loud the local microphone has to read to count as capturing something. */
export const ECHO_LOCAL_FLOOR = 0.08;

/**
 * How much quieter than the remote voice the local capture has to be.
 *
 * This is the discriminator that keeps ordinary conversation out of the
 * verdict, and it is the most important number here. Two people talking at
 * once produces exactly the pattern echo does — both levels up together — so
 * co-occurrence alone would flag every lively discussion in the product.
 *
 * What separates them is the acoustic path. An echo has been through a speaker,
 * across a room and back into a microphone, and arrives attenuated every time.
 * A person actually speaking over somebody is at their own mouth's distance
 * from their own microphone, and reads comparable or louder. So a local level
 * at or above the remote's is somebody talking, and the window ignores it.
 */
export const ECHO_ATTENUATION = 0.85;

/** How long a stretch of conversation the verdict is formed over. */
export const ECHO_WINDOW_MS = 6_000;

/**
 * Fewest samples in the window before any verdict is given.
 *
 * Without it, the first two ticks of a call are a 100%-correlated window and
 * the notice fires before anybody has said a sentence.
 */
export const ECHO_MIN_SAMPLES = 25;

/**
 * What share of the audible-remote samples must look like echo.
 *
 * Not all of them, deliberately. A real echo is interrupted constantly — by
 * the member actually speaking, by a pause, by the canceller partly succeeding
 * — and a rule needing every sample would never fire on the thing it is for.
 */
export const ECHO_SUSPECT_FRACTION = 0.6;

/**
 * How long after a verdict clears before another can be raised.
 *
 * The notice is advice about hardware. Having said it once, saying it again
 * ninety seconds later teaches the member to dismiss it reflexively — which is
 * the state in which a warning that matters goes unread.
 */
export const ECHO_RENOTICE_MS = 10 * 60_000;

/** One sampled moment of the call, as the voice meter already has it. */
export interface EchoSample {
  now: number;
  /** Local microphone level, 0–1. */
  localLevel: number;
  /** The loudest remote participant's level, 0–1. */
  remoteLevel: number;
  /** Whether the local microphone is actually live. A muted mic cannot echo. */
  micLive: boolean;
}

/**
 * The detector's memory.
 *
 * A fixed-size ring rather than a growing array: this is written every
 * VOICE_SAMPLE_MS for the length of every call, and an array that is pushed and
 * filtered is garbage the call does not need to make. Sized from the window and
 * the sample interval, with headroom, so it never reallocates.
 */
export interface EchoWatch {
  /** Sample timestamps, parallel to `suspect` and `audible`. */
  at: Float64Array;
  /** Whether the remote side was audible in that sample. */
  audible: Uint8Array;
  /** Whether that sample looked like echo. */
  suspect: Uint8Array;
  /** Next write position. */
  cursor: number;
  /** How many slots hold real samples. */
  filled: number;
  /** Whether a notice is currently standing. */
  raised: boolean;
  /** When the last notice cleared, so it is not raised again immediately. */
  clearedAt: number | null;
}

/** Slots to keep. The window at one sample per 120ms is 50; double it for headroom. */
const WATCH_SLOTS = 128;

export function createEchoWatch(): EchoWatch {
  return {
    at: new Float64Array(WATCH_SLOTS),
    audible: new Uint8Array(WATCH_SLOTS),
    suspect: new Uint8Array(WATCH_SLOTS),
    cursor: 0,
    filled: 0,
    raised: false,
    clearedAt: null,
  };
}

/** The verdict, and enough of the arithmetic behind it to debug a false one. */
export interface EchoVerdict {
  /** Whether the room should be telling the member about echo right now. */
  echoing: boolean;
  /** True only on the sample where it turns on, so the caller can act once. */
  started: boolean;
  /** Share of audible-remote samples in the window that looked like echo. */
  fraction: number;
  /** How many audible-remote samples the fraction is over. */
  samples: number;
}

/**
 * Fold one sample in and answer whether this call is echoing.
 *
 * Mutates `watch` — it is this rule's memory, the same contract
 * `blendCoverageByAgreement` has with its agreement buffer, and for the same
 * reason: it runs on a fixed interval for the length of the call and must not
 * allocate.
 *
 * A sample is SUSPECT when the remote side is audible, the microphone is live
 * and also reading, and the local level is attenuated relative to the remote.
 * The verdict is the share of audible samples that were suspect, over a window,
 * with a floor on how many samples that share is allowed to be computed from.
 *
 * Samples where the remote side is silent are recorded but excluded from the
 * denominator. They are what a quiet stretch looks like, and counting them
 * would let a long silence wash out an echo that is plainly happening whenever
 * anybody speaks.
 */
export function observeEcho(watch: EchoWatch, sample: EchoSample): EchoVerdict {
  const { now, localLevel, remoteLevel, micLive } = sample;

  const audible = Number.isFinite(remoteLevel) && remoteLevel >= ECHO_REMOTE_FLOOR;
  const capturing = micLive && Number.isFinite(localLevel) && localLevel >= ECHO_LOCAL_FLOOR;
  const attenuated = capturing && localLevel <= remoteLevel * ECHO_ATTENUATION;

  const i = watch.cursor;
  watch.at[i] = now;
  watch.audible[i] = audible ? 1 : 0;
  watch.suspect[i] = audible && attenuated ? 1 : 0;
  watch.cursor = (i + 1) % WATCH_SLOTS;
  if (watch.filled < WATCH_SLOTS) watch.filled += 1;

  // Count over the window only. Walking all the slots and testing the
  // timestamp is cheaper than evicting, and the array is 128 long.
  const cutoff = now - ECHO_WINDOW_MS;
  let audibleCount = 0;
  let suspectCount = 0;
  for (let s = 0; s < watch.filled; s++) {
    if (watch.at[s] < cutoff) continue;
    if (!watch.audible[s]) continue;
    audibleCount += 1;
    if (watch.suspect[s]) suspectCount += 1;
  }

  const fraction = audibleCount > 0 ? suspectCount / audibleCount : 0;
  const enough = audibleCount >= ECHO_MIN_SAMPLES;
  const over = enough && fraction >= ECHO_SUSPECT_FRACTION;

  let started = false;
  if (over && !watch.raised) {
    const quiet = watch.clearedAt === null || now - watch.clearedAt >= ECHO_RENOTICE_MS;
    if (quiet) {
      watch.raised = true;
      started = true;
    }
  } else if (watch.raised && enough && !over) {
    // Cleared. Only on a window with enough samples to mean it: letting a
    // silence clear the notice would drop it the moment the echo stopped being
    // provoked, and raise it again on the next sentence.
    watch.raised = false;
    watch.clearedAt = now;
  }

  return { echoing: watch.raised, started, fraction, samples: audibleCount };
}

/** What the room tells the member when the detector fires. */
export const ECHO_DETECTED_NOTICE =
  "Others are probably hearing themselves back. Your microphone is picking up the call's audio — headphones fix it, or mute while others speak.";
