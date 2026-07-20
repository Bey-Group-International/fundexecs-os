import { DEFAULT_AVATAR, type AvatarConfig, type Facing } from "@/lib/office/avatarConfig";
import { SPRITE_H, SPRITE_W, resolveAvatar } from "@/lib/office/avatarSprites";

const FACINGS: Facing[] = ["down", "up", "left", "right"];

describe("resolveAvatar", () => {
  it("returns a 2-frame walk cycle (idle + 2) for every facing", () => {
    const { frames } = resolveAvatar(DEFAULT_AVATAR);
    for (const facing of FACINGS) {
      expect(frames[facing]).toHaveLength(3);
    }
  });

  it("produces sprites of the declared width and height", () => {
    const { frames } = resolveAvatar(DEFAULT_AVATAR);
    for (const facing of FACINGS) {
      for (const frame of frames[facing]) {
        expect(frame).toHaveLength(SPRITE_H);
        for (const row of frame) {
          expect(row).toHaveLength(SPRITE_W);
        }
      }
    }
  });

  it("keeps all rows the same width within every frame", () => {
    const config: AvatarConfig = {
      skin: "#8a5a34",
      hair: "long",
      hairColor: "#caa14a",
      shirt: "#a855f7",
      accessory: "headset",
    };
    const { frames } = resolveAvatar(config);
    for (const facing of FACINGS) {
      for (const frame of frames[facing]) {
        const widths = new Set(frame.map((row) => row.length));
        expect(widths.size).toBe(1);
      }
    }
  });

  it("is deterministic for the same config", () => {
    const a = resolveAvatar(DEFAULT_AVATAR);
    const b = resolveAvatar({ ...DEFAULT_AVATAR });
    expect(b.frames.down).toEqual(a.frames.down);
    expect(b.palette).toEqual(a.palette);
  });

  it("maps the config's skin, hair, and shirt colors into the palette", () => {
    const config: AvatarConfig = {
      skin: "#d69f6e",
      hair: "bun",
      hairColor: "#c65b3a",
      shirt: "#14b8a6",
      accessory: "glasses",
    };
    const { palette } = resolveAvatar(config);
    const colors = Object.values(palette);
    expect(colors).toContain(config.skin);
    expect(colors).toContain(config.hairColor);
    expect(colors).toContain(config.shirt);
  });

  it("shares the same (mirrored) side art for left and right", () => {
    const { frames } = resolveAvatar(DEFAULT_AVATAR);
    expect(frames.left).toEqual(frames.right);
  });

  it("draws at least one visible pixel per frame", () => {
    const { frames } = resolveAvatar(DEFAULT_AVATAR);
    for (const facing of FACINGS) {
      for (const frame of frames[facing]) {
        const filled = frame.some((row) => /\S/.test(row));
        expect(filled).toBe(true);
      }
    }
  });
});
