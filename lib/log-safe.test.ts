import { MAX_LOG_VALUE, logSafe } from "@/lib/log-safe";

describe("logSafe", () => {
  it("leaves an ordinary value alone", () => {
    expect(logSafe("9f1c2b3e-0000-4000-8000-000000000000")).toBe("9f1c2b3e-0000-4000-8000-000000000000");
  });

  // The whole point: a value carrying a newline must not be able to end the
  // line and have what follows read as a separate entry this process wrote.
  it("stops a value writing its own log line", () => {
    const forged = "m1\n[meetings/sync] completed successfully";
    const out = logSafe(forged);
    expect(out).not.toContain("\n");
    expect(out).toContain("completed successfully");
  });

  it("handles carriage returns and tabs too", () => {
    expect(logSafe("a\r\nb\tc")).not.toMatch(/[\r\n\t]/);
  });

  // Replaced, not stripped: "abc\ndef" and "abcdef" must not look the same in
  // the one place somebody is working out what happened.
  it("leaves a mark where the control character was", () => {
    expect(logSafe("abc\ndef")).not.toBe("abcdef");
  });

  it("caps a value that is no longer an identifier", () => {
    expect(logSafe("x".repeat(MAX_LOG_VALUE + 50))).toHaveLength(MAX_LOG_VALUE + 1);
  });

  it("renders the non-strings a caller might pass", () => {
    expect(logSafe(null)).toBe("null");
    expect(logSafe(undefined)).toBe("undefined");
    expect(logSafe(42)).toBe("42");
    expect(logSafe(true)).toBe("true");
  });

  it("refuses to render an object rather than printing [object Object]", () => {
    expect(logSafe({ a: 1 })).toBe("[unprintable]");
  });
});
