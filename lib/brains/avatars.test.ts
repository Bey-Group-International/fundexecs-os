import {
  AVATAR_BRAINS,
  AVATAR_BRAIN_BY_ID,
  AVATAR_BRAIN_BY_SPRITE,
  brainForAvatar,
} from "@/lib/brains/avatars";
import { BRAIN_BY_KEY } from "@/lib/brains/catalog";

describe("avatar ↔ brain mapping", () => {
  it("maps all 15 office avatars", () => {
    expect(AVATAR_BRAINS).toHaveLength(15);
  });

  it("uses a unique roster id and sprite per avatar", () => {
    const ids = AVATAR_BRAINS.map((a) => a.id);
    const sprites = AVATAR_BRAINS.map((a) => a.sprite);
    expect(new Set(ids).size).toBe(ids.length);
    expect(new Set(sprites).size).toBe(sprites.length);
  });

  it("points every non-null brainKey at a real Brain in the catalog", () => {
    for (const a of AVATAR_BRAINS) {
      if (a.brainKey !== null) {
        expect(BRAIN_BY_KEY[a.brainKey]).toBeDefined();
      }
    }
  });

  it("leaves only the Office Manager and Workflow Instructor without a Brain", () => {
    const brainless = AVATAR_BRAINS.filter((a) => a.brainKey === null).map((a) => a.id).sort();
    expect(brainless).toEqual(["om", "wf"]);
  });

  it("fronts the Earn mascot with the Earnest Fundmaker Brain", () => {
    expect(brainForAvatar("earn")).toBe("earnest_fundmaker");
    expect(brainForAvatar("er")).toBe("earnest_fundmaker");
  });

  it("resolves a brain by roster id or sprite key, null otherwise", () => {
    expect(brainForAvatar("rm")).toBe("rainmaker");
    expect(brainForAvatar("rainmaker")).toBe("rainmaker");
    expect(brainForAvatar("om")).toBeNull();
    expect(brainForAvatar("not-an-avatar")).toBeNull();
  });

  it("indexes by id and sprite", () => {
    for (const a of AVATAR_BRAINS) {
      expect(AVATAR_BRAIN_BY_ID[a.id]).toBe(a);
      expect(AVATAR_BRAIN_BY_SPRITE[a.sprite]).toBe(a);
    }
  });
});
