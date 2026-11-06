// Editing a bookable meeting type: the booking questions are cleaned before
// they are stored, and their column arriving after this code reads as "not
// yet", not as a database error.
const authMock = jest.fn();
const updateMock = jest.fn();
let result: { data: unknown; error: { code?: string; message: string } | null } = { data: null, error: null };

jest.mock("@/lib/auth", () => ({ requireOrgContext: () => authMock() }));
jest.mock("@/lib/supabase/server", () => ({
  createServerClient: async () => ({
    from: () => {
      const b: Record<string, unknown> = {
        update: (payload: unknown) => {
          updateMock(payload);
          return b;
        },
        eq: () => b,
        select: () => b,
        maybeSingle: async () => result,
      };
      return b;
    },
  }),
}));

import { NextRequest } from "next/server";
import { PATCH } from "./route";

const ROW = {
  id: "t1",
  slug: "intro",
  title: "Intro",
  description: null,
  duration_minutes: 30,
  slot_interval_minutes: 15,
  meeting_type: "external_meeting",
  requires_approval: false,
  is_active: true,
  sort_order: 0,
};

const patch = (body: unknown) =>
  PATCH(new NextRequest("http://localhost/api/meetings/scheduling/event-types/t1", { method: "PATCH", body: JSON.stringify(body) }), {
    params: Promise.resolve({ id: "t1" }),
  });

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({ ok: true, ctx: { userId: "host-1", orgId: "org-1" } });
  result = { data: ROW, error: null };
});

it("stores the questions cleaned, and returns them", async () => {
  result = { data: { ...ROW, intake_questions: [{ id: "fund", label: "Which fund?", kind: "short", options: [], required: true }] }, error: null };
  const res = await patch({ intakeQuestions: [{ label: " Which fund? ", required: true }, { label: "" }] });
  expect(res.status).toBe(200);
  expect(updateMock.mock.calls[0][0].intake_questions).toEqual([
    { id: "which-fund", label: "Which fund?", kind: "short", options: [], required: true },
  ]);
  expect((await res.json()).eventType.intakeQuestions).toHaveLength(1);
});

it("says the questions are not available yet while their column is missing", async () => {
  result = { data: null, error: { code: "42703", message: 'column "intake_questions" does not exist' } };
  const res = await patch({ intakeQuestions: [{ label: "Q" }] });
  expect(res.status).toBe(503);
  expect((await res.json()).error).toMatch(/aren't available yet/);
});

it("serializes a row from before the column existed with no questions", async () => {
  const res = await patch({ title: "Intro call" });
  expect((await res.json()).eventType.intakeQuestions).toEqual([]);
});
