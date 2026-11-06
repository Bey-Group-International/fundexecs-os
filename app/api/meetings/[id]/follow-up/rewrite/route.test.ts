/** Reworking the follow-up: a tone, an instruction, or a firm template. Host only. */
const hostMock = jest.fn();
const createMock = jest.fn();
let template: unknown = null;

jest.mock("../host.server", () => ({ requireMeetingHost: () => hostMock() }));
jest.mock("@/lib/anthropic-client", () => ({ anthropicClient: () => ({ messages: { create: createMock } }), INTERACTIVE_TIMEOUT_MS: 1 }));
jest.mock("@/lib/meetings/report-roles.server", () => ({ loadHost: async () => ({ full_name: "Hana Host" }) }));
jest.mock("@/lib/supabase/server", () => ({ createServerClient: async () => ({}) }));
jest.mock("@/lib/meetings/follow-up-sends.server", () => ({
  templateContext: async () => ({ meetingTitle: "Dunbar", hostName: "Hana Host", summary: "Agreed terms.", decisions: ["Proceed"], actionItems: ["Ana: send model"] }),
}));

import { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { POST } from "./route";
import { clearRateLimitBucketsForTests } from "@/lib/rate-limit";

const params = Promise.resolve({ id: "m1" });
const post = (body: unknown) =>
  new NextRequest("http://localhost/x", { method: "POST", body: JSON.stringify(body), headers: { "Content-Type": "application/json" } });

beforeEach(() => {
  clearRateLimitBucketsForTests();
  process.env.ANTHROPIC_API_KEY = "k";
  createMock.mockReset();
  template = { body: "Hi {{first_name}},\n\nThanks for {{meeting_title}}.\n\n{{action_items}}\n\n{{host_name}}" };
  const db = {
    from: () => {
      const q: Record<string, unknown> = {};
      for (const m of ["select", "eq"]) q[m] = () => q;
      q.maybeSingle = async () => ({ data: template });
      return q;
    },
  };
  hostMock.mockResolvedValue({ ok: true, userId: "u1", orgId: "o1", email: "h@x.com", meeting: { id: "m1", title: "Dunbar", host_id: "u1" }, db });
});

it("fills a template from the report, keeping the first-name token", async () => {
  const res = await POST(post({ templateId: "t1" }), { params });
  expect((await res.json()).body).toBe("Hi {{first_name}},\n\nThanks for Dunbar.\n\n1. Ana: send model\n\nHana Host");
  expect(createMock).not.toHaveBeenCalled();
});

it("says when a template isn't the firm's", async () => {
  template = null;
  expect((await POST(post({ templateId: "t9" }), { params })).status).toBe(404);
});

it("rewrites in a tone, keeping the token", async () => {
  createMock.mockResolvedValue({ content: [{ type: "text", text: "Dear {{first_name}},\n\nThank you." }], stop_reason: "end_turn" });
  const res = await POST(post({ body: "Hi {{first_name}}, thanks!", tone: "formal", instruction: "mention the deck" }), { params });
  expect((await res.json()).body).toBe("Dear {{first_name}},\n\nThank you.");
  const call = createMock.mock.calls[0][0];
  expect(call.system).toContain("{{first_name}}");
  expect(call.messages[0].content).toContain("formal");
  expect(call.messages[0].content).toContain("Also: mention the deck");
});

it("refuses an incomplete rewrite, a missing ask and an empty body", async () => {
  createMock.mockResolvedValue({ content: [{ type: "text", text: "Dear" }], stop_reason: "max_tokens" });
  expect((await POST(post({ body: "Hi", tone: "brief" }), { params })).status).toBe(502);
  expect((await POST(post({ body: "Hi" }), { params })).status).toBe(400);
  expect((await POST(post({ body: "  ", tone: "warm" }), { params })).status).toBe(400);
});

it("refuses anyone but the host", async () => {
  hostMock.mockResolvedValue({ ok: false, response: NextResponse.json({}, { status: 403 }) });
  expect((await POST(post({ body: "Hi", tone: "warm" }), { params })).status).toBe(403);
});
