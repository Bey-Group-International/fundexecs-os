// Guards the fix for the "cannot add postgres_changes callbacks ... after
// subscribe()" crash: two useLivePresence consumers on the same page (the
// calendar grid + the Upcoming list) must not share a realtime channel name.
import { nextPresenceChannelName, nextChannelName } from "./hooks";

describe("nextPresenceChannelName", () => {
  it("returns a distinct channel name on every call", () => {
    const a = nextPresenceChannelName();
    const b = nextPresenceChannelName();
    const c = nextPresenceChannelName();
    expect(new Set([a, b, c]).size).toBe(3);
  });

  it("uses the meetings-presence prefix", () => {
    expect(nextPresenceChannelName()).toMatch(/^meetings-presence-\d+$/);
  });
});

// The same list can be mounted twice at once (Upcoming on the landing AND inside
// the calendar overlay's rail), so each mount needs its own channel name.
describe("nextChannelName", () => {
  it("returns a distinct name for the given prefix on every call", () => {
    const a = nextChannelName("upcoming-meetings");
    const b = nextChannelName("upcoming-meetings");
    expect(a).not.toBe(b);
    expect(a).toMatch(/^upcoming-meetings-\d+$/);
    expect(b).toMatch(/^upcoming-meetings-\d+$/);
  });
});

// ── useNow ─────────────────────────────────────────────────────────────────
//
// It ticked unconditionally for the life of the tab: a render of every Upcoming
// card, and of the whole calendar grid once that overlay has been opened, once a
// second, forever — including the hours a background tab spends showing nobody
// anything. Browsers throttle background timers; they do not stop them.

import { act, render } from "@testing-library/react";
import { useNow } from "./hooks";

function Clock({ onRender }: { onRender: (now: number) => void }) {
  const now = useNow(1000);
  onRender(now);
  return null;
}

function setVisibility(state: "visible" | "hidden") {
  Object.defineProperty(document, "visibilityState", { value: state, configurable: true });
  document.dispatchEvent(new Event("visibilitychange"));
}

describe("useNow", () => {
  beforeEach(() => {
    jest.useFakeTimers();
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
  });

  afterEach(() => {
    jest.useRealTimers();
  });

  it("ticks while the tab is visible", () => {
    const renders: number[] = [];
    render(<Clock onRender={(n) => renders.push(n)} />);
    const before = renders.length;
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(renders.length).toBeGreaterThan(before);
  });

  it("stops ticking once the tab is hidden", () => {
    const renders: number[] = [];
    render(<Clock onRender={(n) => renders.push(n)} />);
    act(() => setVisibility("hidden"));
    const afterHide = renders.length;
    act(() => {
      jest.advanceTimersByTime(30_000);
    });
    expect(renders.length).toBe(afterHide);
  });

  // A countdown nobody can see does not need to be right; it needs to be right
  // the moment they look. Reading the clock on the way back is what does that —
  // otherwise the first thing on screen is the countdown they walked away from.
  it("reads the clock on the way back, before the next tick", () => {
    const renders: number[] = [];
    render(<Clock onRender={(n) => renders.push(n)} />);
    act(() => setVisibility("hidden"));

    act(() => {
      jest.advanceTimersByTime(60_000);
    });

    // Asserted across the visibility event itself, not on the value afterwards:
    // a clock that never stopped is already up to date by now, so only the jump
    // AT the moment of return distinguishes one that slept and caught up.
    const beforeReturn = renders[renders.length - 1];
    act(() => setVisibility("visible"));
    const afterReturn = renders[renders.length - 1];

    expect(afterReturn - beforeReturn).toBeGreaterThanOrEqual(59_000);
  });

  it("resumes ticking after coming back", () => {
    const renders: number[] = [];
    render(<Clock onRender={(n) => renders.push(n)} />);
    act(() => setVisibility("hidden"));
    act(() => setVisibility("visible"));
    const afterReturn = renders.length;
    act(() => {
      jest.advanceTimersByTime(3000);
    });
    expect(renders.length).toBeGreaterThan(afterReturn);
  });

  it("leaves no timer or listener behind on unmount", () => {
    const renders: number[] = [];
    const { unmount } = render(<Clock onRender={(n) => renders.push(n)} />);
    unmount();
    const afterUnmount = renders.length;
    act(() => {
      jest.advanceTimersByTime(10_000);
      setVisibility("hidden");
      setVisibility("visible");
    });
    expect(renders.length).toBe(afterUnmount);
  });
});
