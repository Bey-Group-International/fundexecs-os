jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/signing/seal.server", () => ({ sealPdf: async (pdf: Uint8Array) => ({ pdf, sealed: false }) }));
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

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";
const doc = { id: "doc-1", name: "NDA.pdf", storage_key: "https://example.com/nda", content: null };
const base = {
  shareId: "s1",
  roomId: "r1",
  orgId: "o1",
  doc,
  signerName: "  Jane   Smith ",
  signaturePng: PNG,
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
      signature_png: PNG,
      agreed: true,
    });
  });

  it("refuses a missing or non-PNG signature", async () => {
    for (const bad of ["", "data:image/png;base64,AAAA", "data:text/html;base64,PGI+"]) {
      expect((await signDocument(client(), { ...base, signaturePng: bad })).ok).toBe(false);
    }
    expect(inserted).toBeNull();
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

// ─── Counter-signing ─────────────────────────────────────────────────────────

import { countersignDocument, buildSignedCopy, afterDocumentCountersigned } from "./document-signing.server";
import { sendEmail } from "@/lib/email";

/** A signatures table that applies the update's own filters, like the database. */
function sigClient(row: Record<string, unknown> | null, opts: { updateError?: boolean } = {}) {
  const state = { row: row ? { ...row } : null, patches: [] as Record<string, unknown>[] };
  function from() {
    let patch: Record<string, unknown> | null = null;
    const filters: [string, unknown, "eq" | "is"][] = [];
    const q: Record<string, unknown> = {
      update: (p: Record<string, unknown>) => ((patch = p), state.patches.push(p), q),
      select: () => q,
      eq: (c: string, v: unknown) => (filters.push([c, v, "eq"]), q),
      is: (c: string, v: unknown) => (filters.push([c, v, "is"]), q),
      maybeSingle: async () => {
        if (patch && opts.updateError) return { data: null, error: { code: "08006" } };
        const r = state.row;
        const hit = r && filters.every(([c, v]) => (r[c] ?? null) === v);
        if (patch && hit) Object.assign(r, patch);
        return { data: hit ? r : null, error: null };
      },
    };
    return q;
  }
  return { client: { from } as never, state };
}

const counter = {
  orgId: "o1",
  signatureId: "sig-1",
  signerName: "  Fund  Admin ",
  signaturePng: PNG,
  signerEmail: "Admin@Fund.com",
  userId: "u1",
  agreed: true,
  now: new Date("2026-11-03T09:00:00.000Z"),
};
const open = { id: "sig-1", organization_id: "o1", countersigned_at: null };

describe("countersignDocument", () => {
  it("records the counter-signature with a normalised name and email and the server's time", async () => {
    const { client, state } = sigClient(open);
    expect(await countersignDocument(client, counter)).toEqual({ ok: true, signatureId: "sig-1" });
    expect(state.row).toMatchObject({
      countersigner_name: "Fund Admin",
      countersigner_email: "admin@fund.com",
      countersigner_user_id: "u1",
      countersigned_at: "2026-11-03T09:00:00.000Z",
      countersignature_png: PNG,
    });
  });

  it("will not counter-sign twice: the second attempt is told so and changes nothing", async () => {
    const { client, state } = sigClient(open);
    await countersignDocument(client, counter);
    const again = await countersignDocument(client, { ...counter, signerName: "Someone Else", now: new Date("2026-11-04T00:00:00Z") });
    expect(again).toEqual({ ok: false, error: "This has already been counter-signed." });
    expect(state.row?.countersigner_name).toBe("Fund Admin");
  });

  it("will not touch another organisation's signature", async () => {
    const { client, state } = sigClient({ ...open, organization_id: "other" });
    expect(await countersignDocument(client, counter)).toEqual({ ok: false, error: "We couldn't find that signature." });
    expect(state.row?.countersigned_at).toBeNull();
  });

  it("refuses a missing name, signature or consent before writing anything", async () => {
    for (const bad of [{ signerName: "  " }, { signaturePng: "data:image/png;base64,AAAA" }, { agreed: false }, { signerName: "x".repeat(121) }]) {
      const { client, state } = sigClient(open);
      expect((await countersignDocument(client, { ...counter, ...bad })).ok).toBe(false);
      expect(state.patches).toHaveLength(0);
    }
  });

  it("reports a failed write as a failure, not as already done", async () => {
    const { client } = sigClient(open, { updateError: true });
    expect(await countersignDocument(client, counter)).toEqual({
      ok: false,
      error: "We couldn't record your counter-signature. Please try again.",
    });
  });
});

describe("the signed copy once counter-signed", () => {
  const stampsOf = async (row: Record<string, unknown>) => {
    const built = jest.spyOn(require("@/lib/signing/executed-pdf.server"), "buildSignedPdf");
    const base = {
      id: "sig-1", organization_id: "o1", document_id: "d1", signer_name: "Jane", signer_email: "j@lp.com",
      signed_at: "2026-11-01T00:00:00Z", ip_hint: null, file_name: "Side letter.docx", file_sha256: "abc",
      signature_png: PNG, countersigner_name: null, countersigner_email: null, countersigned_at: null, countersignature_png: null,
    };
    const client = {
      from: (t: string) => {
        const q: Record<string, unknown> = { select: () => q, eq: () => q };
        q.maybeSingle = async () => ({ data: t === "documents" ? { storage_key: null, content: "text", name: "x" } : { ...base, ...row }, error: null });
        return q;
      },
      storage: { from: () => ({ download: async () => ({ data: null }) }) },
    } as never;
    await buildSignedCopy(client, "sig-1");
    const call = built.mock.calls.at(-1)![0] as unknown as { title: string; stamps: { label: string; name?: string; signaturePng?: string | null; signedAt?: string }[] };
    built.mockRestore();
    return call;
  };

  it("carries only the signer until the fund has counter-signed", async () => {
    const call = await stampsOf({});
    expect(call.stamps.map((s) => s.label)).toEqual(["Signer"]);
    expect(call.title).toContain("signed by Jane");
  });

  it("adds the fund's stamp, with its drawn signature, once counter-signed", async () => {
    const call = await stampsOf({
      countersigner_name: "Fund Admin", countersigner_email: "a@fund.com",
      countersigned_at: "2026-11-03T09:00:00Z", countersignature_png: PNG,
    });
    expect(call.stamps.map((s) => s.label)).toEqual(["Signer", "Countersigner (fund)"]);
    expect(call.stamps[1]).toMatchObject({ name: "Fund Admin", signaturePng: PNG, signedAt: "2026-11-03T09:00:00Z" });
    expect(call.title).toContain("executed");
  });
});

describe("afterDocumentCountersigned", () => {
  function mailClient(row: Record<string, unknown>) {
    const updates: Record<string, unknown>[] = [];
    const client = {
      from: (t: string) => {
        const q: Record<string, unknown> = {
          select: () => q,
          eq: () => q,
          update: (p: Record<string, unknown>) => (updates.push(p), q),
          then: (res: (v: unknown) => unknown) => Promise.resolve({ error: null }).then(res),
          maybeSingle: async () => ({ data: t === "data_room_document_signatures" ? row : { name: "Acme" }, error: null }),
        };
        return q;
      },
    } as never;
    return { client, updates };
  }
  const row = {
    id: "sig-1", organization_id: "o1", room_id: "r1", signer_name: "Jane", signer_email: "j@lp.com", file_name: "SL.pdf",
    countersigner_name: "Fund Admin", countersigner_email: "a@fund.com", countersigned_at: "2026-11-03T09:00:00Z", countersign_copy_sent_at: null,
  };
  beforeEach(() => (sendEmail as jest.Mock).mockClear());

  it("emails the executed copy to both the signer and the counter-signer, once", async () => {
    const { client, updates } = mailClient(row);
    await afterDocumentCountersigned(client, "sig-1");
    const to = (sendEmail as jest.Mock).mock.calls.map((c) => c[0].to.email);
    expect(to).toEqual(["j@lp.com", "a@fund.com"]);
    expect(updates[0]).toHaveProperty("countersign_copy_sent_at");
  });

  it("sends nothing again once the copy went out, or before it is counter-signed", async () => {
    await afterDocumentCountersigned(mailClient({ ...row, countersign_copy_sent_at: "2026-11-03T09:01:00Z" }).client, "sig-1");
    await afterDocumentCountersigned(mailClient({ ...row, countersigned_at: null }).client, "sig-1");
    expect(sendEmail).not.toHaveBeenCalled();
  });
});
