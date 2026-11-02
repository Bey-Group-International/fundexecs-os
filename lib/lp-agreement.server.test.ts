jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/lp-audit.server", () => ({ recordAudit: jest.fn(async () => true) }));
jest.mock("@/lib/envelope-notify.server", () => ({ envelopeCopyUrl: (id: string) => `https://x/copy/${id}` }));
import { PDFDocument } from "pdf-lib";
import { AGREEMENT_SIGNATURE_PAGE, agreementExecuted, agreementText, loadLpAgreementView, readyForAgreement, type AgreementFacts } from "./lp-agreement.server";
import { buildDocumentPdf } from "./signing/executed-pdf.server";

jest.mock("./signing/executed-pdf.server", () => jest.requireActual("./signing/executed-pdf.server"));

const facts: AgreementFacts = {
  id: "s1", organization_id: "o1", lp_name: "Jane Smith", lp_email: "jane@lp.com", status: "accreditation", review_state: "approved",
  fund_id: "f1", investor_id: null, commitment_amount: 250000, orgName: "Acme Capital", fundName: "Fund I", jurisdiction: "Delaware",
};

describe("agreement", () => {
  it("is filled with the LP's name, fund and commitment", () => {
    const t = agreementText(facts, new Date("2026-11-02T12:00:00Z"));
    expect(t).toContain("Fund I");
    expect(t).toContain("Jane Smith");
    expect(t).toContain("$250,000");
    expect(t).toContain("November 2, 2026");
  });

  it("is only offered to an approved LP who has not signed yet", () => {
    expect(readyForAgreement(facts)).toBe(true);
    expect(readyForAgreement({ ...facts, review_state: "submitted" })).toBe(false);
    expect(readyForAgreement({ ...facts, status: "subscription" })).toBe(false);
    expect(readyForAgreement({ ...facts, status: "pending" })).toBe(false);
  });

  it("builds a PDF with a signature page for the investor and the fund", async () => {
    const plain = await PDFDocument.load(await buildDocumentPdf({ title: "A", text: "Short." }));
    const withSig = await PDFDocument.load(await buildDocumentPdf({ title: "A", text: "Short.", signaturePage: AGREEMENT_SIGNATURE_PAGE }));
    expect(withSig.getPageCount()).toBe(plain.getPageCount() + 1);
    expect(AGREEMENT_SIGNATURE_PAGE.parties.map((p) => p.label)).toEqual(["Investor", "Fund"]);
  });
});

// A tiny scripted client: each table returns the rows given for it.
function client(tables: Record<string, unknown>) {
  return {
    from: (t: string) => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, neq: () => q,
        maybeSingle: async () => ({ data: (tables[t] as unknown) ?? null, error: null }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: tables[t] ?? [], error: null }).then(res),
      };
      return q;
    },
  } as never;
}

describe("loadLpAgreementView", () => {
  const rec = { id: "r1", status: "pending", signing_token: "tok-1" };
  it("says preparing until the fund has sent it", async () => {
    expect(await loadLpAgreementView(client({}), "s1")).toEqual({ state: "preparing" });
    expect(await loadLpAgreementView(client({ envelopes: { id: "e1", title: "T", status: "draft" }, envelope_recipients: rec }), "s1")).toEqual({ state: "preparing" });
  });

  it("gives the LP their own link and blocks once sent", async () => {
    const v = await loadLpAgreementView(
      client({
        envelopes: { id: "e1", title: "Subscription", status: "sent" },
        envelope_recipients: rec,
        envelope_fields: [{ id: "f1", field_type: "signature", page: 3, x_pct: 10, y_pct: 20, width_pct: 26, height_pct: 7, required: true, prefill: null, locked: false }],
      }),
      "s1",
    );
    expect(v).toMatchObject({ state: "ready", signingToken: "tok-1", title: "Subscription", blocks: [{ id: "f1", type: "signature", page: 3 }] });
  });

  it("shows signed once the LP has, and the executed copy once the fund has too", async () => {
    expect(await loadLpAgreementView(client({ envelopes: { id: "e1", title: "T", status: "partially_signed" }, envelope_recipients: { ...rec, status: "signed" } }), "s1")).toEqual({ state: "signed" });
    expect(await loadLpAgreementView(client({ envelopes: { id: "e1", title: "T", status: "completed" }, envelope_recipients: { ...rec, status: "signed" } }), "s1")).toEqual({ state: "completed", copyUrl: "https://x/copy/e1" });
  });
});

describe("agreementExecuted (the closing gate)", () => {
  const rows = (data: unknown, error: unknown = null) =>
    ({ from: () => { const q: Record<string, unknown> = { select: () => q, eq: () => q, neq: () => q, then: (res: (v: unknown) => unknown) => Promise.resolve({ data, error }).then(res) }; return q; } }) as never;

  it("opens once the agreement is fully signed", async () => {
    expect(await agreementExecuted(rows([{ status: "completed" }]), "s1")).toBe(true);
  });
  it("stays closed while the fund has yet to countersign", async () => {
    expect(await agreementExecuted(rows([{ status: "partially_signed" }]), "s1")).toBe(false);
    expect(await agreementExecuted(rows([{ status: "sent" }]), "s1")).toBe(false);
  });
  it("leaves LPs with no agreement envelope on their old path", async () => {
    expect(await agreementExecuted(rows([]), "s1")).toBe(true);
  });
  it("fails closed when the read fails", async () => {
    expect(await agreementExecuted(rows(null, { message: "boom" }), "s1")).toBe(false);
  });
});
