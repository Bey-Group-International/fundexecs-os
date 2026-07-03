// Coverage for the underwriting error-handling fix: these three used to be
// `Promise<void>` with their Supabase write unchecked. They now return
// {ok, error}, and their call sites (RunUnderwritingModule.tsx,
// UnderwritingCalculator.tsx) use the shared ActionForm wrapper to surface a
// failure inline instead of silently doing nothing.

jest.mock("next/cache", () => ({ revalidatePath: jest.fn() }));

const getSessionContext = jest.fn();
jest.mock("@/lib/auth", () => ({ getSessionContext: (...a: unknown[]) => getSessionContext(...a) }));

const recordConvictionSnapshot = jest.fn();
jest.mock("@/lib/run-war-room", () => ({
  recordConvictionSnapshot: (...a: unknown[]) => recordConvictionSnapshot(...a),
}));

const from = jest.fn();
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ from: (...a: unknown[]) => from(...a) }),
}));

import { setUnderwritingProbability, saveUnderwritingInputs, setUnderwritingEquity } from "./underwriting-actions";

function formData(fields: Record<string, string>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) fd.set(k, v);
  return fd;
}

// loadCase does .select(...).eq(...).eq(...).maybeSingle(); the mutating
// update does .update(...).eq(...).eq(...) resolving via the thenable
// protocol. One stub serves both shapes.
function makeFromStub(opts: { caseRow?: unknown; updateError?: { message: string } | null } = {}) {
  const caseRow = "caseRow" in opts ? opts.caseRow : { id: "uw-1", deal_id: "d1", model: null };
  return () => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      update: () => builder,
      eq: () => builder,
      maybeSingle: async () => ({ data: caseRow, error: null }),
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ error: opts.updateError ?? null }).then(onFulfilled),
    };
    return builder;
  };
}

beforeEach(() => {
  jest.clearAllMocks();
  getSessionContext.mockResolvedValue({ orgId: "org-1", userId: "user-1" });
  recordConvictionSnapshot.mockResolvedValue(undefined);
  from.mockImplementation(makeFromStub());
});

describe("setUnderwritingProbability", () => {
  it("rejects when there's no active org, without touching the DB", async () => {
    getSessionContext.mockResolvedValue(null);
    const result = await setUnderwritingProbability(formData({ id: "uw-1", probability: "0.5" }));
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a missing id or probability before any DB call", async () => {
    const missingId = await setUnderwritingProbability(formData({ probability: "0.5" }));
    expect(missingId.ok).toBe(false);
    const missingProb = await setUnderwritingProbability(formData({ id: "uw-1" }));
    expect(missingProb.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects when the case can't be found for this org", async () => {
    from.mockImplementation(makeFromStub({ caseRow: null }));
    const result = await setUnderwritingProbability(formData({ id: "uw-1", probability: "0.5" }));
    expect(result.ok).toBe(false);
  });

  it("surfaces an update error as {ok:false} instead of silently succeeding", async () => {
    from.mockImplementation(makeFromStub({ updateError: { message: "update failed" } }));
    const result = await setUnderwritingProbability(formData({ id: "uw-1", probability: "0.5" }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("update failed");
    expect(recordConvictionSnapshot).not.toHaveBeenCalled();
  });

  it("clamps out-of-range probabilities and returns ok on success", async () => {
    const result = await setUnderwritingProbability(formData({ id: "uw-1", probability: "1.5" }));
    expect(result).toEqual({ ok: true });
    expect(recordConvictionSnapshot).toHaveBeenCalledWith(expect.anything(), "org-1", "d1");
  });
});

describe("setUnderwritingEquity", () => {
  it("rejects a missing id before any DB call", async () => {
    const result = await setUnderwritingEquity(formData({ equity_required: "500000" }));
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces an update error as {ok:false} instead of silently succeeding", async () => {
    from.mockImplementation(makeFromStub({ updateError: { message: "update failed" } }));
    const result = await setUnderwritingEquity(formData({ id: "uw-1", equity_required: "500000" }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("update failed");
  });

  it("returns ok on success", async () => {
    const result = await setUnderwritingEquity(formData({ id: "uw-1", equity_required: "500000" }));
    expect(result).toEqual({ ok: true });
  });
});

describe("saveUnderwritingInputs", () => {
  it("rejects a missing id before any DB call", async () => {
    const result = await saveUnderwritingInputs(formData({ equity: "1000000" }));
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces an update error as {ok:false} instead of silently succeeding", async () => {
    from.mockImplementation(makeFromStub({ updateError: { message: "update failed" } }));
    const result = await saveUnderwritingInputs(formData({ id: "uw-1", equity: "1000000", holdYears: "5", exitMultiple: "3" }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("update failed");
  });

  it("returns ok on success", async () => {
    const result = await saveUnderwritingInputs(formData({ id: "uw-1", equity: "1000000", holdYears: "5", exitMultiple: "3" }));
    expect(result).toEqual({ ok: true });
  });
});
