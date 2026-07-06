// Regression coverage for the outreach_sequences insert. The table carries a
// NOT NULL organization_id (migration 0060) alongside the cadence schema's
// org_id — createSequence must set BOTH or the insert fails. This guards the
// "Enroll ready" path (prospect-enrollment → createSequence).

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: jest.fn(),
  createServerClient: jest.fn(),
}));

import { createSequence } from "@/lib/outreach-sequences";
import { createServiceClient } from "@/lib/supabase/server";

type Captured = { table: string; payload: Record<string, unknown> } | null;

function makeClient(capture: { last: Captured }) {
  const builder = (table: string) => {
    const b = {
      insert: (payload: Record<string, unknown>) => {
        capture.last = { table, payload };
        return b;
      },
      select: () => b,
      single: async () => ({ data: { id: "seq-1", ...capture.last?.payload }, error: null }),
    };
    return b;
  };
  return { from: (t: string) => builder(t) };
}

describe("createSequence", () => {
  it("sets both org_id and organization_id (the NOT NULL column)", async () => {
    const capture: { last: Captured } = { last: null };
    (createServiceClient as jest.Mock).mockReturnValue(makeClient(capture));

    await createSequence({
      org_id: "org-123",
      name: "Test cadence",
      steps: [],
      stop_on_reply: true,
      active: true,
    });

    expect(capture.last?.table).toBe("outreach_sequences");
    expect(capture.last?.payload.org_id).toBe("org-123");
    expect(capture.last?.payload.organization_id).toBe("org-123");
  });
});
