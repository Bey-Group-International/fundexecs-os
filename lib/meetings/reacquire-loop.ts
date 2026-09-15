// lib/meetings/reacquire-loop.ts
// The loop that goes back for a device, and everything that can interrupt it.
//
// device-reacquire.ts decides WHETHER a failure is worth another attempt and
// HOW LONG to wait. This is what waits — and, more importantly, what notices
// when waiting has been made pointless because the world already changed.
//
// Three things can prompt an attempt, and only one of them is the timer:
//
//   - The backoff, for a device something else is holding. Nothing will
//     announce that Zoom has quit; asking is the only way to find out.
//   - `devicechange`, for a device that was not there. A webcam plugged in at
//     second three should not wait out an interval chosen on the assumption
//     that nothing had happened.
//   - A permission flipping to granted, for a device the browser refused.
//     Polling that one can never succeed — a browser that has been told no
//     rejects the next call outright rather than re-prompting — so this event
//     is not an optimisation, it is the entire mechanism.
//
// Everything here is best-effort and nothing is load-bearing: the member still
// has a device picker and a button to start their camera. It runs in a browser
// rather than being injected, for the same reason the admission session does —
// a test that mocks away `navigator` is testing something other than what
// ships — so every access is guarded and every failure is silent.

import { reacquireDelay, type ReacquireWatch, shouldTryNow } from "./device-reacquire";

export interface ReacquireLoopOptions {
  /** What device-reacquire said to do about this failure. */
  watch: ReacquireWatch;
  /**
   * The permission to watch, when the browser can report it.
   *
   * Firefox does not accept these names and throws rather than resolving, and
   * Safari's support has come and gone by version, so this is attempted and
   * abandoned rather than relied on.
   */
  permissionName?: "camera" | "microphone";
  /** Try once. Resolve true when the device is back; never throw. */
  attempt: () => Promise<boolean>;
  /** The device came back. The loop has already stopped. */
  onRecovered?: () => void;
  /** The loop stopped without recovering it. Copy only — nothing is broken. */
  onGaveUp?: () => void;
}

/**
 * Start going back for a device. Returns a stop, which is idempotent.
 *
 * Attempts never overlap: a `getUserMedia` that is already in flight is the
 * same question this would be asking, and firing a second one because a
 * `devicechange` landed mid-attempt is how a member ends up with two cameras
 * open and one of them orphaned.
 */
export function startReacquire(opts: ReacquireLoopOptions): () => void {
  let stopped = false;
  let attempts = 0;
  let inFlight = false;
  const startedAt = Date.now();
  let timer: ReturnType<typeof setTimeout> | null = null;
  let detach: Array<() => void> = [];

  function stop(): void {
    if (stopped) return;
    stopped = true;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    for (const off of detach) { try { off(); } catch { /* listener already gone */ } }
    detach = [];
  }

  async function tryOnce(): Promise<void> {
    // Not stopped, and not already asking. The guard matters most on the event
    // paths, which can fire in bursts — a dock reconnecting emits several
    // devicechange events in a row.
    if (stopped || inFlight) return;
    inFlight = true;
    let recovered = false;
    try {
      recovered = await opts.attempt();
    } catch {
      recovered = false; // A failed attempt is not news; the schedule handles it.
    } finally {
      inFlight = false;
    }
    if (stopped) return;
    if (recovered) { stop(); opts.onRecovered?.(); return; }
    attempts += 1;
    schedule();
  }

  function schedule(): void {
    if (stopped) return;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    // A permission watch has no schedule of its own: there is nothing to poll
    // for, and the browser will say when the answer changed.
    if (opts.watch === "permission") return;
    const delay = reacquireDelay(attempts, Date.now() - startedAt);
    if (delay === null) { stop(); opts.onGaveUp?.(); return; }
    timer = setTimeout(() => { timer = null; void tryOnce(); }, delay);
  }

  /** An event says the answer may have changed. Ask now rather than on the timer. */
  function onEvent(event: "devicechange" | "permissionchange"): void {
    if (stopped || !shouldTryNow(opts.watch, event)) return;
    // The backoff restarts from the front: something concrete changed, and the
    // long interval it had reached was chosen on the opposite assumption.
    attempts = 0;
    if (timer !== null) { clearTimeout(timer); timer = null; }
    void tryOnce();
  }

  if (opts.watch === "never") return stop;

  const md = typeof navigator !== "undefined" ? navigator.mediaDevices : undefined;
  if (md?.addEventListener) {
    const handler = () => onEvent("devicechange");
    md.addEventListener("devicechange", handler);
    detach.push(() => md.removeEventListener("devicechange", handler));
  }

  // Attempted, not awaited: the loop must be running before this resolves, and
  // a browser that rejects the query simply does not get this trigger.
  if (opts.permissionName && typeof navigator !== "undefined") {
    const permissions = (navigator as Navigator & {
      permissions?: { query: (d: { name: string }) => Promise<EventTarget & { state?: string }> };
    }).permissions;
    if (permissions?.query) {
      void permissions
        .query({ name: opts.permissionName })
        .then((status) => {
          if (stopped) return;
          const handler = () => {
            // Only a grant is news. A permission moving to denied or prompt
            // means the next attempt would fail, so firing one would be work
            // spent to confirm what we already know.
            if (status.state === "granted") onEvent("permissionchange");
          };
          status.addEventListener("change", handler);
          detach.push(() => status.removeEventListener("change", handler));
        })
        .catch(() => { /* the browser does not report this one */ });
    }
  }

  schedule();
  return stop;
}
