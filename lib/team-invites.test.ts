import { inviteIsLive, memberAddedEmail } from "@/lib/team-invites";

const NOW = new Date("2026-11-03T12:00:00Z").getTime();

describe("inviteIsLive", () => {
  it("is live before it expires and unaccepted", () => {
    expect(inviteIsLive({ expires_at: "2026-11-10T00:00:00Z", accepted_at: null }, NOW)).toBe(true);
  });

  it("is not live once expired", () => {
    expect(inviteIsLive({ expires_at: "2026-11-01T00:00:00Z", accepted_at: null }, NOW)).toBe(false);
  });

  it("is not live once accepted", () => {
    expect(
      inviteIsLive({ expires_at: "2026-11-10T00:00:00Z", accepted_at: "2026-11-02T00:00:00Z" }, NOW),
    ).toBe(false);
  });

  it("treats a missing or unreadable expiry as not live", () => {
    expect(inviteIsLive({ expires_at: null, accepted_at: null }, NOW)).toBe(false);
    expect(inviteIsLive({ expires_at: "garbage", accepted_at: null }, NOW)).toBe(false);
  });
});

describe("memberAddedEmail", () => {
  const base = { orgName: "Acme Capital", inviterName: "Dana", email: "new@acme.com" };

  it("names the org, the inviter and the sign-in address", () => {
    const { subject, html } = memberAddedEmail({ ...base, role: "member", pending: true });
    expect(subject).toBe("Dana added you to Acme Capital on FundExecs OS");
    expect(html).toContain("new@acme.com");
    expect(html).toContain("/login");
  });

  it("says admin access for an admin and waits for sign-in when pending", () => {
    const { html } = memberAddedEmail({ ...base, role: "admin", pending: true });
    expect(html).toContain("admin");
    expect(html).toContain("land in Acme Capital automatically");
  });

  it("does not promise automatic landing for someone who already has an account", () => {
    const { html } = memberAddedEmail({ ...base, role: "member", pending: false });
    expect(html).not.toContain("automatically");
  });

  it("escapes markup in names", () => {
    const { html } = memberAddedEmail({
      orgName: "<script>x</script>",
      inviterName: "<b>Eve</b>",
      email: "a@b.com",
      role: "member",
      pending: false,
    });
    expect(html).not.toContain("<script>");
    expect(html).not.toContain("<b>Eve</b>");
  });

  it("falls back to a generic inviter", () => {
    const { subject } = memberAddedEmail({ ...base, inviterName: null, role: "member", pending: false });
    expect(subject).toBe("A teammate added you to Acme Capital on FundExecs OS");
  });

  it("labels a reminder as one and keeps the sign-in link", () => {
    const { subject, html } = memberAddedEmail({ ...base, role: "member", pending: true, reminder: true });
    expect(subject).toBe("Reminder: join Acme Capital on FundExecs OS");
    expect(html).toContain("Reminder: Dana added you to Acme Capital");
    expect(html).toContain("/login");
  });
});
