import {
  AVATAR_CLIPS,
  planTransition,
  resolveClip,
  resolveClipPlan,
} from "./avatarAnimation3D";
import type { AgentState } from "../program/officeProgram";

const ALL_STATES: AgentState[] = [
  "idle",
  "listening",
  "classifying",
  "assigned",
  "moving",
  "working",
  "collaborating",
  "waiting_for_approval",
  "reviewing",
  "complete",
  "blocked",
];

describe("resolveClipPlan", () => {
  it("maps every AgentState to a known clip", () => {
    for (const state of ALL_STATES) {
      const plan = resolveClipPlan(state);
      expect(AVATAR_CLIPS).toContain(plan.clip);
      expect(plan.crossfadeMs).toBeGreaterThan(0);
    }
  });

  it("uses walk for the moving state and type for working", () => {
    expect(resolveClip("moving")).toBe("walk");
    expect(resolveClip("working")).toBe("type");
    expect(resolveClip("reviewing")).toBe("review");
    expect(resolveClip("collaborating")).toBe("talk");
  });

  it("plays celebrate once (non-looping) on complete", () => {
    const plan = resolveClipPlan("complete");
    expect(plan.clip).toBe("celebrate");
    expect(plan.loop).toBe(false);
  });

  it("forces walk while actively moving, regardless of state", () => {
    expect(resolveClip("working", { moving: true })).toBe("walk");
    expect(resolveClip("idle", { moving: true })).toBe("walk");
  });

  it("downgrades walk to type when seated (a seated actor can't walk)", () => {
    expect(resolveClip("moving", { seated: true })).toBe("type");
    expect(resolveClip("working", { moving: true, seated: true })).toBe("type");
  });
});

describe("planTransition", () => {
  it("returns null when the target clip equals the current one", () => {
    expect(planTransition("type", "working")).toBeNull();
  });

  it("plans a cross-fade when the clip changes", () => {
    const t = planTransition("idle", "moving");
    expect(t).toEqual({ from: "idle", to: "walk", crossfadeMs: 150 });
  });

  it("respects context in the transition target", () => {
    // Seated + moving state → type, not walk.
    expect(planTransition("idle", "moving", { seated: true })).toEqual({
      from: "idle",
      to: "type",
      crossfadeMs: 250,
    });
  });
});
