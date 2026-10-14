/**
 * Inbox files on the server: the upload ticket, the org fence on every file,
 * the attach-or-link split at send time, and data-room links.
 */
jest.mock("server-only", () => ({}), { virtual: true });

const createSignedUploadUrl = jest.fn();
const download = jest.fn();
const createSignedUrl = jest.fn();
let docRows: Array<Record<string, unknown>> = [];
const fromBuckets: string[] = [];

jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({
    storage: {
      from: (bucket: string) => {
        fromBuckets.push(bucket);
        return {
          createSignedUploadUrl: (...a: unknown[]) => createSignedUploadUrl(...a),
          download: (...a: unknown[]) => download(bucket, ...a),
          createSignedUrl: (...a: unknown[]) => createSignedUrl(bucket, ...a),
        };
      },
    },
    from: () => {
      const b: Record<string, unknown> = {
        select: () => b,
        eq: () => b,
        in: () => Promise.resolve({ data: docRows, error: null }),
      };
      return b;
    },
  }),
}));
jest.mock("@/lib/document-files", () => ({
  DOCUMENT_BUCKET: "documents",
  isUploadedFile: (k: string | null) => Boolean(k && k.startsWith("org-1/")),
}));
jest.mock("@/lib/email", () => ({ MAX_ATTACHMENT_BYTES: 100 }));
const insertShare = jest.fn();
jest.mock("@/lib/data-room-shares.server", () => ({
  insertShare: (...a: unknown[]) => insertShare(...a),
  shareUrl: (t: string) => `https://app.test/s/${t}`,
}));
const loadMeetingDocs = jest.fn();
jest.mock("@/lib/meetings/doc-share.server", () => ({ loadMeetingDocs: (...a: unknown[]) => loadMeetingDocs(...a) }));

import { createAttachmentTicket, mintRoomLink, prepareOutgoingFiles } from "./attachments.server";
import type { AttachmentRef } from "./attachments";

const ORG = "org-1";
const ID = "123e4567-e89b-12d3-a456-426614174000";

function blob(bytes: number) {
  return { arrayBuffer: async () => new Uint8Array(bytes).buffer };
}

function upload(name: string, size: number, org = ORG): AttachmentRef {
  return { kind: "upload", path: `${org}/${ID}/${name}`, name, size, mimeType: "application/pdf" };
}

beforeEach(() => {
  jest.clearAllMocks();
  docRows = [];
  fromBuckets.length = 0;
  createSignedUploadUrl.mockResolvedValue({ data: { token: "tok", signedUrl: "https://s/up" }, error: null });
  createSignedUrl.mockImplementation(async (bucket: string, path: string) => ({
    data: { signedUrl: `https://s/${bucket}/${path}?dl` },
  }));
});

describe("createAttachmentTicket", () => {
  it("issues a signed upload under the org's prefix", async () => {
    const t = await createAttachmentTicket(ORG, { name: "Deck.pdf", size: 1000 });
    expect(t).toMatchObject({ ok: true, token: "tok", signedUrl: "https://s/up" });
    expect(t.ok && t.path.startsWith(`${ORG}/`)).toBe(true);
    expect(fromBuckets).toEqual(["inbox-attachments"]);
  });

  it("refuses empty, unnamed and oversize files", async () => {
    expect(await createAttachmentTicket(ORG, { name: "a", size: 0 })).toMatchObject({ ok: false });
    expect(await createAttachmentTicket(ORG, { name: " ", size: 5 })).toMatchObject({ ok: false });
    expect(await createAttachmentTicket(ORG, { name: "a", size: 101 * 1024 * 1024 })).toMatchObject({
      ok: false,
      error: expect.stringContaining("data room link"),
    });
    expect(createSignedUploadUrl).not.toHaveBeenCalled();
  });
});

