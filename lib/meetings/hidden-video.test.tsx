import { attachHiddenVideo, detachHiddenVideo } from "./hidden-video";

describe("hidden video surfaces", () => {
  it("puts a real element in the document, out of sight, and takes it back out", () => {
    const el = document.createElement("video");
    attachHiddenVideo(el);
    expect(el.isConnected).toBe(true);
    expect(el.style.opacity).toBe("0");
    expect(el.style.width).toBe("1px");
    expect(el.getAttribute("aria-hidden")).toBe("true");
    attachHiddenVideo(el);
    expect(document.querySelectorAll("video")).toHaveLength(1);
    detachHiddenVideo(el);
    expect(el.isConnected).toBe(false);
    expect(() => detachHiddenVideo(el)).not.toThrow();
  });

  it("ignores a stand-in that is not an element", () => {
    const fake = { srcObject: null } as unknown as HTMLVideoElement;
    expect(() => attachHiddenVideo(fake)).not.toThrow();
    expect(() => detachHiddenVideo(fake)).not.toThrow();
    expect(document.querySelectorAll("video")).toHaveLength(0);
  });
});
