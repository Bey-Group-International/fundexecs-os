// Coverage for the artifact-verification honesty fix's server-action wrapper:
// verifyArtifact (components/copilot/actions.ts) is the only entry point the
// UI (components/ArtifactViewer.tsx's ProvenanceBar) can call to sign off on
// a deliverable — it must resolve org context itself and delegate to the
// engine's per-artifact verifyArtifact, never a bulk/plan-approval path.

jest.mock("@/lib/auth", () => ({ getSessionContext: jest.fn() }));

const verifyArtifactEngine = jest.fn();
jest.mock("@/lib/engine", () => ({
  handlePrompt: jest.fn(),
  decideApproval: jest.fn(),
  verifyArtifact: (...a: unknown[]) => verifyArtifactEngine(...a),
}));

jest.mock("@/lib/supabase/server", () => ({ createServerClient: () => ({}) }));

import { getSessionContext } from "@/lib/auth";
import { verifyArtifact } from "./actions";

const mockGetSessionContext = getSessionContext as jest.Mock;

beforeEach(() => {
  jest.clearAllMocks();
  mockGetSessionContext.mockResolvedValue({ orgId: "org-1", userId: "user-1" });
});

describe("verifyArtifact (server action)", () => {
  it("rejects when there's no active org, without calling the engine", async () => {
    mockGetSessionContext.mockResolvedValue(null);
    const result = await verifyArtifact("art-1", "note");
    expect(result.ok).toBe(false);
    expect(verifyArtifactEngine).not.toHaveBeenCalled();
  });

  it("rejects a missing artifact id before calling the engine", async () => {
    const result = await verifyArtifact("", "note");
    expect(result.ok).toBe(false);
    expect(verifyArtifactEngine).not.toHaveBeenCalled();
  });

  it("delegates to the engine's per-artifact verifyArtifact with the org context", async () => {
    verifyArtifactEngine.mockResolvedValue({ ok: true });
    const result = await verifyArtifact("art-1", "Confirmed accurate");
    expect(result).toEqual({ ok: true });
    expect(verifyArtifactEngine).toHaveBeenCalledWith(
      expect.objectContaining({ orgId: "org-1", actorId: "user-1" }),
      "art-1",
      "Confirmed accurate",
    );
  });

  it("defaults to a generic note when none is given", async () => {
    verifyArtifactEngine.mockResolvedValue({ ok: true });
    await verifyArtifact("art-1");
    expect(verifyArtifactEngine).toHaveBeenCalledWith(expect.anything(), "art-1", "Verified by operator");
  });

  it("surfaces an engine error instead of silently succeeding", async () => {
    verifyArtifactEngine.mockResolvedValue({ ok: false, error: "Artifact not found." });
    const result = await verifyArtifact("art-1", "note");
    expect(result).toEqual({ ok: false, error: "Artifact not found." });
  });
});
