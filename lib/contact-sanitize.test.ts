// Coverage for the contact sanitizer — the guard against invalid/fabricated
// contact details in the composer.

import {
  isValidEmail,
  normalizePhone,
  isValidLinkedIn,
  redactContacts,
  StreamingContactRedactor,
} from "./contact-sanitize";

describe("isValidEmail", () => {
  it("accepts a well-formed business email", () => {
    expect(isValidEmail("jane.doe@blackstone.com")).toBe(true);
  });
  it("rejects placeholders and malformed emails", () => {
    expect(isValidEmail("email_not_unlocked@domain.com")).toBe(false);
    expect(isValidEmail("noreply@apollo.io")).toBe(false);
    expect(isValidEmail("john@example.com")).toBe(false);
    expect(isValidEmail("not-an-email")).toBe(false);
    expect(isValidEmail("a@b")).toBe(false);
    expect(isValidEmail(undefined)).toBe(false);
  });
});

describe("normalizePhone", () => {
  it("keeps a plausible formatted phone", () => {
    expect(normalizePhone("+1 212-555-0100")).toBe("+1 212-555-0100");
    expect(normalizePhone("(212) 555-0100")).toBe("(212) 555-0100");
  });
  it("rejects too-short, lettered, or junk values", () => {
    expect(normalizePhone("555-0100")).toBeNull();
    expect(normalizePhone("call me")).toBeNull();
    expect(normalizePhone("ext 1234")).toBeNull();
    expect(normalizePhone(null)).toBeNull();
  });
});

describe("isValidLinkedIn", () => {
  it("accepts real LinkedIn profile/company URLs", () => {
    expect(isValidLinkedIn("https://www.linkedin.com/in/jane-doe")).toBe(true);
    expect(isValidLinkedIn("https://linkedin.com/company/blackstone")).toBe(true);
  });
  it("rejects non-LinkedIn or malformed URLs", () => {
    expect(isValidLinkedIn("https://example.com/in/jane")).toBe(false);
    expect(isValidLinkedIn("linkedin.com/in/jane")).toBe(false);
    expect(isValidLinkedIn("just text")).toBe(false);
  });
});

describe("redactContacts", () => {
  it("removes emails, phones, and LinkedIn URLs but keeps financial figures", () => {
    const out = redactContacts(
      "Reach Jane at jane@acme.com or 212-555-0100, or https://www.linkedin.com/in/jane. The fund raised $1,200,000 at a 12.5% IRR.",
    );
    expect(out).not.toContain("jane@acme.com");
    expect(out).not.toContain("212-555-0100");
    expect(out).not.toContain("linkedin.com/in/jane");
    expect(out).toContain("$1,200,000");
    expect(out).toContain("12.5% IRR");
  });
});

describe("StreamingContactRedactor", () => {
  it("redacts contact tokens across streamed chunks without splitting them", () => {
    const r = new StreamingContactRedactor();
    let out = "";
    // Feed a fabricated email split across chunk boundaries.
    for (const chunk of ["Contact them at ja", "ne@acme", ".com for details. ", "Next step: call."]) {
      out += r.push(chunk);
    }
    out += r.flush();
    expect(out).not.toContain("jane@acme.com");
    expect(out).toContain("Next step");
  });

  it("passes through clean prose unchanged", () => {
    const r = new StreamingContactRedactor();
    let out = "";
    for (const chunk of ["Blackstone is a large ", "manager. ", "Target a 15% IRR."]) out += r.push(chunk);
    out += r.flush();
    expect(out).toBe("Blackstone is a large manager. Target a 15% IRR.");
  });
});
