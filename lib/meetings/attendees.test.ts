import { formatAttendeeInput, parseAttendeeInput } from "./attendees";

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
