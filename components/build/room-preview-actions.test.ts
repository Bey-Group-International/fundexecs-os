jest.mock("server-only", () => ({}), { virtual: true });
const requireOrgContext = jest.fn();
const buildViewerPayload = jest.fn();
jest.mock("@/lib/auth", () => ({ requireOrgContext: () => requireOrgContext() }));
jest.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({}) }));
jest.mock("@/lib/data-room-viewer.server", () => ({ buildViewerPayload: (...a: unknown[]) => buildViewerPayload(...a) }));

import { loadRoomPreview } from "./room-preview-actions";
import { DataRoomReadError } from "@/lib/data-room-errors";

const ROOM = "00000000-0000-4000-8000-0000000000a1";

beforeEach(() => {
  jest.clearAllMocks();
  jest.spyOn(console, "error").mockImplementation(() => undefined);
});

describe("loadRoomPreview", () => {
  it("builds the preview for the caller's own organisation, with no section allowlist", async () => {
    requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org-1" } });
    buildViewerPayload.mockResolvedValue({ org: { name: "Alpha" } });
    expect(await loadRoomPreview(ROOM)).toEqual({ org: { name: "Alpha" } });
    expect(buildViewerPayload).toHaveBeenCalledWith({}, "org-1", ROOM, null);
  });

  it("gives nothing to a session that has not passed the second factor, or is not signed in", async () => {
    requireOrgContext.mockResolvedValue({ ok: false, status: 403, error: "Multi-factor authentication required" });
    expect(await loadRoomPreview(ROOM)).toBeNull();
    requireOrgContext.mockResolvedValue({ ok: false, status: 401, error: "Not authenticated" });
    expect(await loadRoomPreview(ROOM)).toBeNull();
    expect(buildViewerPayload).not.toHaveBeenCalled();
  });

  it("rejects an id that is not a room id before touching the database", async () => {
    requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org-1" } });
    expect(await loadRoomPreview("not-a-uuid")).toBeNull();
    expect(buildViewerPayload).not.toHaveBeenCalled();
  });

  it("answers null when a read failed, and lets any other error through", async () => {
    requireOrgContext.mockResolvedValue({ ok: true, ctx: { orgId: "org-1" } });
    buildViewerPayload.mockRejectedValueOnce(new DataRoomReadError("manifest", { message: "x", code: "08006" }));
    expect(await loadRoomPreview(ROOM)).toBeNull();
    buildViewerPayload.mockRejectedValueOnce(new Error("a bug"));
    await expect(loadRoomPreview(ROOM)).rejects.toThrow("a bug");
  });
});
