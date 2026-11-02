jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("@/lib/signing/seal.server", () => ({ sealPdf: async (pdf: Uint8Array) => ({ pdf, sealed: false }) }));
jest.mock("@/lib/email", () => ({ sendEmail: jest.fn(async () => ({ ok: true })), escapeHtml: (s: string) => s }));

const PNG = "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8BQDwAEhQGAhKmMIQAAAABJRU5ErkJggg==";

// ─── Counter-signing ─────────────────────────────────────────────────────────

import { countersignDocument, buildSignedCopy, afterDocumentCountersigned, signedDocumentIds } from "./document-signing.server";
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


// ─── Who has signed: the envelope flow and the older table ────────────────────

/** A scripted client: each table answers its own select, whatever filters are chained. */
function tablesClient(tables: Record<string, unknown[] | { error: string }>) {
  return {
    from: (t: string) => {
      const q: Record<string, unknown> = {
        select: () => q, eq: () => q, neq: () => q, ilike: () => q, in: () => q,
        then: (res: (v: unknown) => unknown) => {
          const v = tables[t];
          return Promise.resolve(Array.isArray(v) ? { data: v, error: null } : { data: null, error: { message: (v as { error: string }).error } }).then(res);
        },
      };
      return q;
    },
  } as never;
}

describe("signedDocumentIds", () => {
  it("counts a file as signed once the reader has signed their envelope, countersigned or not", async () => {
    const ids = await signedDocumentIds(
      tablesClient({
        data_room_document_signatures: [],
        envelopes: [{ id: "e1", data_room_document_id: "doc-1" }, { id: "e2", data_room_document_id: "doc-2" }],
        envelope_recipients: [{ envelope_id: "e1" }],
      }),
      "s1",
      "jane@lp.com",
      ["doc-1", "doc-2", "doc-3"],
    );
    expect([...ids]).toEqual(["doc-1"]);
  });

  it("still counts a signature from the older table", async () => {
    const ids = await signedDocumentIds(
      tablesClient({ data_room_document_signatures: [{ document_id: "doc-9" }], envelopes: [], envelope_recipients: [] }),
      "s1",
      "jane@lp.com",
      ["doc-9"],
    );
    expect([...ids]).toEqual(["doc-9"]);
  });

  it("needs an email and some documents, and never reads an errored table as nothing signed", async () => {
    expect((await signedDocumentIds(tablesClient({}), "s1", null, ["d"])).size).toBe(0);
    expect((await signedDocumentIds(tablesClient({}), "s1", "a@b.co", [])).size).toBe(0);
    await expect(
      signedDocumentIds(tablesClient({ data_room_document_signatures: [], envelopes: { error: "boom" } }), "s1", "a@b.co", ["d"]),
    ).rejects.toThrow();
  });
});
