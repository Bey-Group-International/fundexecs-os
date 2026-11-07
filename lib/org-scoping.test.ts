// A person in two organizations can read both through row-level security, so
// every read behind a signed-in page has to name the organization it is for.
// These tests record the filters each read applies and fail if one is missing.
jest.mock("server-only", () => ({}), { virtual: true });

import { buildCapitalMap } from "@/lib/capital-map";
import { buildGraph } from "@/lib/graph";
import { getActiveMandate, getActiveScreeningCriteria } from "@/lib/mandates";
import { getInboxThreads } from "@/lib/inbox/data";

type Call = { table: string; method: string; args: unknown[] };

function recordingClient() {
  const calls: Call[] = [];
  const client = {
    from(table: string) {
      const builder: Record<string, unknown> = {};
      const proxy: unknown = new Proxy(builder, {
        get(_t, prop: string) {
          if (prop === "then") {
            return (resolve: (v: unknown) => void) => resolve({ data: [], error: null });
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
});
