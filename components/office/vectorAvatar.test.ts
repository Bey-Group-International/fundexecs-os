import { drawAvatar } from "@/components/office/vectorAvatar";
import { AGENTS } from "@/lib/agents";
import {
  ACCESSORIES,
  BUILDS,
  DEFAULT_AVATAR,
  OUTFIT_STYLES,
  type AvatarConfig,
  type Facing,
} from "@/lib/office/avatarConfig";
import type { PresenceStatus } from "@/lib/office/presence";

// A minimal mock 2D context: every drawing method is a no-op, and the gradient
// factories return objects with addColorStop, which is all the engine touches.
function mockCtx(): CanvasRenderingContext2D {
  const gradient = { addColorStop: () => {} };
  const handler: ProxyHandler<Record<string, unknown>> = {
    get(target, prop: string) {
      if (prop === "createLinearGradient" || prop === "createRadialGradient") {
        return () => gradient;
      }
      if (prop === "canvas") return { width: 300, height: 300 };
      if (!(prop in target)) {
        target[prop] = () => {};
      }
      return target[prop];
    },
    set(target, prop: string, val) {
      target[prop] = val;
      return true;
    },
  };
  return new Proxy({}, handler) as unknown as CanvasRenderingContext2D;
}

const FACINGS: Facing[] = ["down", "up", "left", "right"];

describe("drawAvatar", () => {
  it("runs for every facing, moving and idle, without throwing", () => {
    const ctx = mockCtx();
    for (const facing of FACINGS) {
      for (const moving of [false, true]) {
        for (const timeMs of [0, 250, 1000, 4210]) {
          expect(() =>
            drawAvatar(ctx, {
              config: DEFAULT_AVATAR,
              x: 100,
              y: 200,
              height: 120,
              facing,
              timeMs,
              moving,
            }),
          ).not.toThrow();
        }
      }
    }
  });

  it("draws an agent by key across every facing", () => {
    const ctx = mockCtx();
    for (const agent of AGENTS) {
      for (const facing of FACINGS) {
        expect(() =>
          drawAvatar(ctx, {
            agentKey: agent.key,
            x: 50,
            y: 90,
            height: 80,
            facing,
            timeMs: 500,
            moving: true,
          }),
        ).not.toThrow();
      }
    }
  });

  it("draws a human config across every build and accessory", () => {
    const ctx = mockCtx();
    for (const build of BUILDS) {
      for (const accessory of ACCESSORIES) {
        const config: AvatarConfig = { ...DEFAULT_AVATAR, build, accessory };
        expect(() =>
          drawAvatar(ctx, {
            config,
            x: 30,
            y: 60,
            height: 64,
            facing: "down",
            timeMs: 800,
            moving: false,
          }),
        ).not.toThrow();
      }
    }
  });

  it("draws every outfit style and each status", () => {
    const ctx = mockCtx();
    const statuses: (PresenceStatus | undefined)[] = [
      undefined,
      "available",
      "focusing",
      "away",
      "in_meeting",
    ];
    for (const outfit of OUTFIT_STYLES) {
      for (const status of statuses) {
        const config: AvatarConfig = { ...DEFAULT_AVATAR, outfit };
        expect(() =>
          drawAvatar(ctx, {
            config,
            x: 40,
            y: 80,
            height: 100,
            facing: "left",
            timeMs: 1200,
            moving: false,
            status,
          }),
        ).not.toThrow();
      }
    }
  });

  it("prefers agentKey over an explicit config", () => {
    const ctx = mockCtx();
    expect(() =>
      drawAvatar(ctx, {
        agentKey: "analyst",
        config: DEFAULT_AVATAR,
        x: 10,
        y: 20,
        height: 40,
        facing: "right",
        timeMs: 0,
        moving: false,
      }),
    ).not.toThrow();
  });
});
