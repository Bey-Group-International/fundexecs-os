import { logId } from "@/lib/log-safe";
describe("logId", () => {
  it("passes a uuid and a room code through", () => {
    expect(logId("9f1c2b3e-0000-4000-8000-000000000000")).toBe("9f1c2b3e-0000-4000-8000-000000000000");
    expect(logId("abc-def-12")).toBe("abc-def-12");
  });

  // An allowlist, not an escape: anything that is not an id is not an id that
  // got mangled, and printing a scrubbed version would make it look plausible.
  it.each([
    "m1\n[meetings/sync] completed successfully",
    "m1 %s %s",
    "m1; DROP TABLE",
    "",
    "x".repeat(65),
  ])("refuses %j", (value) => {
    expect(logId(value)).toBe("[invalid-id]");
  });

  it("refuses anything that is not a string", () => {
    expect(logId(null)).toBe("[invalid-id]");
    expect(logId(42)).toBe("[invalid-id]");
  });
});
