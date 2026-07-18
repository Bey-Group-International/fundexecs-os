/**
 * Animation player — frame-index sequencing for a given animation state.
 *
 * Pure timing/indexing logic (no DOM) so it is unit-testable. The React layer
 * drives `tick(now)` from requestAnimationFrame and reads `frame`. Respects the
 * state's fps and loop flag; non-looping states (approve) hold the last frame.
 */
import type { AnimationDefinition, AnimationState } from "./types";

export class AnimationPlayer {
  state: AnimationState;
  frame = 0;
  playing = true;
  /** Playback rate multiplier (0.25×–3× in the UI). */
  speed = 1;

  private def: AnimationDefinition;
  private lastAdvance = 0;
  private started = false;

  constructor(state: AnimationState, def: AnimationDefinition) {
    this.state = state;
    this.def = def;
  }

  setState(state: AnimationState, def: AnimationDefinition): void {
    this.state = state;
    this.def = def;
    this.frame = 0;
    this.started = false;
    this.playing = true;
  }

  get frameCount(): number {
    return this.def.framesPerDirection;
  }

  /** Advance based on wall-clock `now` (ms). Returns true if the frame changed. */
  tick(now: number): boolean {
    if (!this.playing) return false;
    if (!this.started) {
      this.started = true;
      this.lastAdvance = now;
      return false;
    }
    const interval = 1000 / (this.def.fps * this.speed);
    if (now - this.lastAdvance < interval) return false;
    this.lastAdvance = now;

    const nextRaw = this.frame + 1;
    if (nextRaw >= this.def.framesPerDirection) {
      if (this.def.loop) {
        this.frame = 0;
      } else {
        this.frame = this.def.framesPerDirection - 1;
        this.playing = false; // hold last frame for non-looping approve
      }
    } else {
      this.frame = nextRaw;
    }
    return true;
  }

  play(): void {
    if (!this.playing && !this.def.loop && this.frame >= this.def.framesPerDirection - 1) {
      this.frame = 0; // replay a finished one-shot
    }
    this.playing = true;
    this.started = false;
  }
  pause(): void {
    this.playing = false;
  }
  stepForward(): void {
    this.frame = (this.frame + 1) % this.def.framesPerDirection;
    this.playing = false;
  }
  stepBack(): void {
    this.frame = (this.frame - 1 + this.def.framesPerDirection) % this.def.framesPerDirection;
    this.playing = false;
  }
}
