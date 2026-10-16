import { config } from "@/proxy";

// Next compiles `matcher` with path-to-regexp; this one is a plain negative
// lookahead, which reads the same as a RegExp anchored at both ends.
const matcher = new RegExp(`^${config.matcher[0]}$`);

describe("proxy matcher", () => {
  it("runs on pages and API routes, which need the session refresh", () => {
    for (const path of ["/", "/meetings/abc", "/api/meetings/abc/recording/1/stream", "/join/CODE"]) {
      expect(matcher.test(path)).toBe(true);
    }
  });

  it("skips the self-hosted segmenter files, which are static", () => {
    for (const path of [
      "/mediapipe/vision_wasm_internal.wasm",
      "/mediapipe/vision_wasm_internal.js",
      "/mediapipe/selfie_segmenter.tflite",
    ]) {
      expect(matcher.test(path)).toBe(false);
    }
  });

  it("still skips the assets it always skipped", () => {
    for (const path of ["/_next/static/chunk.js", "/_next/image", "/favicon.ico", "/logo.svg", "/hero.webp"]) {
      expect(matcher.test(path)).toBe(false);
    }
  });

  it("does not swallow a page whose name merely starts with the folder's", () => {
    expect(matcher.test("/mediapipe-notes")).toBe(true);
  });
});
