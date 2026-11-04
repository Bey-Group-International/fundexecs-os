jest.mock("server-only", () => ({}), { virtual: true });
const sent: { to: { email: string }; subject: string; htmlBody: string }[] = [];
jest.mock("@/lib/email", () => ({
  sendEmail: async (m: { to: { email: string }; subject: string; htmlBody: string }) => (sent.push(m), { ok: true }),
  buildSigningInvitationHtml: (p: { signingLink: string }) => `<a href="${p.signingLink}">sign</a>`,
}));
jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({ from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: { token: "lp-tok" } }) }) }) }) }),
}));

import { inviteSigners } from "./envelope-invite.server";

const recipients = [
  { id: "r1", name: "Jane", email: "jane@lp.com", signing_token: "t1", role: "signer", status: "pending" },
  { id: "r2", name: "Sam", email: "sam@lp.com", signing_token: "t2", role: "signer", status: "signed" },
  { id: "r3", name: "Owner", email: "o@fund.com", signing_token: "t3", role: "owner", status: "pending" },
];
const client = (data: unknown, error: unknown = null) => ({ from: () => ({ select: () => ({ eq: async () => ({ data, error }) }) }) }) as never;

beforeEach(() => {
  sent.length = 0;
  process.env.NEXT_PUBLIC_APP_URL = "https://app.example/";
});

describe("inviteSigners", () => {
  it("emails each signer their own link and never the countersigning owner", async () => {
    const r = await inviteSigners(client(recipients), { envelopeId: "e", title: "NDA", orgId: "o", lpSessionId: null });
    expect(r.ok).toBe(true);
    expect(sent.map((m) => m.to.email)).toEqual(["jane@lp.com", "sam@lp.com"]);
    expect(sent[0].htmlBody).toContain("https://app.example/sign/t1");
    expect(sent[0].subject).toContain("NDA");
  });

  it("sends a reminder only to those still waiting", async () => {
    const r = await inviteSigners(client(recipients), { envelopeId: "e", title: "NDA", orgId: "o", lpSessionId: null, onlyWaiting: true });
    expect(r.signingUrls.map((u) => u.email)).toEqual(["jane@lp.com"]);
    expect(sent).toHaveLength(1);
  });

  it("gives an LP their portal link, never the bare signing link", async () => {
    await inviteSigners(client(recipients), { envelopeId: "e", title: "Agreement", orgId: "o", lpSessionId: "s1" });
    expect(sent[0].htmlBody).toContain("https://app.example/lp/lp-tok");
    expect(sent[0].htmlBody).not.toContain("/sign/");
    expect(sent[0].subject).toBe("Your subscription agreement is ready to sign");
  });

  it("reports a failure to read the recipients", async () => {
    const r = await inviteSigners(client(null, { message: "boom" }), { envelopeId: "e", title: "NDA", orgId: "o", lpSessionId: null });
    expect(r).toMatchObject({ ok: false, error: "boom" });
    expect(sent).toHaveLength(0);
  });
});
