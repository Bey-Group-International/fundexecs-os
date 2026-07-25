import {
  initState,
  perceive,
  remember,
  tickDrives,
  selectBehavior,
  commit,
  introspect,
  step,
  MEMORY_CAP,
  type Signal,
} from "@/lib/avatars/self-model";
import { defaultBehaviorProfile, type BehaviorProfile } from "@/lib/avatars/descriptor";

const profile: BehaviorProfile = defaultBehaviorProfile({
  baseline: { energy: 0.8, focus: 0.6, social: 0.5 },
  goals: [
    { id: "core_work", kind: "work", priority: 0.9 },
    { id: "network", kind: "social", priority: 0.5 },
  ],
  socialBias: 0.7,
});

describe("self-model · initState", () => {
  it("starts drives at the profile baseline and activates the top-priority goal", () => {
    const s = initState(profile);
    expect(s.drives).toEqual({ energy: 0.8, focus: 0.6, social: 0.5 });
    expect(s.activeGoal).toBe("core_work");
    expect(s.activeBehavior).toBe("idle");
    expect(s.memory).toHaveLength(0);
  });
});

describe("self-model · memory", () => {
  it("caps the ring buffer and evicts the lowest-salience item", () => {
    let s = initState(profile);
    for (let i = 0; i < MEMORY_CAP; i++) s = remember(s, { type: "tick", summary: `e${i}`, salience: 0.5 });
    // one clearly-important item, then overflow with a trivial one
    s = remember(s, { type: "key", summary: "important", salience: 0.95 });
    expect(s.memory).toHaveLength(MEMORY_CAP);
    s = remember(s, { type: "noise", summary: "trivial", salience: 0.01 });
    expect(s.memory).toHaveLength(MEMORY_CAP);
    // the trivial overflow item is the one evicted; the important one survives
    expect(s.memory.some((m) => m.summary === "important")).toBe(true);
    expect(s.memory.some((m) => m.summary === "trivial")).toBe(false);
  });
});

describe("self-model · perceive", () => {
  it("merges context, advances the clock, and records salient signals", () => {
    const s0 = initState(profile);
    const sig: Signal = { type: "raise.funded", zone: "trading_floor", nearby: ["capital-raiser"], agent: "NOVA" };
    const s1 = perceive(s0, sig);
    expect(s1.t).toBe(1);
    expect(s1.context.zone).toBe("trading_floor");
    expect(s1.context.nearby).toEqual(["capital-raiser"]);
    expect(s1.context.lastSignal).toBe("raise.funded");
    expect(s1.affect.confidence).toBeGreaterThan(s0.affect.confidence);
    expect(s1.affect.valence).toBeGreaterThan(s0.affect.valence);
    expect(s1.memory.at(-1)?.type).toBe("raise.funded");
  });
});

describe("self-model · tickDrives", () => {
  it("relaxes drives toward baseline and drains energy while working", () => {
    let s = initState(profile);
    s = { ...s, drives: { ...s.drives, energy: 0.4 }, activeBehavior: "work_at_desk" };
    const after = tickDrives(s, 1, profile.baseline);
    // pulled toward baseline (0.8) but working applies a drain, so still bounded
    expect(after.drives.energy).toBeGreaterThan(0.4 - 0.05);
    expect(after.drives.energy).toBeLessThanOrEqual(0.8);
    expect(after.drives.focus).toBeGreaterThanOrEqual(s.drives.focus);
  });
});

describe("self-model · selectBehavior (+ safe fallback)", () => {
  it("chooses work when the top goal is work and energy is healthy", () => {
    const s = initState(profile);
    expect(selectBehavior(s, profile).behavior).toBe("work_at_desk");
  });

  it("chooses converse over heads-down work when someone's nearby, social is high, and energy is moderate", () => {
    // At full energy the work goal dominates (professional/restrained default);
    // conversation wins when the avatar is less inclined to grind.
    let s = initState(profile);
    s = { ...s, drives: { ...s.drives, energy: 0.3, social: 0.9 }, context: { ...s.context, nearby: ["rainmaker"] } };
    expect(selectBehavior(s, profile).behavior).toBe("converse");
  });

  it("takes a break when energy is low", () => {
    let s = initState(profile);
    s = { ...s, drives: { ...s.drives, energy: 0.2 } };
    expect(selectBehavior(s, profile).behavior).toBe("take_break");
  });

  it("falls back to idle when no behavior clears the threshold", () => {
    const flat = defaultBehaviorProfile({ goals: [{ id: "wait", kind: "idle", priority: 0.1 }], socialBias: 0 });
    const s = initState(flat);
    expect(selectBehavior(s, flat).behavior).toBe("idle");
  });
});

describe("self-model · introspect", () => {
  it("returns the canonical shape and explains the active behavior", () => {
    let s = initState(profile);
    s = commit(s, selectBehavior(s, profile));
    const r = introspect(s, profile);
    expect(typeof r.say).toBe("string");
    expect(r.say.length).toBeGreaterThan(0);
    expect(r.intent).toBe(s.activeBehavior);
    expect(Array.isArray(r.because)).toBe(true);
    expect(r.because[0]).toMatch(/^goal:core_work/);
    expect(r.confidence).toBeGreaterThanOrEqual(0);
    expect(r.confidence).toBeLessThanOrEqual(1);
    expect(r.focus).toBe("core_work");
    expect(r.mood).toEqual(expect.any(String));
  });

  it("suggests a break in `next` when energy is low", () => {
    let s = initState(profile);
    s = { ...s, drives: { ...s.drives, energy: 0.2 } };
    s = commit(s, selectBehavior(s, profile));
    expect(introspect(s, profile).next).toMatch(/break/);
  });
});

describe("self-model · step", () => {
  it("runs a full fast-loop step deterministically", () => {
    const s0 = initState(profile);
    const s1 = step(s0, profile, { dt: 1, signal: { type: "user.select" } });
    expect(s1.t).toBe(1);
    expect(typeof s1.activeBehavior).toBe("string");
    // pure: same inputs → same output
    const s1b = step(s0, profile, { dt: 1, signal: { type: "user.select" } });
    expect(s1b).toEqual(s1);
  });
});
