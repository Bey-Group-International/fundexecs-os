import {
  attendeesFromPeople,
  cleanCallPeople,
  cleanCallTags,
  facetsOf,
  isUuid,
  passesFacets,
  peopleFromAttendees,
  withTag,
  MAX_TAGS,
  NO_FACETS,
} from "./call-organise";

describe("cleaning", () => {
  it("tags: trims, drops #, dedupes without case, caps", () => {
    expect(cleanCallTags("#LP, diligence ,lp,, Q3  review")).toEqual(["LP", "diligence", "Q3 review"]);
    expect(cleanCallTags(Array.from({ length: 12 }, (_, i) => `t${i}`))).toHaveLength(MAX_TAGS);
    expect(cleanCallTags(42)).toEqual([]);
    expect(cleanCallTags(["x".repeat(50)])[0]).toHaveLength(32);
  });

  it("people: from text or a list", () => {
    expect(cleanCallPeople("Ana Ruiz; Bo\nana ruiz")).toEqual(["Ana Ruiz", "Bo"]);
    expect(peopleFromAttendees([{ name: "Ana" }, { email: "bo@x.test" }, "Cy", null, 3])).toEqual(["Ana", "bo@x.test", "Cy"]);
    expect(attendeesFromPeople(["Ana"])).toEqual([{ name: "Ana", type: "external" }]);
  });

  it("knows a uuid", () => {
    expect(isUuid("6f1d1c9e-2b1a-4c3d-9e8f-0a1b2c3d4e5f")).toBe(true);
    expect(isUuid("nope")).toBe(false);
  });
});

describe("facets and filters", () => {
  const calls = [
    { tags: ["LP", "Q3"], people: ["Ana"], dealId: "d1", dealName: "Acme" },
    { tags: ["lp"], people: ["Bo", "Ana"], dealId: null },
    { tags: [], people: [], dealId: "d1", dealName: "Acme" },
  ];

  it("counts what is used, most first", () => {
    const f = facetsOf(calls);
    expect(f.tags).toEqual([
      { value: "lp", label: "LP", count: 2 },
      { value: "q3", label: "Q3", count: 1 },
    ]);
    expect(f.people[0]).toEqual({ value: "ana", label: "Ana", count: 2 });
    expect(f.deals).toEqual([{ value: "d1", label: "Acme", count: 2 }]);
  });

  it("filters by tag, person and deal together", () => {
    expect(calls.filter((c) => passesFacets(c, { ...NO_FACETS, tag: "lp" }))).toHaveLength(2);
    expect(calls.filter((c) => passesFacets(c, { tag: "lp", person: "bo", dealId: null }))).toHaveLength(1);
    expect(calls.filter((c) => passesFacets(c, { ...NO_FACETS, dealId: "d1" }))).toHaveLength(2);
  });

  it("adds a tag without duplicating it", () => {
    expect(withTag(["LP"], "lp")).toEqual(["LP"]);
    expect(withTag(undefined, "Board")).toEqual(["Board"]);
  });
});
