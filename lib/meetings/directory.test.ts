import { needsDirectory, resolveAttendeeDirectory, matchDirectoryPerson } from "./directory";

const DIRECTORY = [
  { name: "Mike Ross", email: "Mike.Ross@fund.test" },
  { name: "Rae Chen", email: "rae@fund.test" },
  { name: "Dana Scott", email: "dscott@fund.test" },
];

describe("needsDirectory", () => {
  it("is true only when a named attendee has no address", () => {
    expect(needsDirectory([{ name: "Mike Ross", type: "internal" }])).toBe(true);
    expect(needsDirectory([{ name: "Mike", email: "m@x.test" }])).toBe(false);
    expect(needsDirectory([{ name: "  ", type: "internal" }])).toBe(false);
    expect(needsDirectory(null)).toBe(false);
    expect(needsDirectory([])).toBe(false);
  });
});

describe("resolveAttendeeDirectory", () => {
  it("fills in a teammate's address from their full name", () => {
    const out = resolveAttendeeDirectory([{ name: "mike ross", type: "internal" }], DIRECTORY);
    expect(out.attendees[0].email).toBe("mike.ross@fund.test");
    expect(out.resolved).toBe(1);
    expect(out.unreachable).toEqual([]);
  });

  it("matches the local part of an address, and the address itself", () => {
    const out = resolveAttendeeDirectory(
      [
        { name: "dscott", type: "internal" },
        { name: "RAE@fund.test", type: "external" },
      ],
      DIRECTORY,
    );
    expect(out.attendees.map((a) => a.email)).toEqual(["dscott@fund.test", "rae@fund.test"]);
    expect(out.resolved).toBe(2);
  });

  it("matches a first name only for an internal attendee", () => {
    const internal = resolveAttendeeDirectory([{ name: "Mike", type: "internal" }], DIRECTORY);
    expect(internal.attendees[0].email).toBe("mike.ross@fund.test");

    // "Mike" in the guest box is an outsider the host has yet to give an
    // address for, not a licence to email the Mike on the team.
    const external = resolveAttendeeDirectory([{ name: "Mike", type: "external" }], DIRECTORY);
    expect(external.attendees[0].email).toBeUndefined();
    expect(external.unreachable).toEqual(["Mike"]);
  });

  it("refuses an ambiguous name rather than guessing between two people", () => {
    const out = resolveAttendeeDirectory([{ name: "Mike Ross", type: "internal" }], [
      { name: "Mike Ross", email: "mike.ross@fund.test" },
      { name: "mike ross", email: "mross@fund.test" },
    ]);
    expect(out.attendees[0].email).toBeUndefined();
    expect(out.resolved).toBe(0);
    expect(out.unreachable).toEqual(["Mike Ross"]);
  });

  it("never displaces an address the host typed", () => {
    const out = resolveAttendeeDirectory(
      [{ name: "Mike Ross", email: "mike@other.test", type: "internal" }],
      DIRECTORY,
    );
    expect(out.attendees[0].email).toBe("mike@other.test");
    expect(out.resolved).toBe(0);
  });

  it("reports who is left when there is no directory at all", () => {
    const out = resolveAttendeeDirectory([{ name: "Mike Ross", type: "internal" }, { name: "Rae Chen" }], []);
    expect(out.resolved).toBe(0);
    expect(out.unreachable).toEqual(["Mike Ross", "Rae Chen"]);
  });

  it("ignores directory rows with no address", () => {
    const out = resolveAttendeeDirectory([{ name: "Ghost", type: "internal" }], [{ name: "Ghost", email: "  " }]);
    expect(out.attendees[0].email).toBeUndefined();
    expect(out.unreachable).toEqual(["Ghost"]);
  });

  it("keeps order and passes an empty list through", () => {
    expect(resolveAttendeeDirectory([], DIRECTORY)).toEqual({ attendees: [], resolved: 0, unreachable: [] });
    const out = resolveAttendeeDirectory(
      [{ name: "Rae Chen", type: "internal" }, { name: "Ada", email: "ada@lp.test", type: "external" }],
      DIRECTORY,
    );
    expect(out.attendees.map((a) => a.name)).toEqual(["Rae Chen", "Ada"]);
  });
});

describe("matchDirectoryPerson", () => {
  const SARAH = { id: "p1", name: "Sarah Chen", email: "sarah@fund.test" };
  const MIKE = { id: "p2", name: "Mike Alvarez", email: "mike@fund.test" };
  const OTHER_SARAH = { id: "p3", name: "Sarah Okonkwo", email: "sokonkwo@fund.test" };

  it("finds a member by first name", () => {
    expect(matchDirectoryPerson("Sarah", [SARAH, MIKE])?.id).toBe("p1");
  });

  it("finds a member by full name", () => {
    expect(matchDirectoryPerson("Sarah Chen", [SARAH, MIKE, OTHER_SARAH])?.id).toBe("p1");
  });

  it("finds a member by address", () => {
    expect(matchDirectoryPerson("mike@fund.test", [SARAH, MIKE])?.id).toBe("p2");
  });

  // The whole reason this is unique-or-nothing: a task on the wrong
  // colleague's list is worse than one that stayed with the host.
  it("refuses a first name two members answer to", () => {
    expect(matchDirectoryPerson("Sarah", [SARAH, OTHER_SARAH])).toBeUndefined();
  });

  it("does not fall through to a looser form when an exact one is ambiguous", () => {
    // Two people whose full names fold to the same key must not then be
    // separated by a first-name pass that happens to find one of them.
    const a = { id: "p1", name: "Sam Lee", email: "sam.lee@fund.test" };
    const b = { id: "p2", name: "Sam Lee", email: "slee@fund.test" };
    expect(matchDirectoryPerson("Sam Lee", [a, b])).toBeUndefined();
  });

  it("returns nothing for a name nobody has", () => {
    expect(matchDirectoryPerson("Priya", [SARAH, MIKE])).toBeUndefined();
  });

  it("returns nothing for empty input or an empty directory", () => {
    expect(matchDirectoryPerson("", [SARAH])).toBeUndefined();
    expect(matchDirectoryPerson("Sarah", [])).toBeUndefined();
  });

  it("ignores case and punctuation the way the invite path does", () => {
    expect(matchDirectoryPerson("sarah chen", [SARAH])?.id).toBe("p1");
    expect(matchDirectoryPerson("SARAH", [SARAH])?.id).toBe("p1");
  });
});
