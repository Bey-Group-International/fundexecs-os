/** The composer's file actions: who may call them, and what they hand on. */
const requireOrgContext = jest.fn();
const checkRateLimit = jest.fn();
const createAttachmentTicket = jest.fn();
const listAttachableDocuments = jest.fn();
const listRoomDocuments = jest.fn();
const mintRoomLink = jest.fn();
let thread: Record<string, unknown> | null = null;

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("@/lib/rate-limit", () => ({ checkRateLimit: (...a: unknown[]) => checkRateLimit(...a) }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: () => {
      const b: Record<string, unknown> = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: thread }) };
      return b;
    },
  }),
}));
jest.mock("@/lib/inbox/attachments.server", () => ({
  createAttachmentTicket: (...a: unknown[]) => createAttachmentTicket(...a),
  listAttachableDocuments: (...a: unknown[]) => listAttachableDocuments(...a),
  listRoomDocuments: (...a: unknown[]) => listRoomDocuments(...a),
  mintRoomLink: (...a: unknown[]) => mintRoomLink(...a),
}));

import { createInboxRoomLink, listInboxDocuments, requestAttachmentUpload } from "./attachment-actions";

beforeEach(() => {
  jest.clearAllMocks();
  thread = { counterparty_name: "Ana Diaz", counterparty_email: "ana@acme.com", subject: "Sync" };
  requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org-1", userId: "u1" } });
  checkRateLimit.mockReturnValue({ ok: true });
  createAttachmentTicket.mockResolvedValue({ ok: true, path: "p", token: "t", signedUrl: "u" });
});

describe("requestAttachmentUpload", () => {
  it("issues a ticket for the caller's org", async () => {
    expect(await requestAttachmentUpload({ name: "a.pdf", size: 5 })).toMatchObject({ ok: true });
    expect(createAttachmentTicket).toHaveBeenCalledWith("org-1", { name: "a.pdf", size: 5 });
  });

  it("refuses the signed-out and the rate-limited", async () => {
    requireOrgContext.mockResolvedValueOnce({ ok: false });
    expect(await requestAttachmentUpload({ name: "a", size: 1 })).toMatchObject({ ok: false });
    checkRateLimit.mockReturnValueOnce({ ok: false });
    expect(await requestAttachmentUpload({ name: "a", size: 1 })).toMatchObject({ ok: false, error: expect.stringMatching(/Too many/) });
    expect(createAttachmentTicket).not.toHaveBeenCalled();
  });
});

describe("listInboxDocuments", () => {
  it("returns the library and the room documents, empty on failure", async () => {
    listAttachableDocuments.mockResolvedValue([{ id: "d1" }]);
    listRoomDocuments.mockRejectedValue(new Error("down"));
    expect(await listInboxDocuments()).toEqual({ library: [{ id: "d1" }], rooms: [] });
  });
});

describe("createInboxRoomLink", () => {
  it("labels the link with who it is for", async () => {
    mintRoomLink.mockResolvedValue({ ok: true, url: "https://x", name: "Deck" });
    expect(await createInboxRoomLink("t1", "d1")).toEqual({ ok: true, url: "https://x", name: "Deck" });
    expect(mintRoomLink).toHaveBeenCalledWith(expect.anything(), {
      orgId: "org-1",
      userId: "u1",
      documentId: "d1",
      label: "Inbox: Ana Diaz",
    });
  });

  it("refuses a thread outside the org", async () => {
    thread = null;
    expect(await createInboxRoomLink("t-other", "d1")).toMatchObject({ ok: false });
    expect(mintRoomLink).not.toHaveBeenCalled();
  });
});
