// Keep the screen on for the length of a call.
//
// Nothing else in a call does. Remote video plays in muted <video> tiles and
// voices through <audio> elements, neither of which counts as "playing media"
// for the idle timer, so a phone that is not being touched — which is every
// phone propped against a laptop for a meeting — dims and locks a few minutes
// in. On iOS that backgrounds Safari, which mutes the camera and stops the
// timers the call runs on. The Screen Wake Lock API (Safari 16.4+, Chromium
// everywhere) is the one lever, and the browser releases it on its own every
// time the tab leaves the foreground, so it has to be taken again on return.
//
// Written over a small host interface rather than `navigator` and `document`
// directly so it can be exercised without a browser.

export interface WakeLockSentinelLike {
  release(): Promise<void>;
}

export interface WakeLockHost {
  navigator: { wakeLock?: { request(type: "screen"): Promise<WakeLockSentinelLike> } };
  document: {
    visibilityState: string;
    addEventListener(type: "visibilitychange", fn: () => void): void;
    removeEventListener(type: "visibilitychange", fn: () => void): void;
  };
}

/**
 * Hold a screen wake lock until the returned function is called.
 *
 * Best-effort throughout: a browser without the API, or one that refuses
 * (low power mode, a hidden tab) is left alone, and the lock is simply asked
 * for again the next time the page is shown.
 */
export function holdScreenAwake(host: WakeLockHost): () => void {
  const api = host.navigator.wakeLock;
  if (!api || typeof api.request !== "function") return () => {};

  let sentinel: WakeLockSentinelLike | null = null;
  let stopped = false;
  let requesting = false;

  const acquire = () => {
    if (stopped || requesting || host.document.visibilityState !== "visible") return;
    requesting = true;
    let request: Promise<WakeLockSentinelLike>;
    try {
      request = api.request("screen");
    } catch {
      requesting = false;
      return;
    }
    request.then(
      (s) => {
        requesting = false;
        // Stopped while the request was in flight: let go of what just arrived.
        if (stopped) { void s.release().catch(() => {}); return; }
        sentinel = s;
      },
      () => { requesting = false; },
    );
  };

  const onVisibility = () => {
    // The browser released the lock when the page was hidden; the sentinel we
    // hold is spent. Ask again now that the page is back.
    if (host.document.visibilityState === "visible") { sentinel = null; acquire(); }
  };

  host.document.addEventListener("visibilitychange", onVisibility);
  acquire();

  return () => {
    stopped = true;
    host.document.removeEventListener("visibilitychange", onVisibility);
    const s = sentinel;
    sentinel = null;
    if (s) void s.release().catch(() => {});
  };
}
