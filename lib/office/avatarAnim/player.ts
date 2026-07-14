/**
 * AvatarAnimator — the runtime clip player.
 *
 * Owns a current clip and a clock, advances on each frame's delta, and samples
 * the tweened channel values the renderer applies. On a clip change it captures
 * the current pose and cross-fades into the new clip over a short blend, so
 * transitions (idle → present, present → celebrate) never snap — the OpenToonz
 * "ease between states" behaviour, at the state-machine level.
 *
 * Deterministic and renderer-free: feed it deltas, read back a sample. The
 * caller decides which clip to play from workflow/activity state.
 */
import type { AnimSample, AnimChannel } from "./types";
import { sampleClip, isClipFinished } from "./sampler";
import { CLIPS, getClip, type ClipName } from "./clips";

export class AvatarAnimator {
  private clipName: ClipName;
  private t = 0;
  private fromPose: AnimSample | null = null;
  private blendT = 0;
  private blendMs = 0;

  constructor(initial: ClipName = "idleBreathe") {
    this.clipName = initial;
  }

  /** The clip currently playing. */
  get current(): ClipName {
    return this.clipName;
  }

  /**
   * Switch to `name`, cross-fading from the current pose over `blendMs`. A no-op
   * if already on that clip (unless `restart`), so it's safe to call every frame.
   */
  play(name: ClipName, opts: { blendMs?: number; restart?: boolean } = {}): void {
    if (this.clipName === name && !opts.restart) return;
    this.fromPose = this.sample();
    this.blendMs = Math.max(0, opts.blendMs ?? 180);
    this.blendT = 0;
    this.clipName = name;
    this.t = 0;
  }

  /** Advance the clock (and any in-progress blend) by `dtMs`. */
  update(dtMs: number): void {
    this.t += dtMs;
    if (this.blendT < this.blendMs) this.blendT += dtMs;
  }

  /** True once a one-shot clip has finished (looping clips never finish). */
  isFinished(): boolean {
    return isClipFinished(getClip(this.clipName), this.t);
  }

  /** The tweened channel values for the current moment (blend-aware). */
  sample(): AnimSample {
    const cur = sampleClip(CLIPS[this.clipName], this.t);
    if (!this.fromPose || this.blendMs <= 0 || this.blendT >= this.blendMs) {
      return cur;
    }
    const a = this.blendT / this.blendMs; // 0 (all prev) → 1 (all current)
    const out: AnimSample = {};
    const channels = new Set<AnimChannel>([
      ...(Object.keys(cur) as AnimChannel[]),
      ...(Object.keys(this.fromPose) as AnimChannel[]),
    ]);
    for (const ch of channels) {
      const from = this.fromPose[ch] ?? 0;
      const to = cur[ch] ?? 0;
      out[ch] = from + (to - from) * a;
    }
    return out;
  }
}
