jest.mock("server-only", () => ({}), { virtual: true });
const sendEmail = jest.fn(async (_a: unknown) => ({ ok: true }));
jest.mock("@/lib/email", () => ({
  sendEmail: (a: unknown) => sendEmail(a),
  escapeHtml: (s: string) => s,
}));
import { signNda, sendNdaCopy } from "./nda-signing.server";
import { DEFAULT_NDA_TEXT } from "./nda";
import { ndaFingerprint } from "./nda.server";

type Row = Record<string, unknown>;
let tables: Record<string, Row[]>;
const updates: { table: string; patch: Row; id: unknown }[] = [];

function fakeClient() {
  return {
    from: (table: string) => {
      const eqs: Record<string, unknown> = {};
      let insertRow: Row | null = null;
      let patch: Row | null = null;
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => ((eqs[c] = v), q),
        insert: (row: Row) => ((insertRow = row), q),
        update: (p: Row) => ((patch = p), q),
        maybeSingle: async () => {
          if (insertRow) {
            const row = { id: "sig-1", ...insertRow };
            tables[table] = [...(tables[table] ?? []), row];
            return { data: { id: row.id }, error: null };
          }
          const found = (tables[table] ?? []).find((r) => Object.entries(eqs).every(([k, v]) => r[k] === v));
          return { data: found ?? null, error: null };
        },
        then: (resolve: (v: unknown) => unknown, reject?: (e: unknown) => unknown) => {
          if (patch) updates.push({ table, patch, id: eqs.id });
          return Promise.resolve({ data: null, error: null }).then(resolve, reject);
        },
      };
      return q;
    },
  } as never;
}

const share = {
  id: "share-1",
  organization_id: "org-1",
  room_id: "room-1",
  label: "Pension LPs",
  revoked_at: null,
  expires_at: null,
  require_nda: true,
  nda_text: null,
};
const NOW = new Date("2026-10-02T21:30:05.000Z");
const input = { shareId: "share-1", signerName: "  Jane   Smith ", agreed: true, gateEmail: "jane@lp.com", ipHint: "203.0.113", now: NOW };

beforeEach(() => {
  tables = {
    data_room_shares: [{ ...share }],
    organizations: [{ id: "org-1", name: "Acme Capital" }],
    data_rooms: [{ id: "room-1", name: "Fund II" }],
    nda_signatures: [],
  };
  updates.length = 0;
  sendEmail.mockClear();
});

describe("signNda", () => {
  it("records the server's time, the gate email, and the exact text signed with its fingerprint", async () => {
    const r = await signNda(fakeClient(), input);
    expect(r).toEqual({ ok: true, signatureId: "sig-1", orgId: "org-1" });
    expect(tables.nda_signatures[0]).toMatchObject({
      share_id: "share-1",
      organization_id: "org-1",
      signer_name: "Jane Smith",
      signer_email: "jane@lp.com",
      signed_at: NOW.toISOString(),
      nda_text: DEFAULT_NDA_TEXT,
      nda_sha256: ndaFingerprint(DEFAULT_NDA_TEXT),
      agreed: true,
    });
  });

  it("keeps the link's own wording when it has one", async () => {
    tables.data_room_shares[0].nda_text = "Fund II terms are confidential.";
    await signNda(fakeClient(), input);
    expect(tables.nda_signatures[0]).toMatchObject({
      nda_text: "Fund II terms are confidential.",
      nda_sha256: ndaFingerprint("Fund II terms are confidential."),
    });
  });

  it("needs a name, the tick and the gate email", async () => {
    expect(await signNda(fakeClient(), { ...input, signerName: "  " })).toMatchObject({ ok: false });
    expect(await signNda(fakeClient(), { ...input, agreed: false })).toEqual({ ok: false, error: "Tick the box to confirm you agree." });
    expect(await signNda(fakeClient(), { ...input, gateEmail: null })).toEqual({ ok: false, error: "Enter your email first, then sign." });
    expect(tables.nda_signatures).toHaveLength(0);
  });

  it("refuses revoked, expired and NDA-less links", async () => {
    for (const patch of [{ revoked_at: "2026-10-01T00:00:00Z" }, { expires_at: "2026-10-01T00:00:00Z" }, { require_nda: false }]) {
      tables.data_room_shares = [{ ...share, ...patch }];
      expect((await signNda(fakeClient(), input)).ok).toBe(false);
    }
    expect(tables.nda_signatures).toHaveLength(0);
  });
});

describe("sendNdaCopy", () => {
  it("emails the signer a download link from the fund's mailbox and marks the copy sent", async () => {
    await signNda(fakeClient(), input);
    expect(await sendNdaCopy(fakeClient(), "sig-1", "org-1")).toBe(true);
    const args = sendEmail.mock.calls[0][0] as { orgId: string; to: { email: string }; subject: string; htmlBody: string; allowFallback: boolean };
    expect(args).toMatchObject({ orgId: "org-1", to: { email: "jane@lp.com" }, subject: "Your signed NDA with Acme Capital", allowFallback: true });
    expect(args.htmlBody).toContain("/api/dataroom/nda/sig-1?t=");
    expect(args.htmlBody).toContain("Fund II data room");
    expect(updates).toEqual([{ table: "nda_signatures", patch: { copy_sent_at: expect.any(String) }, id: "sig-1" }]);
  });

  it("does not mark a copy sent when the mail fails, or look up another fund's signature", async () => {
    await signNda(fakeClient(), input);
    sendEmail.mockResolvedValueOnce({ ok: false });
    expect(await sendNdaCopy(fakeClient(), "sig-1", "org-1")).toBe(false);
    expect(await sendNdaCopy(fakeClient(), "sig-1", "org-2")).toBe(false);
    expect(updates).toHaveLength(0);
  });
});
