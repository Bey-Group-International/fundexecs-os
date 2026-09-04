import { formatAttendeeInput, parseAttendeeInput, normalizeAttendees } from "./attendees";

describe("meeting attendee input", () => {
  it("parses raw email addresses into external attendee records", () => {
    expect(parseAttendeeInput("alice@example.com")).toEqual([
      { name: "Alice", email: "alice@example.com", type: "external" },
    ]);
  });

  it("parses Name <email> entries and de-duplicates", () => {
    expect(parseAttendeeInput("Alice A. <alice@example.com>, alice@example.com")).toEqual([
      { name: "Alice A.", email: "alice@example.com", type: "external" },
    ]);
  });

  it("supports comma, semicolon, and newline separators", () => {
    expect(parseAttendeeInput("Alice <a@example.com>; bob@example.com\nCarol")).toEqual([
      { name: "Alice", email: "a@example.com", type: "external" },
      { name: "Bob", email: "bob@example.com", type: "external" },
      { name: "Carol", type: "external" },
    ]);
  });

  it("formats attendees back into a simple editable string", () => {
    expect(formatAttendeeInput([
      { name: "Alice", email: "alice@example.com", type: "external" },
      { name: "Carol", type: "external" },
    ])).toBe("Alice <alice@example.com>, Carol");
  });
});

describe("normalizeAttendees", () => {
  it("accepts a well-formed list and keeps the addresses", () => {
    expect(
      normalizeAttendees([
        { name: "Ada", email: "Ada@LP.test", type: "external" },
        { name: "Mike Ross", type: "internal" },
      ]),
    ).toEqual([
      { name: "Ada", email: "ada@lp.test", type: "external" },
      { name: "Mike Ross", type: "internal" },
    ]);
  });

  it("keeps an attendee who has no address", () => {
    // Normal, and the whole reason the directory step exists.
    expect(normalizeAttendees([{ name: "Mike Ross", type: "internal" }])?.[0].email).toBeUndefined();
  });

  it("refuses a list carrying anything that is not an attendee", () => {
    // These used to be cast straight to MeetingAttendeeInput[] and then read
    // from, which answered 500 to what is really a malformed request.
    for (const bad of [[null], [undefined], ["ada@lp.test"], [42], [[]], [{}], [{ name: "   " }]]) {
      expect(normalizeAttendees(bad)).toBeNull();
    }
    expect(normalizeAttendees("nope")).toBeNull();
    expect(normalizeAttendees(null)).toBeNull();
  });

  it("falls back to the address when only an address is given", () => {
    expect(normalizeAttendees([{ email: "ada@lp.test" }])).toEqual([
      { name: "ada@lp.test", email: "ada@lp.test", type: "external" },
    ]);
  });

  it("drops an unusable address rather than the attendee", () => {
    expect(normalizeAttendees([{ name: "Ada", email: "not-an-address" }])).toEqual([
      { name: "Ada", type: "external" },
    ]);
  });

  it("treats an empty list as valid, and caps a very long one", () => {
    expect(normalizeAttendees([])).toEqual([]);
    const many = Array.from({ length: 150 }, (_, i) => ({ name: `Person ${i}` }));
    expect(normalizeAttendees(many)).toHaveLength(100);
  });
});
