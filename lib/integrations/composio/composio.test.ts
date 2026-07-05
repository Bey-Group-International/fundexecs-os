// Pure, network-free tests for the Composio integration layer.
//
// Every Composio HTTP call is an injected fake (fetchImpl) and every SEC call in
// the EDGAR fallback is an injected HttpFetch — no real network is touched.

import {
  composioConfigured,
  executeComposioTool,
  type ComposioConfig,
} from "./client.server";
import { extractEdgarPreferComposio } from "./edgar.server";
import {
  buildEdgarSearchQuery,
  mapWebSearchToEdgarFilings,
  searchEdgarFilingsViaGoogle,
} from "./edgar-search.server";
import {
  fetchMarketstackCompany,
  mapMarketstackToDataPoints,
  type MarketstackCompany,
} from "./marketstack.server";
import {
  mapGmailMessagesToProfileInputs,
  parseEmailAddress,
} from "./gmail.server";
import {
  fromLinkedInApi,
  mapLinkedInProfileToInput,
} from "./linkedin.server";
import type { HttpFetch, HttpResponse } from "@/lib/earn/browser-operator/sources/http";

// ── Fake Composio fetch (Response-like with .json) ───────────────────────────

type Captured = { url: string; body: unknown };

function fakeComposioFetch(
  envelope: unknown,
  opts: { ok?: boolean; status?: number; capture?: Captured[] } = {},
): ComposioConfig["fetchImpl"] {
  return (async (url: string, init?: RequestInit) => {
    opts.capture?.push({ url, body: init?.body ? JSON.parse(String(init.body)) : undefined });
    return {
      ok: opts.ok ?? true,
      status: opts.status ?? 200,
      json: async () => envelope,
    };
  }) as unknown as ComposioConfig["fetchImpl"];
}

const cfg = (fetchImpl: ComposioConfig["fetchImpl"]): ComposioConfig => ({
  apiKey: "test-key",
  userId: "entity-1",
  fetchImpl,
});

// ── client.server ────────────────────────────────────────────────────────────

