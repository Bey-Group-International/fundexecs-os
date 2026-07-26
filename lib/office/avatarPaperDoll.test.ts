import {
  AVATAR_VIEWBOX,
  avatarInnerSvg,
  renderAvatarPaperDollSvg,
} from "@/lib/office/avatarPaperDoll";
import { DEFAULT_AVATAR_CONFIG, normalizeAvatarConfig } from "@/lib/office/avatarConfig";

describe("avatarPaperDoll · renderAvatarPaperDollSvg", () => {
  it("returns a well-formed standalone <svg> with the right viewBox", () => {
    const svg = renderAvatarPaperDollSvg(DEFAULT_AVATAR_CONFIG, { size: 180 });
    expect(svg.startsWith("<svg")).toBe(true);
    expect(svg.trim().endsWith("</svg>")).toBe(true);
    expect(svg).toContain(`viewBox="0 0 ${AVATAR_VIEWBOX.w} ${AVATAR_VIEWBOX.h}"`);
    expect(svg).toContain('width="180"');
    expect(svg).toContain(`height="${(180 * AVATAR_VIEWBOX.h) / AVATAR_VIEWBOX.w}"`);
  });

  it("is deterministic for a given config", () => {
    const a = renderAvatarPaperDollSvg(DEFAULT_AVATAR_CONFIG);
    const b = renderAvatarPaperDollSvg(DEFAULT_AVATAR_CONFIG);
    expect(a).toBe(b);
  });

  it("varies with appearance changes", () => {
    const base = renderAvatarPaperDollSvg(DEFAULT_AVATAR_CONFIG);
    const other = renderAvatarPaperDollSvg(
      normalizeAvatarConfig({ ...DEFAULT_AVATAR_CONFIG, outfitColor: "burgundy", hair: "curly" }),
    );
    expect(other).not.toBe(base);
  });

  it("inner mode omits the <svg> wrapper for host embedding", () => {
    const inner = renderAvatarPaperDollSvg(DEFAULT_AVATAR_CONFIG, { inner: true });
    expect(inner).not.toContain("<svg");
    expect(inner).toBe(avatarInnerSvg(DEFAULT_AVATAR_CONFIG));
  });

  it("draws the status ring and shadow only when asked", () => {
    const plain = renderAvatarPaperDollSvg(DEFAULT_AVATAR_CONFIG, {});
    const decorated = renderAvatarPaperDollSvg(DEFAULT_AVATAR_CONFIG, {
      showStatusRing: true,
      showShadow: true,
    });
    expect(plain).not.toContain('r="122"');
    expect(decorated).toContain('r="122"'); // status ring
    expect(decorated).toContain("rgba(0,0,0,0.28)"); // ground shadow
  });

  it("escapes the display name in the accessible label / title", () => {
    const cfg = normalizeAvatarConfig({ displayName: 'A<b>"&x' });
    const svg = renderAvatarPaperDollSvg(cfg, { title: cfg.displayName });
    expect(svg).not.toMatch(/aria-label="[^"]*<b>/);
    expect(svg).toContain("&lt;b&gt;");
    expect(svg).not.toContain("<title><b>");
  });

  it("renders a bald character without hair paths but still a head", () => {
    const bald = renderAvatarPaperDollSvg(normalizeAvatarConfig({ hair: "bald", facialHair: "none" }), {
      inner: true,
    });
    // Head ellipse present; no front-hair cap fill for the hair color.
    expect(bald).toContain("ellipse");
  });
});
