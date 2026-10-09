import { holdScreenAwake, type WakeLockHost, type WakeLockSentinelLike } from "./wake-lock";

function host(opts: { api?: boolean; visible?: boolean; reject?: boolean } = {}) {
  const listeners = new Set<() => void>();
  const sentinels: { released: boolean }[] = [];
  const request = jest.fn((_type: "screen") => {
    if (opts.reject) return Promise.reject(new Error("NotAllowedError"));
    const s = { released: false };
    sentinels.push(s);
    const sentinel: WakeLockSentinelLike = { release: () => { s.released = true; return Promise.resolve(); } };
    return Promise.resolve(sentinel);
  });
  const doc = {
    visibilityState: opts.visible === false ? "hidden" : "visible",
    addEventListener: (_t: "visibilitychange", fn: () => void) => { listeners.add(fn); },
    removeEventListener: (_t: "visibilitychange", fn: () => void) => { listeners.delete(fn); },
  };
  const h: WakeLockHost = {
    navigator: opts.api === false ? {} : { wakeLock: { request } },
    document: doc,
  };
  return {
    h, request, sentinels, listeners,
    show() { doc.visibilityState = "visible"; listeners.forEach((fn) => fn()); },
    hide() { doc.visibilityState = "hidden"; listeners.forEach((fn) => fn()); },
  };
}

const flush = () => new Promise((r) => setTimeout(r, 0));

describe("holdScreenAwake", () => {
  it("requests a screen lock on a visible page and releases it on stop", async () => {
    const t = host();
    const stop = holdScreenAwake(t.h);
    expect(t.request).toHaveBeenCalledWith("screen");
    await flush();
    stop();
    expect(t.sentinels[0].released).toBe(true);
    expect(t.listeners.size).toBe(0);
  });

  it("re-requests when the page comes back to the foreground", async () => {
    const t = host();
    const stop = holdScreenAwake(t.h);
    await flush();
    t.hide();
    t.show();
    await flush();
    expect(t.request).toHaveBeenCalledTimes(2);
    stop();
    expect(t.sentinels[1].released).toBe(true);
  });

  it("waits for the page to be shown before asking", async () => {
    const t = host({ visible: false });
    const stop = holdScreenAwake(t.h);
    expect(t.request).not.toHaveBeenCalled();
    t.show();
    expect(t.request).toHaveBeenCalledTimes(1);
    stop();
  });

  it("does nothing without the API, and survives a refusal", async () => {
    expect(() => holdScreenAwake(host({ api: false }).h)()).not.toThrow();
    const t = host({ reject: true });
    const stop = holdScreenAwake(t.h);
    await flush();
    expect(() => stop()).not.toThrow();
  });

  it("releases a lock that arrives after stop", async () => {
    const t = host();
    const stop = holdScreenAwake(t.h);
    stop();
    await flush();
    expect(t.sentinels[0].released).toBe(true);
  });
});
