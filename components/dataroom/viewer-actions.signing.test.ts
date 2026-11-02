jest.mock("server-only", () => ({}), { virtual: true });
jest.mock("next/headers", () => ({ headers: async () => new Headers(), cookies: async () => ({ get: () => undefined, set: () => undefined }) }));
jest.mock("@/lib/supabase/server", () => ({ createServiceClient: () => ({ svc: true }), hasSupabaseServiceEnv: () => true }));

let access: Record<string, unknown> = { ok: false };
const resolveSharedDocument = jest.fn(async (..._a: unknown[]) => access);
jest.mock("@/lib/data-room-access.server", () => ({ resolveSharedDocument: (...a: unknown[]) => resolveSharedDocument(...a) }));

let pass: { email: string | null } | null = null;
const grantGate = jest.fn(async (..._a: unknown[]) => undefined);
jest.mock("@/lib/data-room-gate", () => ({ readGatePass: async () => pass, grantGate: (...a: unknown[]) => grantGate(...a) }));

const startReaderSigning = jest.fn(async (..._a: unknown[]) => ({ ok: true, state: "ready", title: "NDA", signingToken: "tok", blocks: [] }));
jest.mock("@/lib/room-signing.server", () => ({ startReaderSigning: (...a: unknown[]) => startReaderSigning(...a) }));

import { startRoomDocumentSigning } from "./viewer-actions";

const form = (o: Record<string, string>) => {
  const f = new FormData();
  for (const [k, v] of Object.entries(o)) f.set(k, v);
  return f;
};
const okAccess = {
  ok: true,
  signatureRequired: true,
  roomId: "room-1",
  doc: { id: "doc-1", name: "NDA", storage_key: "o/nda.pdf", content: null },
  share: { id: "share-1", organization_id: "org-1", created_by: "u1" },
};

beforeEach(() => {
  access = okAccess;
  pass = { email: "jane@lp.com" };
  jest.clearAllMocks();
});

describe("startRoomDocumentSigning", () => {
  it("opens the reader's own copy for a reader who could reach the file, under their gate email", async () => {
    const r = await startRoomDocumentSigning("tok", "doc-1", form({ signer_name: "  Jane   Smith " }));
    expect(r).toMatchObject({ ok: true, state: "ready", signingToken: "tok" });
    expect(resolveSharedDocument).toHaveBeenCalledWith("tok", "doc-1", { skipSignature: true });
    expect(startReaderSigning).toHaveBeenCalledWith(
      expect.anything(),
      expect.objectContaining({ readerName: "Jane Smith", readerEmail: "jane@lp.com", roomId: "room-1" }),
    );
    expect(grantGate).not.toHaveBeenCalled();
  });

  it("takes the email from the gate pass, never from the form, when there is one", async () => {
    await startRoomDocumentSigning("tok", "doc-1", form({ signer_name: "Jane", email: "someone-else@x.com" }));
    expect(startReaderSigning).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ readerEmail: "jane@lp.com" }));
  });

  it("asks for an email when the link has no email gate, and remembers it", async () => {
    pass = null;
    expect(await startRoomDocumentSigning("tok", "doc-1", form({ signer_name: "Jane" }))).toEqual({ ok: false, error: "Enter a valid email address." });
    expect(startReaderSigning).not.toHaveBeenCalled();
    await startRoomDocumentSigning("tok", "doc-1", form({ signer_name: "Jane", email: "jane@lp.com" }));
    expect(grantGate).toHaveBeenCalledWith("share-1", { email: "jane@lp.com" });
  });

  it("refuses a reader who cannot reach the file, and a file that needs no signature", async () => {
    access = { ok: false };
    expect((await startRoomDocumentSigning("tok", "doc-1", form({ signer_name: "Jane" }))).ok).toBe(false);
    access = { ...okAccess, signatureRequired: false };
    expect((await startRoomDocumentSigning("tok", "doc-1", form({ signer_name: "Jane" }))).ok).toBe(false);
    expect(startReaderSigning).not.toHaveBeenCalled();
  });

  it("needs a name", async () => {
    expect(await startRoomDocumentSigning("tok", "doc-1", form({ signer_name: "  " }))).toEqual({ ok: false, error: "Type your full name to continue." });
    expect(await startRoomDocumentSigning("tok", "doc-1", form({ signer_name: "x".repeat(121) }))).toEqual({ ok: false, error: "That name is too long." });
  });
});
