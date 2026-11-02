jest.mock("server-only", () => ({}), { virtual: true });
const requireOrgContext = jest.fn();
const countersignDocument = jest.fn();
const afterDocumentCountersigned = jest.fn(async () => undefined);
let owned: unknown = { id: "x" };
jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));
jest.mock("next/server", () => ({ after: (fn: () => unknown) => void fn() }));
jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("@/lib/document-signing.server", () => ({
  countersignDocument: (...a: unknown[]) => countersignDocument(...a),
  afterDocumentCountersigned: (...a: unknown[]) => afterDocumentCountersigned(...(a as [])),
}));
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({ svc: true }),
  createServerClient: async () => {
    const q: Record<string, unknown> = { select: () => q, eq: () => q, maybeSingle: async () => ({ data: owned }) };
    return { from: () => q };
  },
}));

import { countersignRoomDocumentAction } from "./countersign-room-actions";

const SIG = "00000000-0000-4000-8000-0000000000b1";
const member = (over: object = {}) => ({
  ok: true,
  ctx: { orgId: "o1", userId: "u1", role: "admin", email: "a@fund.com", emailConfirmed: true, ...over },
});

beforeEach(() => {
  jest.clearAllMocks();
  owned = { id: SIG };
  requireOrgContext.mockResolvedValue(member());
  countersignDocument.mockResolvedValue({ ok: true, signatureId: SIG });
});

describe("countersignRoomDocumentAction", () => {
  it("counter-signs as the signed-in member's confirmed email, then sends the executed copy", async () => {
    expect(await countersignRoomDocumentAction(SIG, "Fund Admin", "png", true)).toEqual({ ok: true });
    expect(countersignDocument).toHaveBeenCalledWith(
      { svc: true },
      expect.objectContaining({ orgId: "o1", signatureId: SIG, signerEmail: "a@fund.com", userId: "u1" }),
    );
    expect(afterDocumentCountersigned).toHaveBeenCalledWith({ svc: true }, SIG);
  });

  it("refuses a session that has not passed the second factor", async () => {
    requireOrgContext.mockResolvedValue({ ok: false, status: 403, error: "Multi-factor authentication required" });
    expect((await countersignRoomDocumentAction(SIG, "A", "png", true)).ok).toBe(false);
    expect(countersignDocument).not.toHaveBeenCalled();
  });

  it("refuses members who are not an owner or admin", async () => {
    requireOrgContext.mockResolvedValue(member({ role: "member" }));
    const r = await countersignRoomDocumentAction(SIG, "A", "png", true);
    expect(r).toEqual({ ok: false, error: "Only an owner or admin can counter-sign." });
    expect(countersignDocument).not.toHaveBeenCalled();
  });

  it("refuses an unconfirmed email", async () => {
    requireOrgContext.mockResolvedValue(member({ emailConfirmed: false }));
    expect((await countersignRoomDocumentAction(SIG, "A", "png", true)).ok).toBe(false);
    expect(countersignDocument).not.toHaveBeenCalled();
  });

  it("refuses a signature that is not in the member's organisation, or not an id", async () => {
    owned = null;
    expect((await countersignRoomDocumentAction(SIG, "A", "png", true)).ok).toBe(false);
    expect((await countersignRoomDocumentAction("nope", "A", "png", true)).ok).toBe(false);
    expect(countersignDocument).not.toHaveBeenCalled();
  });

  it("passes on the reason when it was already counter-signed, and sends no email", async () => {
    countersignDocument.mockResolvedValue({ ok: false, error: "This has already been counter-signed." });
    expect(await countersignRoomDocumentAction(SIG, "A", "png", true)).toEqual({ ok: false, error: "This has already been counter-signed." });
    expect(afterDocumentCountersigned).not.toHaveBeenCalled();
  });
});
