// A person in two organizations can read both through row-level security, so
// every read behind a signed-in page has to name the organization it is for.
// These tests record the filters each read applies and fail if one is missing.
jest.mock("server-only", () => ({}), { virtual: true });

import { buildCapitalMap } from "@/lib/capital-map";
import { buildGraph } from "@/lib/graph";
import { getActiveMandate, getActiveMandateRow, getActiveScreeningCriteria } from "@/lib/mandates";
import { getInboxThreads } from "@/lib/inbox/data";

type Call = { table: string; method: string; args: unknown[] };

function recordingClient(rowsByTable: Record<string, unknown[]> = {}) {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const proxy: unknown = new Proxy(builder, {
        get(_t, prop: string) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve({ data: rowsByTable[table] ?? [], error: null });
          }
          if (prop === "maybeSingle" || prop === "single") {
            return async () => ({ data: null, error: null });
          }
          return (...args: unknown[]) => {
            calls.push({ table, method: prop, args });
            return proxy;
          };
        },
      });
      return proxy;
    },
  };
  const orgFiltersFor = (table: string) =>
    calls.filter((c) => c.table === table && c.method === "eq" && c.args[0] === "organization_id");
  const tablesRead = () => Array.from(new Set(calls.map((c) => c.table)));
  return { client: client as never, calls, orgFiltersFor, tablesRead };
}

const ORG = "org-active";

function expectEveryTableScoped(r: ReturnType<typeof recordingClient>, tables: string[]) {
  for (const t of tables) {
    const filters = r.orgFiltersFor(t);
    expect({ table: t, scoped: filters.length > 0 }).toEqual({ table: t, scoped: true });
    for (const f of filters) expect(f.args[1]).toBe(ORG);
  }
}

describe("org scoping on signed-in reads", () => {
  it("scopes every Capital Map read to the active org", async () => {
    const r = recordingClient();
    await buildCapitalMap(r.client, ORG);
    expectEveryTableScoped(r, [
      "investors",
      "investment_theses",
      "commitments",
      "relationships",
      "organization_members",
    ]);
  });

  it.each(["relationship", "deal", "capital"] as const)("scopes the %s graph", async (kind) => {
    const r = recordingClient();
    await buildGraph(r.client, kind, ORG);
    const primary = {
      relationship: ["relationships"],
      deal: ["deals", "funds", "assets"],
      capital: ["funds", "investors", "commitments"],
    }[kind];
    expectEveryTableScoped(r, primary);
  });

  it("scopes the active mandate and screening criteria to the given org", async () => {
    const a = recordingClient();
    await getActiveMandate(a.client, ORG);
    expectEveryTableScoped(a, ["mandates"]);
    const b = recordingClient();
    await getActiveScreeningCriteria(b.client, ORG);
    expectEveryTableScoped(b, ["mandates"]);
  });

  it("scopes the inbox thread list to the given org", async () => {
    const r = recordingClient();
    await getInboxThreads(r.client, ORG);
    expectEveryTableScoped(r, ["inbox_threads"]);
  });

  it("scopes the draft read and the draft-thread backfill to the given org", async () => {
    // A draft on a thread that is not on the page forces the backfill read.
    const r = recordingClient({
      inbox_thread_drafts: [
        {
          thread_id: "draft-thread",
          body: "hi",
          source: "meeting",
          source_meeting_id: null,
          updated_at: "2026-09-30T12:00:00.000Z",
        },
      ],
    });
    await getInboxThreads(r.client, ORG);
    expectEveryTableScoped(r, ["inbox_thread_drafts"]);
    const backfills = r.calls.filter(
      (c) => c.table === "inbox_threads" && c.method === "in" && c.args[0] === "id",
    );
    expect(backfills.length).toBe(1);
    // Every inbox_threads read (page and backfill) must carry the org filter.
    expect(r.orgFiltersFor("inbox_threads").length).toBe(2);
  });

  it("scopes the mandate row the editor loads", async () => {
    const r = recordingClient();
    await getActiveMandateRow(r.client, ORG);
    expectEveryTableScoped(r, ["mandates"]);
  });
});
