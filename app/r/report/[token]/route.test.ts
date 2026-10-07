/**
 * The invitee's private report link: a valid token opens the read-only summary
 * with no account; anything else, or a deleted meeting, opens nothing.
 */
const verifyReportShare = jest.fn();
const loadReportForExport = jest.fn();
let meetingRow: Record<string, unknown> | null = { deleted_at: null };

jest.mock("@/lib/meetings/report-share.server", () => ({ verifyReportShare: (...a: unknown[]) => verifyReportShare(...a) }));
jest.mock("@/lib/meetings/report-export.server", () => ({ loadReportForExport: (...a: unknown[]) => loadReportForExport(...a) }));
jest.mock("@/lib/supabase/server", () => ({
  hasSupabaseServiceEnv: () => true,
  createServiceClient: () => ({
    from: () => {
      const b: Record<string, unknown> = { select: () => b, eq: () => b, maybeSingle: async () => ({ data: meetingRow }) };
      return b;
    },
  }),
}));

import { GET } from "./route";

const LOADED = {
  meetingId: "m1",
  roomCode: "abc-def",
  attended: false,
  attendees: [],
  present: [],
  title: "Series B <sync>",
  summary: "We agreed the terms.",
  keyPoints: ["Price set"],
  actionItems: [],
  analysis: null,
  fullTranscript: "SECRET TRANSCRIPT",
  hasReport: true,
  recording: null,
  chat: null,
};

const get = (token: string) => GET(new Request("http://x"), { params: Promise.resolve({ token }) });

beforeEach(() => {
  jest.clearAllMocks();
  meetingRow = { deleted_at: null };
  verifyReportShare.mockReturnValue({ r: "abc-def", e: "ana@acme.com", x: Date.now() + 1000 });
  loadReportForExport.mockResolvedValue(LOADED);
});

it("opens the summary with no account, read-only, without the transcript", async () => {
  const res = await get("good");
  expect(res.status).toBe(200);
  const html = await res.text();
  expect(html).toContain("We agreed the terms.");
  expect(html).not.toContain("SECRET TRANSCRIPT");
  expect(html).toContain("Series B &lt;sync&gt;");
  expect(res.headers.get("cache-control")).toContain("no-store");
  expect(res.headers.get("x-robots-tag")).toContain("noindex");
  expect(loadReportForExport).toHaveBeenCalledWith(expect.anything(), "abc-def", { includeTranscript: false, userId: null });
});

it("refuses an invalid or expired token without touching the database", async () => {
  verifyReportShare.mockReturnValue(null);
  const res = await get("bad");
  expect(res.status).toBe(404);
  expect(await res.text()).toContain("expired");
  expect(loadReportForExport).not.toHaveBeenCalled();
});

it("shows nothing for a deleted meeting or one with no summary", async () => {
  meetingRow = { deleted_at: "2026-10-01T00:00:00Z" };
  expect((await get("good")).status).toBe(404);
  meetingRow = { deleted_at: null };
  loadReportForExport.mockResolvedValue({ ...LOADED, summary: "" });
  expect((await get("good")).status).toBe(404);
});
