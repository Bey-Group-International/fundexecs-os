import {
  isRemoved,
  parseSubject,
  removedAmong,
  sameSubject,
  subjectColumns,
  subjectFor,
  subjectKey,
  subjectOfRow,
  type RemovalSubject,
} from "@/lib/meetings/removal";

const member = (userId: string): RemovalSubject => ({ kind: "member", userId });
const guest = (guestKey: string): RemovalSubject => ({ kind: "guest", guestKey });

describe("subjectFor", () => {
  // The account is the one they cannot throw away, and the one the knock
  // route's membership check reads — so a teammate is keyed on it even though
  // they carry a guest key as well.
  it("prefers the account when there is one", () => {
    expect(subjectFor("u1", "g1")).toEqual(member("u1"));
  });

  it("falls back to the guest key", () => {
    expect(subjectFor(null, "g1")).toEqual(guest("g1"));
  });

  it("is nobody when there is neither", () => {
    expect(subjectFor(null, null)).toBeNull();
    expect(subjectFor("", "  ")).toBeNull();
  });

  it("trims, so a padded value is not a different person", () => {
    expect(subjectFor(" u1 ", null)).toEqual(member("u1"));
  });
});

describe("subjectKey", () => {
  // Guest keys are crypto.randomUUID() today, which is exactly the shape of an
  // account id. Without the prefix the two spaces would share values.
  it("keeps members and guests in separate spaces", () => {
    const id = "9f1c2b3e-0000-4000-8000-000000000000";
    expect(subjectKey(member(id))).not.toBe(subjectKey(guest(id)));
  });
});

describe("sameSubject", () => {
  it("matches the same person", () => {
    expect(sameSubject(member("u1"), member("u1"))).toBe(true);
    expect(sameSubject(guest("g1"), guest("g1"))).toBe(true);
  });

  it("does not match across kinds", () => {
    expect(sameSubject(member("x"), guest("x"))).toBe(false);
  });

  // Two people the room could not identify are not the same person.
  it("never matches nobody to nobody", () => {
    expect(sameSubject(null, null)).toBe(false);
    expect(sameSubject(member("u1"), null)).toBe(false);
  });
});

describe("subjectOfRow", () => {
  it("reads either column", () => {
    expect(subjectOfRow({ user_id: "u1", guest_key: null })).toEqual(member("u1"));
    expect(subjectOfRow({ user_id: null, guest_key: "g1" })).toEqual(guest("g1"));
  });

  it("is nobody for a row that names neither", () => {
    expect(subjectOfRow({ user_id: null, guest_key: null })).toBeNull();
    expect(subjectOfRow(null)).toBeNull();
  });
});

describe("isRemoved", () => {
  const removals = [
    { user_id: "u1", guest_key: null },
    { user_id: null, guest_key: "g9" },
  ];

  it("finds a removed member and a removed guest", () => {
    expect(isRemoved(removals, member("u1"))).toBe(true);
    expect(isRemoved(removals, guest("g9"))).toBe(true);
  });

  it("leaves everyone else alone", () => {
    expect(isRemoved(removals, member("u2"))).toBe(false);
    expect(isRemoved(removals, guest("g1"))).toBe(false);
  });

  // The whole point of keying a teammate on their account: a removed member
  // who clears site data arrives with a brand new guest key.
  it("still catches a removed member who minted a fresh guest key", () => {
    expect(isRemoved(removals, subjectFor("u1", "brand-new-key"))).toBe(true);
  });

  it("is false when there is nothing to compare", () => {
    expect(isRemoved([], member("u1"))).toBe(false);
    expect(isRemoved(removals, null)).toBe(false);
    expect(isRemoved(null, member("u1"))).toBe(false);
  });

  // A row with neither column set would otherwise match a caller the room
  // could not identify, and eject them.
  it("does not let an empty row remove an unidentified caller", () => {
    expect(isRemoved([{ user_id: null, guest_key: null }], null)).toBe(false);
  });
});

describe("removedAmong", () => {
  const removals = [{ user_id: null, guest_key: "g9" }, { user_id: "u1", guest_key: null }];

  it("answers only about the subjects it was asked about", () => {
    expect(removedAmong(removals, [guest("g1"), guest("g9"), member("u2")])).toEqual([guest("g9")]);
  });

  // It cannot be used to enumerate a meeting's guest keys — which would be
  // enough to read another guest's admission status from the poll endpoint.
  it("never returns a subject the caller did not name", () => {
    expect(removedAmong(removals, [])).toEqual([]);
    expect(removedAmong(removals, [member("u3")])).toEqual([]);
  });

  it("is empty when nobody has been removed", () => {
    expect(removedAmong([], [guest("g9")])).toEqual([]);
  });
});

describe("parseSubject", () => {
  it("reads both kinds off the wire", () => {
    expect(parseSubject({ kind: "member", userId: "u1" })).toEqual(member("u1"));
    expect(parseSubject({ kind: "guest", guestKey: "g1" })).toEqual(guest("g1"));
  });

  // Every field checked rather than trusted: this parses a request body and a
  // peer's announcement about itself.
  it.each([
    null,
    "member:u1",
    42,
    {},
    { kind: "member" },
    { kind: "guest", guestKey: 7 },
    { kind: "admin", userId: "u1" },
    { kind: "member", userId: "   " },
  ])("refuses %j", (value) => {
    expect(parseSubject(value)).toBeNull();
  });

  // A body naming both must not become a member removal by accident of field
  // order — `kind` decides, and nothing else.
  it("takes the kind it was told, not the fields it was given", () => {
    expect(parseSubject({ kind: "guest", guestKey: "g1", userId: "u1" })).toEqual(guest("g1"));
  });
});

describe("subjectColumns", () => {
  // One place, so the route writing a removal and the query reading it back
  // cannot disagree about which column holds what.
  it("writes exactly one column", () => {
    expect(subjectColumns(member("u1"))).toEqual({ user_id: "u1", guest_key: null });
    expect(subjectColumns(guest("g1"))).toEqual({ user_id: null, guest_key: "g1" });
  });

  it("round-trips through the row reader", () => {
    for (const subject of [member("u1"), guest("g1")]) {
      expect(subjectOfRow(subjectColumns(subject))).toEqual(subject);
    }
  });
});
