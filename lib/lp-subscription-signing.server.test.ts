jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn(async () => ({ ok: true })), escapeHtml: (s: string) => s }));
jest.mock("@/lib/lp-audit.server", () => ({ recordAudit: jest.fn(async () => true) }));
import { createHash } from "crypto";
import { agreementFor, countersign, signAsLp, copyToken, copyTokenValid, buildExecutedPdf } from "./lp-subscription-signing.server";

type Row = Record<string, unknown>;
let rows: Row[];
let insertError: { code: string } | null;
function client() {
  return {
    from: () => {
      const eqs: Record<string, unknown> = {};
      let ins: Row | null = null;
      const q: Record<string, unknown> = {
        select: () => q,
        eq: (c: string, v: unknown) => ((eqs[c] = v), q),
        insert: (r: Row) => ((ins = r), q),
        maybeSingle: async () => {
          if (ins) {
            if (insertError) return { data: null, error: insertError };
            const row = { id: `sig-${rows.length + 1}`, ...ins };
            rows.push(row);
            return { data: { id: row.id }, error: null };
          }
          return { data: rows.find((r) => Object.entries(eqs).every(([k, v]) => r[k] === v)) ?? null, error: null };
        },
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows.filter((r) => Object.entries(eqs).every(([k, v]) => r[k] === v)), error: null }).then(res),
      };
      return q;
    },
  } as never;
}

const facts = {
  id: "s1", organization_id: "o1", lp_name: "Jane Smith", lp_email: "Jane@LP.com", fund_id: "f1", investor_id: null,
  commitment_amount: 250000, orgName: "Acme Capital", fundName: "Fund I", jurisdiction: "Delaware",
};
const NOW = new Date("2026-11-02T12:00:00.000Z");

beforeEach(() => {
  rows = [];
  insertError = null;
});

describe("signAsLp", () => {
  it("records the agreement text and its fingerprint under the invited email", async () => {
    const r = await signAsLp(client(), { facts, signerName: "  Jane   Smith ", agreed: true, ipHint: "203.0.113", now: NOW });
    expect(r.ok).toBe(true);
    const text = agreementFor(facts, NOW);
    expect(rows[0]).toMatchObject({
      party: "lp", signer_name: "Jane Smith", signer_email: "jane@lp.com", signed_at: NOW.toISOString(),
      agreement_text: text, agreement_sha256: createHash("sha256").update(text, "utf8").digest("hex"),
    });
    expect(text).toContain("Fund I");
    expect(text).toContain("$250,000");
  });

  it("refuses without a name or without consent", async () => {
    expect((await signAsLp(client(), { facts, signerName: " ", agreed: true, ipHint: null })).ok).toBe(false);
    expect((await signAsLp(client(), { facts, signerName: "Jane", agreed: false, ipHint: null })).ok).toBe(false);
    expect(rows).toHaveLength(0);
  });

  it("treats a repeat as the same signature", async () => {
    rows.push({ id: "sig-0", session_id: "s1", party: "lp" });
    insertError = { code: "23505" };
    expect(await signAsLp(client(), { facts, signerName: "Jane", agreed: true, ipHint: null })).toEqual({ ok: true, signatureId: "sig-0" });
  });
});

describe("countersign", () => {
  it("needs the LP to have signed first", async () => {
    const r = await countersign(client(), { orgId: "o1", sessionId: "s1", signerName: "GP Person", signerEmail: "gp@fund.com", agreed: true });
    expect(r).toEqual({ ok: false, error: "The LP has not signed yet." });
  });

  it("signs the very text the LP signed", async () => {
    await signAsLp(client(), { facts, signerName: "Jane Smith", agreed: true, ipHint: null, now: NOW });
    const r = await countersign(client(), { orgId: "o1", sessionId: "s1", signerName: "GP Person", signerEmail: "GP@Fund.com", agreed: true });
    expect(r.ok).toBe(true);
    const [lp, gp] = rows;
    expect(gp).toMatchObject({ party: "gp", signer_email: "gp@fund.com", agreement_sha256: lp.agreement_sha256, agreement_text: lp.agreement_text });
  });
});

describe("executed PDF and copy links", () => {
  it("builds a PDF only once the LP has signed", async () => {
    expect(await buildExecutedPdf(client(), "s1")).toBeNull();
    await signAsLp(client(), { facts, signerName: "Jane Smith", agreed: true, ipHint: null, now: NOW });
    const built = await buildExecutedPdf(client(), "s1");
    expect(built?.lpName).toBe("Jane Smith");
    expect(Buffer.from(built!.pdf.slice(0, 5)).toString()).toBe("%PDF-");
  });

  it("a copy token opens only its own session", () => {
    const t = copyToken("s1");
    expect(copyTokenValid("s1", t)).toBe(true);
    expect(copyTokenValid("s2", t)).toBe(false);
    expect(copyTokenValid("s1", null)).toBe(false);
  });
});
