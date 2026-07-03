// Coverage for the diligence error-handling fix: these four used to be
// `Promise<void>` with their Supabase write unchecked — a failed
// insert/update looked identical to success in the UI. They now return
// {ok, error}, and their call sites (DiligenceTemplatePicker.tsx,
// DiligenceDealGroup.tsx) use the shared ActionForm wrapper to surface a
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

import {
  applyDiligenceTemplate,
  updateDiligenceFinding,
  setDiligenceOwnerDue,
  bulkUpdateDiligence,
} from "./diligence-actions";

function formData(fields: Record<string, string | string[]>): FormData {
  const fd = new FormData();
  for (const [k, v] of Object.entries(fields)) {
    if (Array.isArray(v)) v.forEach((item) => fd.append(k, item));
    else fd.set(k, v);
  }
  return fd;
}

// A tiny chainable query-builder stub: .select/.insert/.update/.eq/.in all
// chain, and the chain resolves via the thenable protocol to a pre-set
// {data, error} pair.
function makeFromStub(result: { data?: unknown; error?: { message: string } | null } = {}) {
  return () => {
    const builder: Record<string, unknown> = {
      select: () => builder,
      insert: () => builder,
      update: () => builder,
      eq: () => builder,
      in: () => builder,
      then: (onFulfilled: (v: unknown) => unknown) =>
        Promise.resolve({ data: result.data ?? null, error: result.error ?? null }).then(onFulfilled),
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

describe("applyDiligenceTemplate", () => {
  it("rejects when there's no active org, without touching the DB", async () => {
    getSessionContext.mockResolvedValue(null);
    const result = await applyDiligenceTemplate(formData({ deal_id: "d1" }));
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("rejects a missing deal before any DB call", async () => {
    const result = await applyDiligenceTemplate(formData({ deal_id: "" }));
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces an insert error as {ok:false} instead of silently succeeding", async () => {
    from.mockImplementation(makeFromStub({ data: [], error: { message: "insert failed" } }));
    const result = await applyDiligenceTemplate(formData({ deal_id: "d1", category: "legal" }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("insert failed");
  });
});

describe("updateDiligenceFinding", () => {
  it("rejects a missing id before any DB call", async () => {
    const result = await updateDiligenceFinding(formData({ deal_id: "d1", finding: "note" }));
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces an update error as {ok:false} instead of silently succeeding", async () => {
    from.mockImplementation(makeFromStub({ error: { message: "update failed" } }));
    const result = await updateDiligenceFinding(formData({ id: "item-1", deal_id: "d1", finding: "note" }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("update failed");
  });

  it("returns ok on success", async () => {
    const result = await updateDiligenceFinding(formData({ id: "item-1", deal_id: "d1", finding: "note" }));
    expect(result).toEqual({ ok: true });
  });
});

describe("setDiligenceOwnerDue", () => {
  it("rejects a missing id before any DB call", async () => {
    const result = await setDiligenceOwnerDue(formData({ deal_id: "d1", owner: "Jane" }));
    expect(result.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces an update error as {ok:false} instead of silently succeeding", async () => {
    from.mockImplementation(makeFromStub({ error: { message: "update failed" } }));
    const result = await setDiligenceOwnerDue(formData({ id: "item-1", deal_id: "d1", owner: "Jane" }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("update failed");
  });
});

describe("bulkUpdateDiligence", () => {
  it("rejects an empty selection or invalid status before any DB call", async () => {
    const noIds = await bulkUpdateDiligence(formData({ ids: [], status: "cleared" }));
    expect(noIds.ok).toBe(false);
    const badStatus = await bulkUpdateDiligence(formData({ ids: ["item-1"], status: "bogus" }));
    expect(badStatus.ok).toBe(false);
    expect(from).not.toHaveBeenCalled();
  });

  it("surfaces an update error as {ok:false} instead of silently succeeding", async () => {
    from.mockImplementation(makeFromStub({ error: { message: "update failed" } }));
    const result = await bulkUpdateDiligence(formData({ ids: ["item-1", "item-2"], status: "cleared" }));
    expect(result.ok).toBe(false);
    expect(result.error).toContain("update failed");
  });

  it("returns ok and re-snapshots every distinct touched deal on success", async () => {
    from.mockImplementation(makeFromStub({ data: [{ deal_id: "d1" }, { deal_id: "d2" }, { deal_id: "d1" }] }));
    const result = await bulkUpdateDiligence(formData({ ids: ["item-1", "item-2", "item-3"], status: "cleared" }));
    expect(result).toEqual({ ok: true });
    expect(recordConvictionSnapshot).toHaveBeenCalledTimes(2);
  });
});