describe("executeComposioTool", () => {
  test("unwraps the { data, successful } envelope on success", async () => {
    const cap: Captured[] = [];
    const res = await executeComposioTool(
      cfg(fakeComposioFetch({ data: { hello: "world" }, successful: true }, { capture: cap })),
      "SOME_TOOL",
      { a: 1 },
      { connectedAccountId: "acc-9" },
    );
    expect(res).toEqual({ ok: true, data: { hello: "world" } });
    // POSTs to the v3 execute endpoint with user_id + arguments + account.
    expect(cap[0].url).toContain("/api/v3/tools/execute/SOME_TOOL");
    expect(cap[0].body).toMatchObject({
      user_id: "entity-1",
      arguments: { a: 1 },
      connected_account_id: "acc-9",
    });
  });

  test("reports failure when successful:false", async () => {
    const res = await executeComposioTool(
      cfg(fakeComposioFetch({ successful: false, error: "nope" })),
      "T",
      {},
    );
    expect(res).toEqual({ ok: false, error: "nope" });
  });

  test("reports failure on non-OK HTTP", async () => {
    const res = await executeComposioTool(
      cfg(fakeComposioFetch({}, { ok: false, status: 503 })),
      "T",
      {},
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("503");
  });

  test("composioConfigured reflects the env key", () => {
    const prev = process.env.COMPOSIO_API_KEY;
    delete process.env.COMPOSIO_API_KEY;
    expect(composioConfigured()).toBe(false);
    process.env.COMPOSIO_API_KEY = "k";
    expect(composioConfigured()).toBe(true);
    if (prev === undefined) delete process.env.COMPOSIO_API_KEY;
    else process.env.COMPOSIO_API_KEY = prev;
  });
});

// ── marketstack.server ───────────────────────────────────────────────────────

// A Marketstack REST fake: routes by URL substring to a JSON body.
function fakeMarketstackFetch(routes: Array<{ match: string; body: unknown; ok?: boolean }>): typeof fetch {
  return (async (url: string) => {
    const hit = routes.find((r) => String(url).includes(r.match));
    return { ok: hit?.ok ?? Boolean(hit), status: hit ? 200 : 404, json: async () => hit?.body ?? {} };
  }) as unknown as typeof fetch;
}

describe("fetchMarketstackCompany + mapMarketstackToDataPoints", () => {
  const msFetch = fakeMarketstackFetch([
    { match: "/tickers", body: { data: [{ name: "Apple Inc", symbol: "aapl", stock_exchange: { name: "NASDAQ Stock Exchange", acronym: "NASDAQ" } }] } },
    { match: "/eod/latest", body: { data: [{ symbol: "AAPL", close: 190.5, date: "2024-11-01T00:00:00+0000" }] } },
  ]);

  test("resolves ticker + latest close and maps to authoritative company points", async () => {
    const company = await fetchMarketstackCompany("key", "Apple", { fetchImpl: msFetch });
    // name already contains the acronym, so no redundant parenthetical is added.
    expect(company).toMatchObject({ name: "Apple Inc", symbol: "AAPL", exchange: "NASDAQ Stock Exchange", latestClose: 190.5, latestDate: "2024-11-01" });

    const points = mapMarketstackToDataPoints(company as MarketstackCompany);
    const byField = Object.fromEntries(points.map((p) => [p.field_name, p]));
    expect(byField.company_name.extracted_value).toBe("Apple Inc");
    expect(byField.company_ticker.extracted_value).toBe("AAPL");
    expect(byField.company_exchange.extracted_value).toContain("NASDAQ");
    expect(byField.market_price.extracted_value).toContain("190.5");
    // Market data is authoritative — no per-field confirmation, source_type edgar.
    for (const p of points) {
      expect(p.source_type).toBe("edgar");
      expect(p.requires_user_confirmation).toBe(false);
    }
  });

  test("returns null when the ticker search finds nothing", async () => {
    const none = await fetchMarketstackCompany("key", "ZZZZ", { fetchImpl: fakeMarketstackFetch([{ match: "/tickers", body: { data: [] } }]) });
    expect(none).toBeNull();
  });

  test("still returns identity when the EOD price call misses", async () => {
    const company = await fetchMarketstackCompany("key", "Apple", {
      fetchImpl: fakeMarketstackFetch([{ match: "/tickers", body: { data: [{ name: "Apple Inc", symbol: "AAPL" }] } }]),
    });
    expect(company).toMatchObject({ symbol: "AAPL", latestClose: null });
  });
});

// ── edgar-search.server (Google web search via Composio) ─────────────────────

describe("mapWebSearchToEdgarFilings", () => {
  const payload = {
    results: {
      citations: [
        { url: "https://www.sec.gov/Archives/edgar/data/320193/aapl-10k.htm", title: "Apple Inc. 10-K filed 2024-11-01" },
        { url: "https://www.sec.gov/cgi-bin/browse-edgar?CIK=AAPL", title: "Apple 8-K current report" },
        { url: "https://www.bloomberg.com/apple", title: "Apple news" }, // non-sec.gov, dropped
        { url: "https://www.sec.gov/Archives/edgar/data/320193/aapl-10k.htm", title: "dup" }, // dup URL, dropped
      ],
    },
  };

  test("keeps only sec.gov results, dedupes, infers form + date, requires confirmation", () => {
    const points = mapWebSearchToEdgarFilings(payload);
    expect(points).toHaveLength(2);
    expect(points[0].source_url).toContain("sec.gov");
    expect(points[0].extracted_value).toContain("10-K");
    expect(points[0].extracted_value).toContain("2024-11-01");
    expect(points[1].extracted_value).toContain("8-K");
    for (const p of points) {
      expect(p.field_name).toMatch(/^filing_\d+$/);
      expect(p.source_type).toBe("edgar");
      expect(p.requires_user_confirmation).toBe(true);
    }
  });

  test("buildEdgarSearchQuery scopes to sec.gov", () => {
    expect(buildEdgarSearchQuery("Apple")).toContain("site:sec.gov");
  });
});

describe("searchEdgarFilingsViaGoogle", () => {
  test("executes the web-search tool with the scoped query and maps results", async () => {
    const cap: Captured[] = [];
    const points = await searchEdgarFilingsViaGoogle(
      cfg(fakeComposioFetch({ data: { results: { citations: [{ url: "https://www.sec.gov/x/10q.htm", title: "10-Q" }] } }, successful: true }, { capture: cap })),
      "Apple",
    );
    expect(points).toHaveLength(1);
    expect(cap[0].url).toContain("/api/v3/tools/execute/COMPOSIO_SEARCH_WEB");
    expect((cap[0].body as { arguments: { query: string } }).arguments.query).toContain("site:sec.gov");
  });

  test("returns [] on a Composio miss", async () => {
    const points = await searchEdgarFilingsViaGoogle(
      cfg(fakeComposioFetch({ successful: false, error: "throttled" })),
      "Apple",
    );
    expect(points).toEqual([]);
  });
});

// ── extractEdgarPreferComposio (Marketstack + Google, SEC-direct fallback) ───

describe("extractEdgarPreferComposio", () => {
  const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
  const SUBMISSIONS_URL = "https://data.sec.gov/submissions/CIK0000320193.json";
  const secFetch: HttpFetch = (url) => {
    const routes: Record<string, string> = {
      [TICKERS_URL]: JSON.stringify({ "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." } }),
      [SUBMISSIONS_URL]: JSON.stringify({
        cik: "320193", name: "Apple Inc.", sic: "3571", sicDescription: "Electronic Computers",
        filings: { recent: { accessionNumber: ["a-1"], form: ["10-K"], filingDate: ["2024-11-01"], primaryDocument: ["10k.htm"], primaryDocDescription: ["Annual report"] } },
      }),
    };
    const body = routes[url];
    const res: HttpResponse = { ok: body !== undefined, status: body ? 200 : 404, headers: { get: () => null }, text: async () => body ?? "" };
    return Promise.resolve(res);
  };
  const msFetch = fakeMarketstackFetch([
    { match: "/tickers", body: { data: [{ name: "Apple Inc", symbol: "AAPL", stock_exchange: { name: "NASDAQ", acronym: "NASDAQ" } }] } },
    { match: "/eod/latest", body: { data: [{ symbol: "AAPL", close: 190.5, date: "2024-11-01" }] } },
  ]);
  const googleCfg = () => cfg(fakeComposioFetch({ data: { results: { citations: [{ url: "https://www.sec.gov/Archives/edgar/data/320193/10k.htm", title: "Apple 10-K 2024-11-01" }] } }, successful: true }));

  test("merges Marketstack company facts + Google-searched filings (no SEC API)", async () => {
    const res = await extractEdgarPreferComposio(
      { query: "Apple", http: secFetch },
      { composio: googleCfg(), marketstackKey: "key", marketstackFetch: msFetch },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.company.title).toBe("Apple Inc");
      expect(res.points.find((p) => p.field_name === "company_ticker")?.extracted_value).toBe("AAPL");
      const filing = res.points.find((p) => p.field_name === "filing_1");
      expect(filing?.source_url).toContain("sec.gov");
      expect(filing?.requires_user_confirmation).toBe(true);
    }
  });

  test("works with Google filings alone when Marketstack is unconfigured", async () => {
    const res = await extractEdgarPreferComposio(
      { query: "Apple", http: secFetch },
      { composio: googleCfg(), marketstackKey: null },
    );
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.points.some((p) => p.field_name === "filing_1")).toBe(true);
  });

  test("falls back to the direct SEC path only when nothing else is configured", async () => {
    const res = await extractEdgarPreferComposio(
      { query: "AAPL", http: secFetch },
      { composio: null, marketstackKey: null },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.company.cikPadded).toBe("0000320193");
      expect(res.points.some((p) => p.field_name === "filing_1")).toBe(true);
    }
  });
});

