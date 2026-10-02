jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/email", () => ({ escapeHtml: (s: string) => s.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;") }));
import { PDFDocument } from "pdf-lib";
import { buildNdaPdf, ndaCopyEmail, ndaCopyToken, ndaCopyTokenValid, ndaCopyUrl, ndaFingerprint } from "./nda.server";
import { DEFAULT_NDA_TEXT, ndaTextFor } from "./nda";

const SIG = "11111111-1111-4111-8111-111111111111";

describe("ndaTextFor", () => {
  it("uses the link's own wording, else the default", () => {
    expect(ndaTextFor("  Keep it quiet.  ")).toBe("Keep it quiet.");
    expect(ndaTextFor("   ")).toBe(DEFAULT_NDA_TEXT);
    expect(ndaTextFor(null)).toBe(DEFAULT_NDA_TEXT);
  });
});

describe("ndaFingerprint", () => {
  it("is the SHA-256 of the exact text, so one changed character shows", () => {
    expect(ndaFingerprint("abc")).toBe("ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad");
    expect(ndaFingerprint("abc ")).not.toBe(ndaFingerprint("abc"));
  });
});

describe("copy token", () => {
  it("opens the signature it was made for and no other", () => {
    const t = ndaCopyToken(SIG);
    expect(ndaCopyTokenValid(SIG, t)).toBe(true);
    expect(ndaCopyTokenValid("22222222-2222-4222-8222-222222222222", t)).toBe(false);
    expect(ndaCopyTokenValid(SIG, t.slice(1))).toBe(false);
    expect(ndaCopyTokenValid(SIG, null)).toBe(false);
    expect(ndaCopyUrl(SIG)).toContain(`/api/dataroom/nda/${SIG}?t=${t}`);
  });
});

describe("buildNdaPdf", () => {
  const record = {
    id: SIG,
    signerName: "Jane Smith",
    signerEmail: "jane@lp.com",
    signedAt: "2026-10-02T21:30:05.000Z",
    ipHint: "203.0.113",
    text: `${"Long clause about confidentiality. ".repeat(220)}Ünïcode “quotes” → arrows.`,
    sha256: ndaFingerprint("x"),
    agreed: true,
    orgName: "Acme Capital",
    roomName: "Fund II",
    linkLabel: "Pension LPs",
  };

  it("lays out a long agreement over several pages without failing on characters it cannot draw", async () => {
    const out = await buildNdaPdf(record);
    const doc = await PDFDocument.load(out);
    expect(doc.getPageCount()).toBeGreaterThan(1);
    expect(doc.getTitle()).toBe("NDA - Jane Smith");
  });

  it("still produces a record for a signature that predates kept text", async () => {
    const doc = await PDFDocument.load(await buildNdaPdf({ ...record, text: null, sha256: null, agreed: false }));
    expect(doc.getPageCount()).toBe(1);
  });
});

describe("ndaCopyEmail", () => {
  it("links the copy and escapes what the signer typed", () => {
    const { subject, html } = ndaCopyEmail({
      orgName: "Acme Capital",
      roomName: "Fund II",
      signerName: "<b>Jane</b> Smith",
      signedAt: "2026-10-02T21:30:05.000Z",
      sha256: "abc",
      downloadUrl: "https://x.test/api/dataroom/nda/1?t=2",
    });
    expect(subject).toBe("Your signed NDA with Acme Capital");
    expect(html).toContain('href="https://x.test/api/dataroom/nda/1?t=2"');
    expect(html).toContain("&lt;b&gt;Jane&lt;/b&gt; Smith");
    expect(html).not.toContain("<b>Jane");
    expect(html).toContain("Oct 2, 2026, 21:30:05 UTC");
  });
});
