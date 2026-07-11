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
