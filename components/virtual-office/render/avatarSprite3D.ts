/**
 * FundExecs OS — 3D avatar sprite selection (pure, testable).
 *
 * Phase 2 of restoring the office look in 3D: instead of capsule avatars, each
 * executive is drawn as a billboarded sprite using its EXISTING sprite sheet
 * (`characterConfig.spriteSheet`) — a classic 2.5D look that brings the real
 * characters/NPCs into the 3D scene with no new art.
 *
 * This module holds only the pure logic — which sheet an agent uses, which
 * animation its state/facing maps to, and which frame plays at a given time —
 * so it is unit-testable. `ThreeOfficeRenderer` consumes it to drive a
 * `THREE.Sprite`'s texture offset/repeat each frame. Reuses `characterConfig`
 * and `spriteFrameMap`, which are plain data (no Phaser, no DOM).
 */

import { executiveCharacters } from "@/components/characters/characterConfig";
import {
  spriteFrameMaps,
  type SpriteAnimation,
  type SpriteAnimationState,
} from "@/components/characters/spriteFrameMap";
import type { AgentState } from "../program/officeProgram";
import type { ActorFacing } from "./OfficeRenderer";

/** Everything the renderer needs to draw + animate one character sprite. */
export type CharacterSprite = {
  sheetUrl: string;
  frameWidth: number;
  frameHeight: number;
  animations: Record<SpriteAnimationState, SpriteAnimation>;
};

/**
 * Resolve the sprite sheet + frame map for a character key (matches an
 * `executiveCharacters[].id`, which is what `ActorSpec.spriteKey` carries).
 * Returns `null` when the key is unknown or the character has no sheet (e.g.
 * the local user, a remote human, or a config-only executive) — the renderer
 * then falls back to its capsule avatar.
 */
export function characterSpriteFor(spriteKey: string | undefined): CharacterSprite | null {
  if (!spriteKey) return null;
  const character = executiveCharacters.find((c) => c.id === spriteKey);
  if (!character?.spriteSheet) return null;
  const frameMap = spriteFrameMaps[character.frameMapKind];
  return {
    sheetUrl: character.spriteSheet,
    frameWidth: frameMap.frameWidth,
    frameHeight: frameMap.frameHeight,
    animations: frameMap.animations,
  };
}

/**
 * Map an agent's program state + facing to a sprite animation. Movement (the
 * `moving` state or an in-flight walk) picks the directional walk cycle; a few
 * states get expressive loops (collaborating → talk, complete → success);
 * everything else idles.
 */
export function spriteAnimationState(
  state: AgentState,
  facing: ActorFacing,
  moving: boolean,
): SpriteAnimationState {
  if (moving || state === "moving") {
    switch (facing) {
      case "up":
        return "walkUp";
      case "left":
        return "walkLeft";
      case "right":
        return "walkRight";
      default:
        return "walkDown";
    }
  }
  switch (state) {
    case "collaborating":
      return "talk";
    case "complete":
      return "success";
    default:
      return "idle";
  }
}

/**
 * The sprite-sheet frame index to show at `elapsedMs` for an animation, cycling
 * through its `frames` at its `fps`. Returns the frame's column in its row.
 */
export function frameIndexAt(anim: SpriteAnimation, elapsedMs: number): number {
  if (anim.frames.length === 0) return 0;
  const step = Math.floor((elapsedMs / 1000) * anim.fps) % anim.frames.length;
  return anim.frames[step];
}