// ── gmail.server ─────────────────────────────────────────────────────────────

describe("parseEmailAddress", () => {
  test('parses "Name" <email> and bare email; rejects non-addresses', () => {
    expect(parseEmailAddress('"Jane Doe" <Jane@X.com>')).toEqual({ name: "Jane Doe", email: "jane@x.com" });
    expect(parseEmailAddress("bob@y.io")).toEqual({ name: null, email: "bob@y.io" });
    expect(parseEmailAddress("no address here")).toEqual({ name: null, email: null });
  });
});

describe("mapGmailMessagesToProfileInputs", () => {
  test("derives unique senders, excludes self, and reads payload.headers", () => {
    const payload = {
      messages: [
        { sender: "Alice Partner <alice@fund.com>" },
        { from: "alice@fund.com" }, // duplicate email, dropped
        { payload: { headers: [{ name: "From", value: "Bob LP <bob@lp.com>" }] } },
        { from: "me@myfirm.com" }, // self, excluded
      ],
    };
    const people = mapGmailMessagesToProfileInputs(payload, { selfEmails: ["ME@myfirm.com"] });
    const emails = people.map((p) => p.email).sort();
    expect(emails).toEqual(["alice@fund.com", "bob@lp.com"]);
    expect(people.find((p) => p.email === "alice@fund.com")?.fullName).toBe("Alice Partner");
  });

  test("can read to/cc when asked, splitting multiple addresses", () => {
    const payload = { messages: [{ to: "a@x.com, B Person <b@x.com>" }] };
    const people = mapGmailMessagesToProfileInputs(payload, { fields: ["to"] });
    expect(people.map((p) => p.email).sort()).toEqual(["a@x.com", "b@x.com"]);
  });
});

// ── linkedin.server ──────────────────────────────────────────────────────────

describe("mapLinkedInProfileToInput / fromLinkedInApi", () => {
  test("handles the OpenID shape and builds a canonical URL from vanityName", () => {
    const input = mapLinkedInProfileToInput({
      given_name: "Sheik", family_name: "Bey", email: "x@y.com", headline: "Managing Partner", vanityName: "sheikbey",
    });
    expect(input.firstName).toBe("Sheik");
    expect(input.linkedinUrl).toBe("https://www.linkedin.com/in/sheikbey");
    const norm = fromLinkedInApi({ given_name: "Sheik", family_name: "Bey", headline: "Managing Partner" });
    expect("error" in norm).toBe(false);
    if (!("error" in norm)) {
      expect(norm.source).toBe("linkedin_api");
      expect(norm.capital_role).toBe("fund_manager"); // inferred from "Managing Partner"
    }
  });

  test("handles the classic localizedFirstName shape", () => {
    const input = mapLinkedInProfileToInput({ localizedFirstName: "Jane", localizedLastName: "Roe" });
    expect(input.firstName).toBe("Jane");
    expect(input.lastName).toBe("Roe");
  });
});
