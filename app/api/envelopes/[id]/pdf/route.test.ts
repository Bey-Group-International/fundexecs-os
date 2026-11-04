jest.mock("server-only", () => ({}), { virtual: true });

let row: { pdf_storage_key: string | null; document_sha256: string | null } | null;
let user: { id: string } | null;
const load = jest.fn(async () => new Uint8Array([0x25, 0x50, 0x44, 0x46, 0x2d, 1, 2, 3, 4, 5]));
jest.mock("@/lib/envelope-pdf.server", () => ({ loadEnvelopePdf: (...a: unknown[]) => (load as (...x: unknown[]) => unknown)(...a) }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    auth: { getUser: async () => ({ data: { user } }) },
    from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: row }) }) }) }),
  }),
}));

import { GET } from "./route";

const ID = "11111111-1111-4111-8111-111111111111";
const call = (headers: Record<string, string> = {}) => GET(new Request("http://x/pdf", { headers }), { params: Promise.resolve({ id: ID }) });

beforeEach(() => {
  user = { id: "u" };
  row = { pdf_storage_key: "envelopes/e.pdf", document_sha256: "a".repeat(64) };
  load.mockClear();
});

describe("GET /api/envelopes/[id]/pdf", () => {
  it("sends the document with a fingerprint the browser can ask about", async () => {
    const res = await call();
    expect(res.status).toBe(200);
    expect(res.headers.get("ETag")).toBe(`"${"a".repeat(64)}"`);
    expect(res.headers.get("Cache-Control")).toBe("private, no-cache");
    expect(load).toHaveBeenCalledTimes(1);
  });

  it("answers 'unchanged' without reading the file from storage", async () => {
    const res = await call({ "if-none-match": `"${"a".repeat(64)}"` });
    expect(res.status).toBe(304);
    expect(load).not.toHaveBeenCalled();
  });

  it("sends the file again when the fingerprint changed", async () => {
    const res = await call({ "if-none-match": `"${"b".repeat(64)}"` });
    expect(res.status).toBe(200);
    expect(load).toHaveBeenCalled();
  });

  it("keeps nothing for a file with no fingerprint", async () => {
    row = { pdf_storage_key: "envelopes/e.pdf", document_sha256: null };
    const res = await call({ "if-none-match": '"anything"' });
    expect(res.status).toBe(200);
    expect(res.headers.get("Cache-Control")).toBe("private, no-store");
    expect(res.headers.get("ETag")).toBeNull();
  });

  it("is closed to anyone not signed in, and to an unknown envelope", async () => {
    user = null;
    expect((await call()).status).toBe(401);
    user = { id: "u" };
    row = null;
    expect((await call()).status).toBe(404);
  });
});
