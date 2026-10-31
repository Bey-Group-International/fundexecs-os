jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn(async () => ({ ok: true })), escapeHtml: (s: string) => s }));
import { createHash } from "crypto";
import { fingerprintDocument, signDocument } from "./document-signing.server";

let inserted: Record<string, unknown> | null;
function client(insertError: { code: string } | null = null) {
  inserted = null;
  const q: Record<string, unknown> = {
    insert: (row: Record<string, unknown>) => ((inserted = row), q),
    select: () => q,
    eq: () => q,
    ilike: () => q,
    // The insert's read fails with the error; the follow-up lookup finds the row.
    maybeSingle: async () => {
      if (insertError && !looked) {
        looked = true;
        return { data: null, error: insertError };
      }
      return { data: { id: "sig-1" }, error: null };
    },
  };
  let looked = false;
  return { from: () => q } as never;
}

const doc = { id: "doc-1", name: "NDA.pdf", storage_key: "https://example.com/nda", content: null };
const base = {
  shareId: "s1",
  roomId: "r1",
  orgId: "o1",
  doc,
  signerName: "  Jane   Smith ",
  agreed: true,
  email: "Jane@LP.com",
  ipHint: "203.0.113",
  now: new Date("2026-10-31T12:00:00.000Z"),
};

describe("signDocument", () => {
  it("records a normalised name and email, the server's time and the file's fingerprint", async () => {
    const r = await signDocument(client(), base);
    expect(r).toEqual({ ok: true, signatureId: "sig-1", orgId: "o1" });
    expect(inserted).toMatchObject({
      signer_name: "Jane Smith",
      signer_email: "jane@lp.com",
      signed_at: "2026-10-31T12:00:00.000Z",
      document_id: "doc-1",
      file_name: "NDA.pdf",
      file_sha256: createHash("sha256").update("https://example.com/nda").digest("hex"),
      agreed: true,
    });
  });

  it("refuses a missing name, missing consent and missing email", async () => {
    expect((await signDocument(client(), { ...base, signerName: " " })).ok).toBe(false);
    expect((await signDocument(client(), { ...base, agreed: false })).ok).toBe(false);
    expect((await signDocument(client(), { ...base, email: null })).ok).toBe(false);
    expect(inserted).toBeNull();
  });

  it("treats a repeat signature on the same link as success", async () => {
    const r = await signDocument(client({ code: "23505" }), base);
    expect(r).toEqual({ ok: true, signatureId: "sig-1", orgId: "o1" });
  });
});

describe("fingerprintDocument", () => {
  it("hashes written content when there is no file", async () => {
    const h = await fingerprintDocument({} as never, { name: "x", storage_key: null, content: "hello" });
    expect(h).toBe(createHash("sha256").update("hello").digest("hex"));
  });
});
