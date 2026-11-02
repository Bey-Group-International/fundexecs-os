import { parsePrivacyKind, privacyConfirmation, privacyInboxAlert, privacyNotice, PRIVACY_REQUEST_COOLDOWN_MS } from "./lp-privacy-request";

describe("parsePrivacyKind", () => {
  it("accepts the two kinds and nothing else", () => {
    expect(parsePrivacyKind("access")).toBe("access");
    expect(parsePrivacyKind("erasure")).toBe("erasure");
    for (const bad of ["delete", "", "ACCESS", null, undefined, 1, {}, ["access"]]) expect(parsePrivacyKind(bad)).toBeNull();
  });
});

describe("privacyNotice", () => {
  it("says who asked and for what, escapes the name, and never reaches the subject with a line break", () => {
    const m = privacyNotice({ orgName: "Acme <Fund>", lpName: "Eve\r\nBcc: x@y.z <script>", kind: "erasure", reviewUrl: "https://app.test/run/onboarding" });
    expect(m.subject).toBe("Eve Bcc: x@y.z <script> asked for their data to be erased");
    expect(m.subject).not.toMatch(/[\r\n]/);
    expect(m.htmlBody).not.toContain("<script>");
    expect(m.htmlBody).toContain("&lt;script&gt;");
    expect(m.htmlBody).toContain("Acme &lt;Fund&gt;");
    expect(m.htmlBody).toContain("Nothing has been changed or sent");
    expect(m.htmlBody).toContain("retype their name");
  });
  it("an access request has its own wording and no erase instructions", () => {
    const m = privacyNotice({ orgName: "Acme", lpName: "Jane", kind: "access", reviewUrl: "https://app.test/x" });
    expect(m.subject).toBe("Jane asked for a copy of their data");
    expect(m.htmlBody).not.toContain("retype");
  });
});

describe("privacyInboxAlert", () => {
  it("is plain text with the LP's name and no details", () => {
    const a = privacyInboxAlert({ lpName: "  Jane   Doe ", kind: "access" });
    expect(a.subject).toBe("Jane Doe asked for a copy of their data");
    expect(a.body).toContain("Nothing has been changed or sent");
    expect(a.body).not.toContain("<");
  });
  it("caps a very long name", () => {
    expect(privacyInboxAlert({ lpName: "x".repeat(500), kind: "erasure" }).subject.length).toBeLessThan(200);
  });
});

describe("privacyConfirmation", () => {
  it("tells the LP who will answer, and that erasure may be limited by law", () => {
    expect(privacyConfirmation("access", "Acme")).toMatch(/sent to Acme.*contact you directly/);
    expect(privacyConfirmation("erasure", "Acme")).toMatch(/kept by law/);
    expect(privacyConfirmation("access", "  ")).toContain("your fund manager");
  });
});

it("allows one request of each kind a day", () => {
  expect(PRIVACY_REQUEST_COOLDOWN_MS).toBe(86_400_000);
});
