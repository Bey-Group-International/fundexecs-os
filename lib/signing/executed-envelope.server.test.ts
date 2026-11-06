jest.mock("server-only", () => ({}), { virtual: true });

const load = jest.fn();
const loadExecuted = jest.fn();
const storeExecuted = jest.fn();
jest.mock("@/lib/envelope-pdf.server", () => ({
  loadEnvelopePdf: (...a: unknown[]) => load(...a),
  loadExecutedPdf: (...a: unknown[]) => loadExecuted(...a),
  storeExecutedPdf: (...a: unknown[]) => storeExecuted(...a),
}));
const buildSigned = jest.fn();
jest.mock("@/lib/signing/executed-pdf.server", () => ({ buildSignedPdf: (...a: unknown[]) => buildSigned(...a) }));
const stamp = jest.fn();
jest.mock("@/lib/signing/stamp.server", () => ({ stampBlocks: (...a: unknown[]) => stamp(...a) }));
const seal = jest.fn();
let sealOn = true;
jest.mock("@/lib/signing/seal.server", () => ({ sealConfigured: () => sealOn, sealPdf: (...a: unknown[]) => seal(...a) }));

import { getEnvelopeCopy, keepExecutedCopy } from "./executed-envelope.server";

const bytes = (n: number) => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, n]);
let status = "completed";
let signedRecipients = true;
let fieldRows: unknown[] = [];

function db(): never {
  const rows: Record<string, unknown> = {
    envelopes: { id: "e1", title: "NDA", document_content: "text", status, pdf_storage_key: "envelopes/e1.pdf", document_sha256: "a".repeat(64) },
    envelope_recipients: [
      { id: "r1", name: "Jane", email: "j@lp.com", role: "signer", status: signedRecipients ? "signed" : "pending", signed_at: signedRecipients ? "2026-11-04T10:00:00Z" : null, signature_data: "data:image/png;base64,AAAA", ip_address: "1.2.3.4" },
    ],
    envelope_fields: fieldRows,
  };
  return {
    from: (t: string) => {
      const q: Record<string, unknown> = {
        select: () => q,
        eq: () => q,
        order: () => q,
        maybeSingle: async () => ({ data: rows[t] }),
        then: (res: (v: unknown) => unknown) => Promise.resolve({ data: rows[t] }).then(res),
      };
      return q;
    },
  } as never;
}

beforeEach(() => {
  jest.clearAllMocks();
  status = "completed";
  signedRecipients = true;
  fieldRows = [];
  sealOn = true;
  load.mockResolvedValue(bytes(1));
  stamp.mockResolvedValue(bytes(2));
  buildSigned.mockResolvedValue(bytes(3));
  seal.mockResolvedValue({ pdf: bytes(4), sealed: true });
  loadExecuted.mockResolvedValue(null);
  storeExecuted.mockResolvedValue(true);
});

describe("getEnvelopeCopy", () => {
  it("serves the kept copy of a finished envelope without building or sealing again", async () => {
    loadExecuted.mockResolvedValue(bytes(9));
    const c = await getEnvelopeCopy(db(), "e1");
    expect(c).toMatchObject({ executed: true, kept: true, title: "NDA" });
    expect(Array.from(c!.pdf)).toEqual(Array.from(bytes(9)));
    expect(buildSigned).not.toHaveBeenCalled();
    expect(seal).not.toHaveBeenCalled();
  });

  it("builds, seals and keeps it the first time, and serves exactly what was kept", async () => {
    const c = await getEnvelopeCopy(db(), "e1");
    expect(seal).toHaveBeenCalledTimes(1);
    expect(storeExecuted).toHaveBeenCalledWith("e1", expect.any(Uint8Array));
    expect(Array.from(c!.pdf)).toEqual(Array.from(bytes(4)));
    expect(c).toMatchObject({ executed: true, kept: true });
  });

  it("gives everyone the same file when two builds race: the loser serves the winner's", async () => {
    storeExecuted.mockResolvedValue(false); // already kept by the other request
    loadExecuted.mockResolvedValueOnce(null).mockResolvedValueOnce(bytes(7));
    const c = await getEnvelopeCopy(db(), "e1");
    expect(Array.from(c!.pdf)).toEqual(Array.from(bytes(7)));
    expect(c!.kept).toBe(true);
  });

  it("does not keep a copy that should have been sealed but was not, so the next request tries again", async () => {
    seal.mockResolvedValue({ pdf: bytes(5), sealed: false });
    const c = await getEnvelopeCopy(db(), "e1");
    expect(storeExecuted).not.toHaveBeenCalled();
    expect(c).toMatchObject({ executed: true, kept: false });
    expect(Array.from(c!.pdf)).toEqual(Array.from(bytes(5)));
  });

  it("keeps an unsealed copy when no seal is configured at all", async () => {
    sealOn = false;
    seal.mockResolvedValue({ pdf: bytes(5), sealed: false });
    const c = await getEnvelopeCopy(db(), "e1");
    expect(storeExecuted).toHaveBeenCalled();
    expect(c!.kept).toBe(true);
  });

  it("builds a partly signed envelope fresh each time and never keeps it", async () => {
    status = "partially_signed";
    const c = await getEnvelopeCopy(db(), "e1");
    expect(c).toMatchObject({ executed: false, kept: false });
    expect(seal).not.toHaveBeenCalled();
    expect(loadExecuted).not.toHaveBeenCalled();
    expect(storeExecuted).not.toHaveBeenCalled();
  });

  it("is null when nothing has been signed", async () => {
    signedRecipients = false;
    status = "sent";
    expect(await getEnvelopeCopy(db(), "e1")).toBeNull();
  });
});

describe("optional signature spots", () => {
  const spot = (over: object) => ({ recipient_id: "r1", field_type: "signature", page: 1, x_pct: 10, y_pct: 10, width_pct: 28, height_pct: 4, response: null, required: true, ...over });

  it("stamps the signature at a required spot and at an optional spot the signer signed, but not at one left blank", async () => {
    fieldRows = [spot({ x_pct: 1 }), spot({ x_pct: 2, required: false, response: "signed" }), spot({ x_pct: 3, required: false, response: null })];
    await getEnvelopeCopy(db(), "e1");
    const stamped = stamp.mock.calls[0][1] as { xPct: number; signaturePng: string | null }[];
    expect(stamped.map((f) => [f.xPct, Boolean(f.signaturePng)])).toEqual([[1, true], [2, true], [3, false]]);
  });
});

describe("keepExecutedCopy", () => {
  it("builds and keeps the copy", async () => {
    await keepExecutedCopy(db(), "e1");
    expect(storeExecuted).toHaveBeenCalledTimes(1);
  });
});
