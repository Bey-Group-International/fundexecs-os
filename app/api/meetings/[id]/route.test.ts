const authMock = jest.fn();
const from = jest.fn();
const updateMeetingMock = jest.fn();
const deleteMeetingLocalMock = jest.fn();

jest.mock("@/lib/auth", () => ({
  requireOrgContext: () => authMock(),
}));

jest.mock("@/lib/supabase/server", () => ({
  createServerClient: () => ({ from }),
}));

jest.mock("@/lib/meetings/service", () => ({
  updateMeeting: (...args: unknown[]) => updateMeetingMock(...args),
  deleteMeetingLocal: (...args: unknown[]) => deleteMeetingLocalMock(...args),
}));

import { NextRequest } from "next/server";
import { DELETE, PATCH } from "./route";

const params = { params: Promise.resolve({ id: "m1" }) };

function req(body: unknown = {}) {
  return new NextRequest("http://localhost/api/meetings/m1", {
    method: "PATCH",
    body: JSON.stringify(body),
  });
}

beforeEach(() => {
  jest.clearAllMocks();
  authMock.mockResolvedValue({
    ok: true,
    ctx: { orgId: "org1", userId: "u1", role: "owner", email: "u@test" },
  });
});

describe("/api/meetings/[id]", () => {
  it("patches meeting fields through the service", async () => {
    updateMeetingMock.mockResolvedValue({ ok: true });
    const res = await PATCH(req({
      title: "Updated",
      durationMinutes: 45,
      priority: "high",
      tags: ["LP", "Q3"],
      syncMode: "pending_external",
    }), params);

    expect(res.status).toBe(200);
    expect(updateMeetingMock).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "org1", userId: "u1" },
      "m1",
      expect.objectContaining({
        title: "Updated",
        durationMinutes: 45,
        priority: "high",
        tags: ["LP", "Q3"],
        syncMode: "pending_external",
      }),
    );
  });

  it("deletes meetings locally by default", async () => {
    deleteMeetingLocalMock.mockResolvedValue({ ok: true });
    const res = await DELETE(new NextRequest("http://localhost/api/meetings/m1", { method: "DELETE" }), params);

    expect(res.status).toBe(200);
    expect(deleteMeetingLocalMock).toHaveBeenCalledWith(
      expect.anything(),
      { orgId: "org1", userId: "u1" },
      "m1",
    );
  });
});
