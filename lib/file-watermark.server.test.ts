jest.mock("server-only", () => ({}), { virtual: true });
import sharp from "sharp";
import {
  overlaySvg,
  watermarkImage,
  watermarkPlan,
  watermarkText,
} from "./file-watermark.server";

const LABEL = "lp@example.com · 2026-11-01 21:00 UTC";

async function solid(
  width: number,
  height: number,
  format: "png" | "jpeg" | "webp" | "gif",
  orientation?: number,
) {
  let img = sharp({
    create: {
      width,
      height,
      channels: 3,
      background: { r: 255, g: 255, b: 255 },
    },
  });
  if (orientation) img = img.withMetadata({ orientation });
  return img[format]().toBuffer();
}

/** Share of pixels that are no longer pure white. */
async function marked(bytes: Buffer): Promise<number> {
  const { data } = await sharp(bytes)
    .removeAlpha()
    .raw()
    .toBuffer({ resolveWithObject: true });
  let n = 0;
  for (let i = 0; i < data.length; i += 3)
    if (data[i] !== 255 || data[i + 1] !== 255 || data[i + 2] !== 255) n++;
  return n / (data.length / 3);
}

describe("watermarkPlan", () => {
  it.each([
    ["a/b.pdf", "pdf"],
    ["a/b.PNG", "image"],
    ["a/b.jpeg", "image"],
    ["a/b.webp", "image"],
    ["a/b.gif", "image"],
    ["a/b.txt", "text"],
    ["a/b.md", "text"],
    // Bytes that cannot carry a mark.
    ["a/b.docx", "none"],
    ["a/b.xlsx", "none"],
    ["a/b.pptx", "none"],
    ["a/b.csv", "none"],
    ["a/b.rtf", "none"],
    ["a/b.mp4", "none"],
    ["a/b.mov", "none"],
    ["a/b.svg", "none"],
  ])("%s -> %s", (key, plan) => {
    expect(watermarkPlan(key)).toBe(plan);
  });
});

describe("watermarkImage", () => {
  it.each([
    ["png", ".png", "image/png", ".png"],
    ["jpeg", ".jpg", "image/jpeg", ".jpg"],
    ["webp", ".webp", "image/webp", ".webp"],
    ["gif", ".gif", "image/png", ".png"],
  ] as const)(
    "draws the label over a %s and keeps its size",
    async (format, ext, type, outExt) => {
      const src = await solid(400, 300, format);
      expect(await marked(src)).toBe(0);
      const out = await watermarkImage(src, LABEL, ext);
      expect(out.contentType).toBe(type);
      expect(out.ext).toBe(outExt);
      const meta = await sharp(out.bytes).metadata();
      expect([meta.width, meta.height]).toEqual([400, 300]);
      // Not a token pixel: the diagonal bands and the footer cover a real share.
      expect(await marked(out.bytes)).toBeGreaterThan(0.01);
    },
  );

  it("marks a tiny image too", async () => {
    const out = await watermarkImage(await solid(40, 30, "png"), LABEL, ".png");
    expect(await marked(out.bytes)).toBeGreaterThan(0);
  });

  it("draws on the upright picture when EXIF turns it on its side", async () => {
    const out = await watermarkImage(
      await solid(400, 200, "jpeg", 6),
      LABEL,
      ".jpg",
    );
    const meta = await sharp(out.bytes).metadata();
    expect([meta.width, meta.height]).toEqual([200, 400]);
    expect(await marked(out.bytes)).toBeGreaterThan(0.01);
  });

  it("refuses bytes that are not an image rather than passing them through", async () => {
    await expect(
      watermarkImage(Buffer.from("not an image"), LABEL, ".png"),
    ).rejects.toThrow();
  });
});

describe("the overlay", () => {
  it("is shapes, not SVG text, so it does not depend on fonts being installed", () => {
    const svg = overlaySvg(LABEL, 400, 300);
    expect(svg).not.toContain("<text");
    expect(svg).toContain("<path");
  });

  it("cannot be made to carry markup by the label", () => {
    const svg = overlaySvg('"><script>alert(1)</script>&', 400, 300);
    expect(svg).not.toContain("script");
    expect(svg.match(/</g)!.length).toBe(svg.match(/<[a-z/]/g)!.length);
  });
});

describe("watermarkText", () => {
  it("puts the label above and below the text and keeps the text intact", () => {
    const out = watermarkText(
      Buffer.from("Terms\nCarry 20%\n"),
      LABEL,
    ).toString("utf-8");
    const mark = `=== ${LABEL} ===`;
    expect(out.startsWith(`${mark}\n\n`)).toBe(true);
    expect(out.trimEnd().endsWith(mark)).toBe(true);
    expect(out).toContain("Terms\nCarry 20%\n");
  });

  it("keeps the label on one line", () => {
    const out = watermarkText(Buffer.from("x"), "a\nb\r\nc").toString("utf-8");
    expect(out.split("\n")[0]).toBe("=== a b c ===");
  });
});
