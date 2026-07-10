// Guards the fix for the "cannot add postgres_changes callbacks ... after
// subscribe()" crash: two useLivePresence consumers on the same page (the
// calendar grid + the Upcoming list) must not share a realtime channel name.
import { nextPresenceChannelName } from "./hooks";

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
