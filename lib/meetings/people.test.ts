import {
  AVATAR_COLORS,
  avatarColorFor,
  initialsFor,
  inviteRowFor,
  isEmail,
  matchesQuery,
  rankSuggestions,
  toAttendee,
  type PersonSuggestion,
} from "./people";

const p = (over: Partial<PersonSuggestion> & { email: string }): PersonSuggestion => ({
  name: "",
  source: "member",
  ...over,
});

describe("isEmail", () => {
  it("accepts an ordinary address", () => {
    expect(isEmail("jane@fund.test")).toBe(true);
    expect(isEmail("  Jane@Fund.Test  ")).toBe(true);
  });

  it("rejects a bare name, which is the whole point of the picker", () => {
    expect(isEmail("Jane Doe")).toBe(false);
    expect(isEmail("jane@fund")).toBe(false);
    expect(isEmail("jane at fund.test")).toBe(false);
    expect(isEmail("")).toBe(false);
  });

  it("rejects the angle-bracket form, which is not itself an address", () => {
    expect(isEmail("Jane <jane@fund.test>")).toBe(false);
  });
});

describe("initialsFor", () => {
  it("takes the first and last word, not the first two", () => {
    expect(initialsFor({ name: "Mary-Jane van der Berg", email: "m@f.test" })).toBe("MB");
    expect(initialsFor({ name: "John Doe", email: "j@f.test" })).toBe("JD");
  });

  it("uses two letters of a single name", () => {
    expect(initialsFor({ name: "Prince", email: "p@f.test" })).toBe("PR");
  });

  it("falls back to the address, so unnamed guests stay distinguishable", () => {
    expect(initialsFor({ name: "", email: "ana@fund.test" })).toBe("AN");
    expect(initialsFor({ name: null, email: "bob@fund.test" })).toBe("BO");
  });

  it("does not render an address as if it were a name", () => {
    // A contact whose name field holds their address should still read "AN",
    // never "A@" — the local part is the human-readable half.
    expect(initialsFor({ name: "ana@fund.test", email: "ana@fund.test" })).toBe("AN");
  });
});

describe("avatarColorFor", () => {
  it("is stable for the same person", () => {
    expect(avatarColorFor("jane@fund.test")).toBe(avatarColorFor("jane@fund.test"));
  });

  it("ignores case and padding, so one person is never two colours", () => {
    expect(avatarColorFor("  JANE@Fund.test ")).toBe(avatarColorFor("jane@fund.test"));
  });

  it("always returns a colour from the declared palette", () => {
    for (const email of ["a@x.test", "b@x.test", "zzz@y.test", ""]) {
      expect(AVATAR_COLORS).toContain(avatarColorFor(email));
    }
  });

  it("separates adjacent addresses rather than bunching them", () => {
    // The reason for a real hash instead of summing char codes: a1..a8 landing
    // on one colour would make a team of eight indistinguishable.
    const colors = new Set(["a1", "a2", "a3", "a4", "a5", "a6"].map((l) => avatarColorFor(`${l}@f.test`)));
    expect(colors.size).toBeGreaterThan(2);
  });
});

describe("matchesQuery", () => {
  const jane = p({ email: "jane.doe@fund.test", name: "Jane Doe", subtitle: "Partner" });

  it("matches on a name prefix, per word", () => {
    expect(matchesQuery(jane, "ja")).toBe(true);
    expect(matchesQuery(jane, "doe")).toBe(true);
    expect(matchesQuery(jane, "ja do")).toBe(true);
  });

  it("does not match a word from the middle of a name", () => {
    expect(matchesQuery(jane, "ane")).toBe(false);
  });

  it("matches anywhere in the address, including the domain", () => {
    expect(matchesQuery(jane, "fund.test")).toBe(true);
    expect(matchesQuery(jane, "doe@")).toBe(true);
  });

  it("matches the subtitle, so you can find someone by their title", () => {
    expect(matchesQuery(jane, "part")).toBe(true);
  });

  it("requires every term to match, not just one", () => {
    expect(matchesQuery(jane, "jane zzz")).toBe(false);
  });

  it("treats an empty query as matching everything", () => {
    expect(matchesQuery(jane, "   ")).toBe(true);
  });
});

