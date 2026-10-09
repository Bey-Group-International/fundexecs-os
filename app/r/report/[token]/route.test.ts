/**
 * The private report link: a valid token opens the read-only summary with no
 * account; anything else, or a deleted meeting, opens nothing. And a link that
 * arrives before its report — a guest's, handed over on the way out of the
 * room — is told the truth about where the report is rather than "not
 * available".
 */
const verifyReportShare = jest.fn();
const loadReportForExport = jest.fn();
let meetingRow: Record<string, unknown> | null = null;

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
import { NOT_READY_REFRESH_SECONDS } from "@/lib/meetings/report-generation";
import { REPORT_WAIT_LIMIT_MS } from "@/lib/meetings/attendance";

const ENDED = "2026-10-09T10:00:00.000Z";
const MEETING = {
  id: "m1", deleted_at: null, host_id: "h1", title: "Series B <sync>",
  created_at: "2026-10-09T09:00:00.000Z", started_at: "2026-10-09T09:30:00.000Z", ended_at: ENDED,
  scheduled_at: null, kind: "meeting",
};

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
  jest.useFakeTimers().setSystemTime(Date.parse(ENDED) + 60_000);
  meetingRow = { ...MEETING };
  verifyReportShare.mockReturnValue({ r: "abc-def", e: "ana@acme.com", x: Date.now() + 1000 });
  loadReportForExport.mockResolvedValue(LOADED);
});

afterEach(() => jest.useRealTimers());

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

it("opens the same summary for a guest's token", async () => {
  verifyReportShare.mockReturnValue({ r: "abc-def", g: "digest", x: Date.now() + 1000 });
  const res = await get("guest");
  expect(res.status).toBe(200);
  expect(await res.text()).toContain("We agreed the terms.");
});

it("refuses an invalid or expired token without touching the database", async () => {
  verifyReportShare.mockReturnValue(null);
  const res = await get("bad");
  expect(res.status).toBe(404);
  expect(await res.text()).toContain("expired");
  expect(loadReportForExport).not.toHaveBeenCalled();
});

it("shows nothing for a deleted meeting", async () => {
  meetingRow = { ...MEETING, deleted_at: "2026-10-01T00:00:00Z" };
  expect((await get("good")).status).toBe(404);
  expect(loadReportForExport).not.toHaveBeenCalled();
});

describe("a link that arrived before its report", () => {
  // A guest is handed their link on the way out, in the seconds before the
  // host's End has finished writing. "Not available" would be the product
  // telling them the meeting they just left had no record.
  it("waits, and looks again, while the room's own page would still be waiting", async () => {
    loadReportForExport.mockResolvedValue({ ...LOADED, summary: null, hasReport: false });
    const res = await get("good");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("still being written");
    expect(html).toContain(`<meta http-equiv="refresh" content="${NOT_READY_REFRESH_SECONDS}">`);
    expect(html).not.toContain("SECRET TRANSCRIPT");
  });

  it("stops looking once the report is as late as the room's own page gives up on", async () => {
    jest.setSystemTime(Date.parse(ENDED) + REPORT_WAIT_LIMIT_MS + 1);
    loadReportForExport.mockResolvedValue({ ...LOADED, summary: null, hasReport: false });
    const html = await (await get("good")).text();
    expect(html).toContain("has not been written yet");
    expect(html).not.toContain("http-equiv=\"refresh\"");
  });

  it("says there was nothing to summarise for a report filed that way, and does not reload", async () => {
    loadReportForExport.mockResolvedValue({ ...LOADED, summary: "", hasReport: true, analysis: { unsummarised: "silent" } });
    const res = await get("good");
    expect(res.status).toBe(200);
    const html = await res.text();
    expect(html).toContain("Nothing to summarise");
    expect(html).not.toContain("http-equiv=\"refresh\"");
  });

  it("says the analysis failed for a report with words and no summary", async () => {
    loadReportForExport.mockResolvedValue({ ...LOADED, summary: "", hasReport: true, analysis: {} });
    const html = await (await get("good")).text();
    expect(html).toContain("No summary was written");
    expect(html).not.toContain("SECRET TRANSCRIPT");
  });
});
