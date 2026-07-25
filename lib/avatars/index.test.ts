import { behaviorProfileForAvatar, selfModelForAvatar } from "@/lib/avatars";
import { AVATAR_BRAINS } from "@/lib/brains/avatars";

describe("avatars · behaviorProfileForAvatar", () => {
  it("builds a valid profile for every office avatar (by id and by sprite)", () => {
    for (const a of AVATAR_BRAINS) {
      for (const key of [a.id, a.sprite]) {
        const p = behaviorProfileForAvatar(key);
        expect(p).not.toBeNull();
        expect(p!.goals.length).toBeGreaterThan(0);
        expect(p!.baseline.energy).toBeGreaterThan(0);
        expect(p!.socialBias).toBeGreaterThanOrEqual(0);
        expect(p!.socialBias).toBeLessThanOrEqual(1);
      }
    }
  });

  it("gives roamers a client-facing, more social profile with a network goal", () => {
    const rainmaker = behaviorProfileForAvatar("rm")!;
    const curator = behaviorProfileForAvatar("cu")!;
    expect(rainmaker.roamProfile).toBe("client_facing");
    expect(rainmaker.homeZone).toBe("trading_floor");
    expect(rainmaker.goals.some((g) => g.kind === "social")).toBe(true);
    expect(rainmaker.socialBias).toBeGreaterThan(curator.socialBias);
  });

  it("lowers the energy baseline for an away avatar", () => {
    // Workflow Instructor (wf) is seeded 'away' in the roster.
    expect(behaviorProfileForAvatar("wf")!.baseline.energy).toBeLessThan(
      behaviorProfileForAvatar("cu")!.baseline.energy,
    );
  });

  it("returns null for an unknown avatar", () => {
    expect(behaviorProfileForAvatar("not-an-avatar")).toBeNull();
    expect(selfModelForAvatar("not-an-avatar")).toBeNull();
  });
});

describe("avatars · selfModelForAvatar", () => {
  it("seeds an initial self-model whose active goal is the top persona goal", () => {
    const s = selfModelForAvatar("rainmaker")!;
    expect(s).not.toBeNull();
    expect(s.activeGoal).toBe("core_work"); // priority 0.9 > network 0.7
    expect(s.drives.energy).toBeGreaterThan(0);
    expect(s.memory).toHaveLength(0);
  });
});
