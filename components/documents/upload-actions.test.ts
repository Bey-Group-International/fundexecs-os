/**
 * The plan limit is enforced on the server, twice: when a ticket is minted
 * (against the size the browser claims) and at finalize (against the size
 * Storage actually holds). The second is what stops a free org from claiming
 * 1 MB and sending 40.
 */
jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/server", () => ({ after: jest.fn() }));
jest.mock("@/lib/auth", () => ({
  getSessionContext: async () => ({ userId: "u1", orgId: "org1", role: "owner", email: "", emailConfirmed: true }),
}));

let paid = false;
jest.mock("@/lib/document-upload-allowance.server", () => ({
  uploadAllowanceFor: async () => jest.requireActual("@/lib/document-files").uploadAllowance(paid),
}));

const storedSize = { value: 0 };
const removed: string[][] = [];
jest.mock("@/lib/document-storage.server", () => ({
  statDocumentObject: async () => ({ size: storedSize.value, mimeType: "application/pdf" }),
  removeDocumentObjects: async (paths: string[]) => {
    removed.push(paths);
  },
}));
jest.mock("@/lib/document-text.server", () => ({ extractAndStoreDocumentText: jest.fn() }));

const DOC = "11111111-1111-1111-1111-111111111111";
const updates: unknown[] = [];
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServerClient: async () => ({
    from: () => {
      const q = {
        select: () => q,
        eq: () => q,
        insert: () => q,
        maybeSingle: async () => ({ data: { id: DOC, name: "PPM", storage_key: null, content: null } }),
        update: (v: unknown) => {
          updates.push(v);
          return { eq: () => ({ eq: async () => ({ error: null }) }) };
        },
      };
      return q;
    },
  }),
}));

import { createUploadTicket, finalizeUpload } from "./upload-actions";

const MB = 1024 * 1024;
const PATH = `org1/${DOC}/22222222-2222-2222-2222-222222222222.pdf`;

beforeEach(() => {
  paid = false;
  removed.length = 0;
  updates.length = 0;
});

describe("createUploadTicket", () => {
  it("refuses a free org a file over 10 MB, flagged as an upgrade", async () => {
    const res = await createUploadTicket({ section: "other", fileName: "PPM.pdf", size: 20 * MB });
    expect(res).toMatchObject({ ok: false, upgrade: true });
  });

  it("mints a ticket for the same file on a paid plan", async () => {
    paid = true;
    const res = await createUploadTicket({ section: "other", fileName: "PPM.pdf", size: 20 * MB });
    expect(res.ok).toBe(true);
  });
});

describe("finalizeUpload", () => {
  it("deletes an over-plan object a free org slipped past the ticket, and attaches nothing", async () => {
    storedSize.value = 40 * MB;
    const res = await finalizeUpload({ documentId: DOC, path: PATH });
    expect(res).toMatchObject({ ok: false, upgrade: true });
    expect(removed).toEqual([[PATH]]);
    expect(updates).toEqual([]);
  });

  it("attaches the same object for a paid org", async () => {
    paid = true;
    storedSize.value = 40 * MB;
    const res = await finalizeUpload({ documentId: DOC, path: PATH });
    expect(res).toEqual({ ok: true });
    expect(removed).toEqual([]);
  });
});