describe("prepareOutgoingFiles", () => {
  it("attaches what fits and links the rest", async () => {
    download.mockImplementation(async (_b: string, path: string) => ({
      data: blob(path.endsWith("small.pdf") ? 30 : 80),
      error: null,
    }));
    const out = await prepareOutgoingFiles(ORG, [upload("big.pdf", 80), upload("small.pdf", 30)]);
    expect(out.missing).toEqual([]);
    expect(out.attachments.map((a) => a.filename)).toEqual(["small.pdf"]);
    expect(out.links).toEqual([{ name: "big.pdf", size: 80, url: expect.stringContaining("big.pdf") }]);
    expect(out.sent).toEqual([
      { name: "small.pdf", size: 30, delivery: "attached" },
      { name: "big.pdf", size: 80, delivery: "link" },
    ]);
    // The link downloads under the file's own name.
    expect(createSignedUrl).toHaveBeenCalledWith("inbox-attachments", `${ORG}/${ID}/big.pdf`, 7 * 86_400, { download: "big.pdf" });
  });

  it("trusts the bytes, not the size the composer claimed", async () => {
    // Claimed tiny, actually over the limit: it goes as a link.
    download.mockResolvedValue({ data: blob(150), error: null });
    const out = await prepareOutgoingFiles(ORG, [upload("liar.pdf", 1)]);
    expect(out.attachments).toEqual([]);
    expect(out.sent).toEqual([{ name: "liar.pdf", size: 150, delivery: "link" }]);
  });

  it("links a file it could not download", async () => {
    download.mockResolvedValue({ data: null, error: { message: "nope" } });
    const out = await prepareOutgoingFiles(ORG, [upload("a.pdf", 10)]);
    expect(out.attachments).toEqual([]);
    expect(out.sent[0].delivery).toBe("link");
  });

  it("will not read another org's upload", async () => {
    const out = await prepareOutgoingFiles(ORG, [upload("x.pdf", 10, "org-2")]);
    expect(out.missing).toEqual(["x.pdf"]);
    expect(download).not.toHaveBeenCalled();
  });

  it("reads a library document from its own bucket, and only the org's", async () => {
    docRows = [{ id: "d1", name: "Memo.pdf", storage_key: "org-1/d1/memo.pdf", mime_type: "application/pdf", size_bytes: 20 }];
    download.mockResolvedValue({ data: blob(20), error: null });
    const out = await prepareOutgoingFiles(ORG, [
      { kind: "document", documentId: "d1", name: "Memo.pdf", size: 20, mimeType: "application/pdf" },
      { kind: "document", documentId: "d-other", name: "Theirs.pdf", size: 20, mimeType: "application/pdf" },
    ]);
    expect(download).toHaveBeenCalledWith("documents", "org-1/d1/memo.pdf");
    expect(out.attachments.map((a) => a.filename)).toEqual(["Memo.pdf"]);
    expect(out.missing).toEqual(["Theirs.pdf"]);
  });
});

describe("mintRoomLink", () => {
  const DOC = { id: "d1", name: "Deck.pdf", roomId: "r1", roomName: "Fund II", blocked: false };

  it("mints a gated, watermarked link to a room document", async () => {
    loadMeetingDocs.mockResolvedValue({ docs: [DOC] });
    insertShare.mockResolvedValue({ token: "abc" });
    const r = await mintRoomLink({} as never, { orgId: ORG, userId: "u1", documentId: "d1", label: "Inbox: Ana" });
    expect(r).toEqual({ ok: true, url: "https://app.test/s/abc", name: "Deck.pdf" });
    expect(insertShare.mock.calls[0][1]).toMatchObject({
      roomId: "r1",
      documentId: "d1",
      requireEmail: true,
      watermark: true,
      expiresInDays: 14,
    });
  });

  it("refuses a document that is blocked or not in a room", async () => {
    loadMeetingDocs.mockResolvedValue({ docs: [{ ...DOC, blocked: true }] });
    expect(await mintRoomLink({} as never, { orgId: ORG, userId: "u1", documentId: "d1", label: "x" })).toMatchObject({ ok: false });
    expect(insertShare).not.toHaveBeenCalled();
  });

  it("says so when the share cannot be written", async () => {
    loadMeetingDocs.mockResolvedValue({ docs: [DOC] });
    insertShare.mockResolvedValue(null);
    expect(await mintRoomLink({} as never, { orgId: ORG, userId: "u1", documentId: "d1", label: "x" })).toMatchObject({
      ok: false,
      error: expect.stringContaining("permission"),
    });
  });
});
