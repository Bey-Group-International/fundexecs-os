import { conflictMessage } from "./schedule";

describe("conflictMessage", () => {
  it("names a meeting clash when only meetings overlap", () => {
    expect(conflictMessage(1, 0)).toBe("That time conflicts with another meeting.");
  });

  it("speaks about blocked time when only a block overlaps", () => {
    // Blocked time is the host's own note, so it must not read as a clash
    // with someone else's commitment.
    expect(conflictMessage(0, 2)).toMatch(/blocked off/);
  });

  it("mentions both when both apply", () => {
    const msg = conflictMessage(1, 1);
    expect(msg).toMatch(/another meeting/);
    expect(msg).toMatch(/blocked/);
  });

  it("still says something usable when no count is set", () => {
    expect(conflictMessage(0, 0)).toBe("That time is unavailable.");
  });

  // A commitment kept in Google Calendar is as real as one kept in here, and
  // saying only "that time is unavailable" leaves the host with nowhere to look.
  it("names the connected calendar when that is what clashes", () => {
    expect(conflictMessage(0, 0, 1)).toBe("That time conflicts with an event on your connected calendar.");
  });

  it("names every kind that applies rather than picking one", () => {
    const msg = conflictMessage(1, 1, 1);
    expect(msg).toMatch(/another meeting/);
    expect(msg).toMatch(/connected calendar/);
    expect(msg).toMatch(/blocked/);
  });
});
