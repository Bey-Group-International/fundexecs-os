// The October 2026 incident, as a contract: the migration pipeline's
// credential died, three merged migrations never reached production, and the
// deployed app called a database function that did not exist — while every
// merge looked green. /api/health now probes each guarded feature's actual
// runtime dependencies, so that state is a named, failing check instead of a
// user's broken button.

const tableResults: Record<string, { error: { message: string } | null }> = {};
let rpcResult: { data: unknown; error: { message: string } | null } = { data: [], error: null };
const rpcCalls: { fn: string; args: unknown }[] = [];

jest.mock("@/lib/supabase/server", () => ({
  createServiceClient: () => ({
    from: (table: string) => {
      const chain = {
        select: () => chain,
        limit: async () => tableResults[table] ?? { error: null },
      };
      return chain;
    },
    rpc: async (fn: string, args: unknown) => {
      rpcCalls.push({ fn, args });
      return rpcResult;
    },
  }),
}));

import { GET } from "./route";

const request = (auth?: string) =>
  new Request("http://localhost/api/health", {
    headers: auth ? { authorization: auth } : {},
  });

type Body = {
  status: string;
  db: string;
  checks: { name: string; ok: boolean; error?: string }[];
};

beforeEach(() => {
  process.env.CRON_SECRET = "s3cret";
  process.env.SUPABASE_SERVICE_ROLE_KEY = "service-key";
  for (const k of Object.keys(tableResults)) delete tableResults[k];
  rpcResult = { data: [], error: null };
  rpcCalls.length = 0;
  jest.spyOn(console, "error").mockImplementation(() => {});
});

afterEach(() => {
  jest.restoreAllMocks();
});

it("stays closed to callers without the bearer", async () => {
  expect((await GET(request())).status).toBe(401);
  expect((await GET(request("Bearer wrong"))).status).toBe(401);
});

it("reports every feature dependency healthy", async () => {
  const res = await GET(request("Bearer s3cret"));
  expect(res.status).toBe(200);
  const body = (await res.json()) as Body;
  expect(body.status).toBe("ok");
  expect(body.db).toBe("ok");
  expect(body.checks.length).toBeGreaterThanOrEqual(10);
  expect(body.checks.every((c) => c.ok)).toBe(true);
  // The transcript function is exercised with no ids: existence, not data.
  expect(rpcCalls).toEqual([{ fn: "live_meetings_with_transcript_rows", args: { ids: [] } }]);
});

it("names the broken dependency and still reports the rest", async () => {
  tableResults.live_meeting_transcripts = { error: { message: "permission denied" } };
  const res = await GET(request("Bearer s3cret"));
  expect(res.status).toBe(503);
  const body = (await res.json()) as Body;
  expect(body.status).toBe("degraded");
  const bad = body.checks.find((c) => c.name === "meetings:live_meeting_transcripts")!;
  expect(bad.ok).toBe(false);
  expect(bad.error).toContain("permission denied");
  // One casualty must not hide the state of everything else.
  expect(body.checks.filter((c) => c.ok).length).toBe(body.checks.length - 1);
  expect(body.db).toBe("ok");
});

// THE OCTOBER CASE: the function a deployed feature calls does not exist in
// production, because its migration never applied.
it("catches a database function the app depends on going missing", async () => {
  rpcResult = {
    data: null,
    error: { message: "function live_meetings_with_transcript_rows(uuid[]) does not exist" },
  };
  const res = await GET(request("Bearer s3cret"));
  expect(res.status).toBe(503);
  const body = (await res.json()) as Body;
  const fn = body.checks.find((c) => c.name === "meetings:fn:live_meetings_with_transcript_rows")!;
  expect(fn.ok).toBe(false);
  expect(fn.error).toMatch(/does not exist/);
});

it("keeps the original db field honest about the core probe", async () => {
  tableResults.organizations = { error: { message: "connection refused" } };
  const res = await GET(request("Bearer s3cret"));
  expect(res.status).toBe(503);
  const body = (await res.json()) as Body;
  expect(body.db).toBe("error");
});
