/**
 * Editing a meeting must not quietly lose an attendee.
 *
 * The picker requires an address for anyone you ADD. Meetings saved before it
 * existed can hold bare names — the old free-text boxes accepted them, and
 * `normalizeAttendees` deliberately keeps an entry with a name and no address.
 * Requiring an address going forward is not a licence to erase those on the
 * next save, so this pins the seeding split the edit screen performs: everyone
 * survives, split into the ones the picker can represent and the ones it can't.
 */
import { normalizeAttendees, type MeetingAttendeeInput } from "./attendees";

/** Mirrors MeetingEditScreen's seeding split. */
function split(seeded: MeetingAttendeeInput[]) {
  const reachable = seeded
    .filter((a): a is MeetingAttendeeInput & { email: string } => Boolean(a.email?.trim()))
    .map((a) => ({
      name: a.name || a.email,
      email: a.email.trim().toLowerCase(),
      type: a.type === "internal" ? ("internal" as const) : ("external" as const),
    }));
  const unreachable = seeded.filter((a) => !a.email?.trim());
  return { reachable, unreachable, payload: [...reachable, ...unreachable] };
}

describe("seeding the edit screen from stored attendees", () => {
  it("keeps a bare-name attendee instead of dropping them", () => {
    const stored = normalizeAttendees([
      { name: "Jane Doe", type: "internal" },
      { name: "Ben", email: "ben@out.test", type: "external" },
    ])!;
    const { reachable, unreachable, payload } = split(stored);

    expect(reachable.map((a) => a.email)).toEqual(["ben@out.test"]);
    expect(unreachable.map((a) => a.name)).toEqual(["Jane Doe"]);
    // The save payload still carries everyone who was on the meeting.
    expect(payload).toHaveLength(2);
  });

  it("round-trips a whole meeting's attendees through a save unchanged", () => {
    const stored = normalizeAttendees([
      { name: "Jane Doe", type: "internal" },
      { name: "Ana", email: "ana@fund.test", type: "internal" },
      { name: "Ben", email: "ben@out.test", type: "external" },
    ])!;

    // Open, change nothing, save — then open the result and save again.
    const once = split(stored).payload;
    const twice = split(normalizeAttendees(once)!).payload;

    expect(twice).toHaveLength(3);
    expect(new Set(twice.map((a) => a.name))).toEqual(new Set(["Jane Doe", "Ana", "Ben"]));
    // Stable: a third pass is identical to the second, so repeated edits don't
    // slowly reshuffle or shed the list.
    expect(split(normalizeAttendees(twice)!).payload).toEqual(twice);
  });

  it("normalises the address on the way in without losing the display name", () => {
    const stored = normalizeAttendees([{ name: "Ana", email: "  Ana@Fund.TEST ", type: "internal" }])!;
    expect(split(stored).reachable[0]).toEqual({
      name: "Ana", email: "ana@fund.test", type: "internal",
    });
  });

  it("treats whitespace as no address, not as an address", () => {
    // normalizeAttendees drops a blank email itself; this pins that the split
    // agrees with it rather than producing a chip with an empty address.
    const stored: MeetingAttendeeInput[] = [{ name: "Spacey", email: "   ", type: "external" }];
    const { reachable, unreachable } = split(stored);
    expect(reachable).toEqual([]);
    expect(unreachable.map((a) => a.name)).toEqual(["Spacey"]);
  });
});
