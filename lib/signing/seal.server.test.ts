jest.mock("server-only", () => ({}), { virtual: true });
import forge from "node-forge";
import { PDFDocument } from "pdf-lib";
import { buildSignedPdf } from "./executed-pdf.server";
import { sealPdf } from "./seal.server";

// A real 1x1 PNG.
const PNG =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

function selfSignedP12(pass: string): string {
  const keys = forge.pki.rsa.generateKeyPair(2048);
  const cert = forge.pki.createCertificate();
  cert.publicKey = keys.publicKey;
  cert.serialNumber = "01";
  cert.validity.notBefore = new Date(Date.now() - 86_400_000);
  cert.validity.notAfter = new Date(Date.now() + 365 * 86_400_000);
  const attrs = [{ name: "commonName", value: "FundExecs Test Seal" }];
  cert.setSubject(attrs);
  cert.setIssuer(attrs);
  cert.sign(keys.privateKey, forge.md.sha256.create());
  const p12 = forge.pkcs12.toPkcs12Asn1(keys.privateKey, [cert], pass, { algorithm: "3des" });
  return Buffer.from(forge.asn1.toDer(p12).getBytes(), "binary").toString("base64");
}

const stamp = (over = {}) => ({
  label: "Investor", name: "Jane Smith", email: "jane@lp.com", signedAt: "2026-11-02T12:00:00.000Z",
  ipHint: "203.0.113", signaturePng: PNG, ...over,
});

describe("buildSignedPdf", () => {
  it("makes a document page and a signature page with the drawn signature embedded", async () => {
    const bytes = await buildSignedPdf({
      title: "Subscription Agreement", text: "# Agreement\n\nThe terms.", stamps: [stamp()], awaiting: ["Fund"], fingerprint: "a".repeat(64),
    });
    const doc = await PDFDocument.load(bytes);
    expect(doc.getPageCount()).toBe(2);
    // An embedded image shows up as an XObject on the signature page.
    expect(Buffer.from(bytes).includes(Buffer.from("/Subtype /Image"))).toBe(true);
  });

  it("appends the signature page to the signer's own PDF and ignores a bad image", async () => {
    const base = await PDFDocument.create();
    base.addPage([612, 792]);
    base.addPage([612, 792]);
    const bytes = await buildSignedPdf({
      title: "NDA", basePdf: await base.save(), stamps: [stamp({ signaturePng: "data:image/png;base64,AAAA" })], fingerprint: "b".repeat(64),
    });
    expect((await PDFDocument.load(bytes)).getPageCount()).toBe(3);
    expect(Buffer.from(bytes).includes(Buffer.from("/Subtype /Image"))).toBe(false);
  });
});

describe("sealPdf", () => {
  const OLD = { ...process.env };
  afterEach(() => { process.env = { ...OLD }; });

  it("returns the file unsealed when no certificate is configured", async () => {
    delete process.env.PDF_SEAL_P12_BASE64;
    const bytes = await buildSignedPdf({ title: "T", text: "x", stamps: [stamp()], fingerprint: "c".repeat(64) });
    const r = await sealPdf(bytes, { reason: "test" });
    expect(r.sealed).toBe(false);
    expect(r.pdf).toBe(bytes);
  });

  it("embeds a CMS signature over the whole file when a certificate is configured", async () => {
    process.env.PDF_SEAL_P12_BASE64 = selfSignedP12("pw");
    process.env.PDF_SEAL_P12_PASSPHRASE = "pw";
    const bytes = await buildSignedPdf({ title: "T", text: "x", stamps: [stamp()], fingerprint: "d".repeat(64) });
    const r = await sealPdf(bytes, { reason: "Executed subscription agreement" });
    expect(r.sealed).toBe(true);
    const text = Buffer.from(r.pdf).toString("latin1");
    expect(text).toContain("/Type /Sig");
    expect(text).toMatch(/\/ByteRange \[\s*0 \d+ \d+ \d+\s*\]/);
    // Still a readable PDF with its pages intact.
    expect((await PDFDocument.load(r.pdf)).getPageCount()).toBe(2);
  }, 60_000);

  it("falls back to unsealed on a bad certificate instead of failing", async () => {
    process.env.PDF_SEAL_P12_BASE64 = Buffer.from("not a p12").toString("base64");
    jest.spyOn(console, "error").mockImplementation(() => undefined);
    const bytes = await buildSignedPdf({ title: "T", text: "x", stamps: [stamp()], fingerprint: "e".repeat(64) });
    expect((await sealPdf(bytes, { reason: "t" })).sealed).toBe(false);
  });
});
