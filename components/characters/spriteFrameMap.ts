export type SpriteAnimationState =
  | "idle"
  | "walkDown"
  | "walkUp"
  | "walkLeft"
  | "walkRight"
  | "talk"
  | "success"
  | "loading";

export type SpriteAnimation = {
  row: number;
  frames: number[];
  fps: number;
};

export type SpriteFrameMap = {
  name: string;
  frameWidth: number;
  frameHeight: number;
  scale: number;
  animations: Record<SpriteAnimationState, SpriteAnimation>;
};

const earnestAnimations: Record<SpriteAnimationState, SpriteAnimation> = {
  idle: { row: 0, frames: [0, 1, 2, 3], fps: 4 },
  walkDown: { row: 1, frames: [0, 1, 2, 3], fps: 8 },
  walkUp: { row: 2, frames: [0, 1, 2, 3], fps: 8 },
  walkLeft: { row: 3, frames: [0, 1, 2, 3], fps: 8 },
  walkRight: { row: 4, frames: [0, 1, 2, 3], fps: 8 },
  talk: { row: 5, frames: [0, 1, 2], fps: 6 },
  success: { row: 6, frames: [0, 1, 2, 3], fps: 6 },
  loading: { row: 7, frames: [0, 1, 2, 3, 4, 5], fps: 8 },
};

const executiveAnimations: Record<SpriteAnimationState, SpriteAnimation> = {
  idle: { row: 0, frames: [0, 1, 2, 3], fps: 4 },
  walkDown: { row: 1, frames: [0, 1, 2, 3], fps: 8 },
  walkUp: { row: 2, frames: [0, 1, 2, 3], fps: 8 },
  walkLeft: { row: 3, frames: [0, 1, 2, 3], fps: 8 },
  walkRight: { row: 4, frames: [0, 1, 2, 3], fps: 8 },
  talk: { row: 5, frames: [0, 1, 2], fps: 6 },
  success: { row: 6, frames: [0, 1, 2, 3], fps: 6 },
  loading: { row: 0, frames: [0], fps: 1 },
};

export const spriteFrameMaps = {
  earnest: {
    name: "Earnest Fundmaker",
    frameWidth: 32,
    frameHeight: 32,
    scale: 2,
    animations: earnestAnimations,
  },
  executive: {
    name: "Human Executive",
    frameWidth: 16,
    frameHeight: 32,
    scale: 2,
    animations: executiveAnimations,
  },
} satisfies Record<string, SpriteFrameMap>;
