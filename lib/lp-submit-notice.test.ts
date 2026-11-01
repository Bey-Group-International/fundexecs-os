import { inboxAlert, MAX_NOTICE_RECIPIENTS, noticeRecipients, submissionNotice } from "./lp-submit-notice";

const m = (role: string, email: string | null, full_name: string | null = null) => ({ role, email, full_name });

describe("noticeRecipients", () => {
  it("tells owners and admins, and nobody else", () => {
    const res = noticeRecipients([m("owner", "o@x.com"), m("admin", "a@x.com"), m("member", "m@x.com"), m("viewer", "v@x.com")]);
    expect(res.map((r) => r.email)).toEqual(["o@x.com", "a@x.com"]);
  });

  it("puts owners first, then orders the rest the same way every time", () => {
    const res = noticeRecipients([m("admin", "z@x.com"), m("admin", "b@x.com"), m("owner", "y@x.com")]);
    expect(res.map((r) => r.email)).toEqual(["y@x.com", "b@x.com", "z@x.com"]);
  });

  it("skips members with no usable address and lists a person once, whatever the case", () => {
    const res = noticeRecipients([m("owner", null), m("owner", "  "), m("owner", "not-an-email"), m("owner", "A@x.com"), m("admin", "a@X.com")]);
    expect(res.map((r) => r.email)).toEqual(["A@x.com"]);
  });

  it("uses the person's name, or their address when they have none", () => {
    const res = noticeRecipients([m("owner", "a@x.com", " Ada "), m("admin", "b@x.com", "")]);
    expect(res).toEqual([
      { email: "a@x.com", name: "Ada" },
      { email: "b@x.com", name: "b@x.com" },
    ]);
  });

  it("never emails more than the cap", () => {
    const many = Array.from({ length: MAX_NOTICE_RECIPIENTS + 5 }, (_, i) => m("admin", `u${String(i).padStart(2, "0")}@x.com`));
    expect(noticeRecipients(many)).toHaveLength(MAX_NOTICE_RECIPIENTS);
  });

  it("returns nobody for an empty team", () => {
    expect(noticeRecipients([])).toEqual([]);
  });
});

describe("submissionNotice", () => {
  const base = { orgName: "Acme Capital", lpName: "Jo Park", lpType: "individual", resubmitted: false, reviewUrl: "https://app.test/run/onboarding" };

  it("says who submitted, where to review, and that nothing is approved yet", () => {
    const n = submissionNotice(base);
    expect(n.subject).toBe("Jo Park submitted their onboarding");
    expect(n.htmlBody).toContain("Jo Park");
    expect(n.htmlBody).toContain("Acme Capital");
    expect(n.htmlBody).toContain('href="https://app.test/run/onboarding"');
    expect(n.htmlBody).toMatch(/Nothing is approved until you do it/);
  });

  it("says so when it is a resubmission", () => {
    const n = submissionNotice({ ...base, resubmitted: true });
    expect(n.subject).toBe("Jo Park resubmitted their onboarding");
    expect(n.htmlBody).toMatch(/changes you asked for/);
  });

  it("escapes what the LP typed, and keeps a line break out of the subject", () => {
    const n = submissionNotice({ ...base, lpName: '<img src=x onerror=1>\r\nBcc: evil@x.com', orgName: "A&B <Fund>" });
    expect(n.htmlBody).not.toContain("<img");
    expect(n.htmlBody).toContain("&lt;img");
    expect(n.htmlBody).toContain("A&amp;B &lt;Fund&gt;");
    expect(n.subject).not.toMatch(/[\r\n]/);
  });

  it("falls back for a blank name and ignores a type it doesn't know", () => {
    const n = submissionNotice({ ...base, lpName: "  ", lpType: "mystery" });
    expect(n.subject).toBe("An LP submitted their onboarding");
    expect(n.htmlBody).not.toContain("mystery");
  });

  it("carries nothing the LP entered beyond name and type", () => {
    const n = submissionNotice(base);
    expect(n.htmlBody).not.toMatch(/ssn|tax|passport|address|phone|owner/i);
  });
});

describe("inboxAlert", () => {
  const base = { lpName: "Jo Park", lpType: "individual", resubmitted: false };

  it("says who submitted and that it's waiting, and nothing else", () => {
    const a = inboxAlert(base);
    expect(a.subject).toBe("Jo Park submitted their onboarding");
    expect(a.body).toContain("Jo Park (Individual)");
    expect(a.body).toMatch(/nothing is approved until you do it/);
    expect(a.body).not.toMatch(/ssn|tax|passport|address|phone/i);
  });

  it("says so for a resubmission", () => {
    expect(inboxAlert({ ...base, resubmitted: true }).subject).toBe("Jo Park resubmitted their onboarding");
  });

  it("keeps the subject to one line, caps a long name, and survives a blank one", () => {
    expect(inboxAlert({ ...base, lpName: "Jo\r\nPark" }).subject).toBe("Jo Park submitted their onboarding");
    expect(inboxAlert({ ...base, lpName: "x".repeat(500) }).subject.length).toBeLessThan(160);
    expect(inboxAlert({ ...base, lpName: "  " }).subject).toBe("An LP submitted their onboarding");
  });

  it("ignores a type it doesn't know", () => {
    expect(inboxAlert({ ...base, lpType: "mystery" }).body).not.toContain("mystery");
  });
});
