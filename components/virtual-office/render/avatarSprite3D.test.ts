import {
  characterSpriteFor,
  frameIndexAt,
  spriteAnimationState,
} from "./avatarSprite3D";
import { spriteFrameMaps } from "@/components/characters/spriteFrameMap";

describe("characterSpriteFor", () => {
  it("resolves a known character key to its sheet + frame dims", () => {
    const s = characterSpriteFor("deal-sourcer");
    expect(s).not.toBeNull();
    expect(s!.sheetUrl).toContain("/characters/deal-sourcer/");
    // deal-sourcer uses the "executive" 16x32 frame map.
    expect(s!.frameWidth).toBe(spriteFrameMaps.executive.frameWidth);
    expect(s!.frameHeight).toBe(spriteFrameMaps.executive.frameHeight);
  });

  it("resolves the earnest mascot to the 32x32 frame map", () => {
    const s = characterSpriteFor("earnest-fundmaker");
    expect(s!.frameWidth).toBe(spriteFrameMaps.earnest.frameWidth);
  });

  it("returns null for unknown keys, empty, or sheet-less characters", () => {
    expect(characterSpriteFor("nope")).toBeNull();
    expect(characterSpriteFor(undefined)).toBeNull();
    expect(characterSpriteFor("master-workflow")).toBeNull(); // config entry has no spriteSheet
  });
});

describe("spriteAnimationState", () => {
  it("picks the directional walk cycle when moving", () => {
    expect(spriteAnimationState("idle", "down", true)).toBe("walkDown");
    expect(spriteAnimationState("idle", "up", true)).toBe("walkUp");
    expect(spriteAnimationState("idle", "left", true)).toBe("walkLeft");
    expect(spriteAnimationState("idle", "right", true)).toBe("walkRight");
  });

  it("treats the 'moving' state as walking even without the flag", () => {
    expect(spriteAnimationState("moving", "right", false)).toBe("walkRight");
  });

  it("idles for every stationary state (sheets have no talk/success rows)", () => {
    expect(spriteAnimationState("collaborating", "down", false)).toBe("idle");
    expect(spriteAnimationState("complete", "down", false)).toBe("idle");
    expect(spriteAnimationState("working", "down", false)).toBe("idle");
    expect(spriteAnimationState("blocked", "down", false)).toBe("idle");
  });
});

describe("frameIndexAt", () => {
  const anim = { row: 1, frames: [0, 1, 2, 3], fps: 8 };

  it("cycles frames at the animation's fps", () => {
    expect(frameIndexAt(anim, 0)).toBe(0);
    expect(frameIndexAt(anim, 125)).toBe(1); // 1/8s → frame 1
    expect(frameIndexAt(anim, 250)).toBe(2);
    expect(frameIndexAt(anim, 500)).toBe(0); // 4/8s → wraps (4 frames)
  });

  it("is safe for an empty frame list", () => {
    expect(frameIndexAt({ row: 0, frames: [], fps: 4 }, 100)).toBe(0);
  });
});