describe("rankSuggestions", () => {
  const member = p({ email: "a@fund.test", name: "Ana Member", source: "member" });
  const contact = p({ email: "b@out.test", name: "Ben Contact", source: "contact" });
  const past = p({ email: "c@old.test", name: "Cal Past", source: "past" });

  it("orders teammates, then contacts, then past attendees", () => {
    expect(rankSuggestions([past, contact, member], "").map((x) => x.email)).toEqual([
      "a@fund.test", "b@out.test", "c@old.test",
    ]);
  });

  it("keeps the best-ranked copy of someone who appears in two directories", () => {
    const dupPast = p({ email: "a@fund.test", name: "A", source: "past" });
    const out = rankSuggestions([dupPast, member], "");
    expect(out).toHaveLength(1);
    expect(out[0]).toMatchObject({ source: "member", name: "Ana Member" });
  });

  it("dedupes regardless of which order the directories arrive in", () => {
    const dupPast = p({ email: "a@fund.test", name: "A", source: "past" });
    expect(rankSuggestions([member, dupPast], "")[0].source).toBe("member");
  });

  it("drops people already added — offering them does nothing", () => {
    expect(rankSuggestions([member, contact], "", ["a@fund.test"]).map((x) => x.email))
      .toEqual(["b@out.test"]);
  });

  it("ignores case and padding when excluding those already added", () => {
    expect(rankSuggestions([member], "", ["  A@FUND.test "])).toEqual([]);
  });

  it("puts a name that starts with the query above one that merely contains it", () => {
    const jane = p({ email: "j@f.test", name: "Jane Smith" });
    const rajan = p({ email: "r@f.test", name: "Rajan Ja" });
    expect(rankSuggestions([rajan, jane], "ja")[0].name).toBe("Jane Smith");
  });

  it("normalises the address on the way out", () => {
    expect(rankSuggestions([p({ email: "  MiXeD@F.test " })], "")[0].email).toBe("mixed@f.test");
  });

  it("skips rows with no address at all", () => {
    expect(rankSuggestions([p({ email: "   " })], "")).toEqual([]);
  });

  it("honours the limit", () => {
    const many = Array.from({ length: 20 }, (_, i) => p({ email: `p${i}@f.test`, name: `P${i}` }));
    expect(rankSuggestions(many, "", [], 5)).toHaveLength(5);
  });
});

describe("inviteRowFor", () => {
  it("offers an address nobody in the directories has", () => {
    expect(inviteRowFor("new@guest.test")).toMatchObject({ email: "new@guest.test", source: "contact" });
  });

  it("refuses a bare name — an attendee with no address is one nobody invites", () => {
    expect(inviteRowFor("Jane Doe")).toBeNull();
    expect(inviteRowFor("")).toBeNull();
  });

  it("does not offer an address that is already added", () => {
    expect(inviteRowFor("dup@guest.test", ["dup@guest.test"])).toBeNull();
    expect(inviteRowFor("dup@guest.test", ["  DUP@Guest.test "])).toBeNull();
  });

  it("lower-cases what it hands back", () => {
    expect(inviteRowFor("  NEW@Guest.Test ")?.email).toBe("new@guest.test");
  });
});

describe("toAttendee", () => {
  it("marks a teammate internal and everyone else external", () => {
    expect(toAttendee(p({ email: "a@f.test", name: "A", source: "member" })).type).toBe("internal");
    expect(toAttendee(p({ email: "b@f.test", name: "B", source: "contact" })).type).toBe("external");
    expect(toAttendee(p({ email: "c@f.test", name: "C", source: "past" })).type).toBe("external");
  });

  it("falls back to the address when a contact has no name", () => {
    expect(toAttendee(p({ email: "x@f.test" }))).toEqual({
      name: "x@f.test", email: "x@f.test", type: "internal",
    });
  });
});
