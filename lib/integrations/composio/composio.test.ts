// Pure, network-free tests for the Composio integration layer.
//
// Every Composio HTTP call is an injected fake (fetchImpl) and every SEC call in
// the EDGAR fallback is an injected HttpFetch — no real network is touched.

import {
  composioConfigured,
  executeComposioTool,
  type ComposioConfig,
} from "./client.server";
import {
  extractEdgarPreferComposio,
  extractEdgarViaComposio,
  mapComposioSecFilingsToDataPoints,
} from "./edgar.server";
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

// ── edgar.server ─────────────────────────────────────────────────────────────

describe("mapComposioSecFilingsToDataPoints", () => {
  const payload = {
    ticker: "AAPL",
    cik: 320193,
    company_name: "Apple Inc.",
    filings: [
      { form_type: "10-K", filing_date: "2024-11-01", accession_number: "0000320193-24-000123", primary_document_url: "https://sec.gov/x/10k.htm" },
      { form: "8-K", date: "2024-08-01", accession_no: "0000320193-24-000100", index_url: "https://sec.gov/x/idx" },
    ],
  };

  test("maps company facts + filings with authoritative confidence and no confirmation gate", () => {
    const points = mapComposioSecFilingsToDataPoints(payload, { query: "AAPL" });
    const byField = Object.fromEntries(points.map((p) => [p.field_name, p]));
    expect(byField.company_name.extracted_value).toBe("Apple Inc.");
    expect(byField.company_cik.extracted_value).toBe("0000320193");
    expect(byField.filing_1.extracted_value).toContain("10-K");
    expect(byField.filing_1.source_url).toBe("https://sec.gov/x/10k.htm");
    expect(byField.filing_2.extracted_value).toContain("8-K");
    // EDGAR is authoritative — every point is source_type edgar, no per-field confirm.
    for (const p of points) {
      expect(p.source_type).toBe("edgar");
      expect(p.requires_user_confirmation).toBe(false);
    }
  });

  test("empty / not-found payload yields no filing points", () => {
    const points = mapComposioSecFilingsToDataPoints({ filings: [] }, { query: "ZZZZ" });
    expect(points.some((p) => p.field_name.startsWith("filing_"))).toBe(false);
  });
});

describe("extractEdgarViaComposio", () => {
  test("executes the SEC filings tool and returns mapped points", async () => {
    const cap: Captured[] = [];
    const res = await extractEdgarViaComposio(
      cfg(fakeComposioFetch({ data: {
        ticker: "MSFT", cik: 789019, company_name: "Microsoft Corp",
        filings: [{ form_type: "10-Q", filing_date: "2025-01-01", accession_number: "x-1", primary_document_url: "https://sec.gov/q" }],
      }, successful: true }, { capture: cap })),
      { query: "MSFT", limit: 5, formTypes: ["10-Q"] },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.company.title).toBe("Microsoft Corp");
      expect(res.points.some((p) => p.field_name === "filing_1")).toBe(true);
    }
    expect(cap[0].body).toMatchObject({ arguments: { ticker_or_cik: "MSFT", form_types: ["10-Q"] } });
  });

  test("treats an empty result as not_found so callers can fall back", async () => {
    const res = await extractEdgarViaComposio(
      cfg(fakeComposioFetch({ data: { filings: [] }, successful: true })),
      { query: "NOPE" },
    );
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("not_found");
  });
});

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

  test("falls back to the direct SEC path when Composio is unconfigured (composio:null)", async () => {
    const res = await extractEdgarPreferComposio({ query: "AAPL", http: secFetch }, { composio: null });
    expect(res.ok).toBe(true);
    if (res.ok) {
      expect(res.company.cikPadded).toBe("0000320193");
      expect(res.points.some((p) => p.field_name === "filing_1")).toBe(true);
    }
  });

  test("uses Composio when a config is supplied", async () => {
    const res = await extractEdgarPreferComposio(
      { query: "AAPL", http: secFetch },
      { composio: cfg(fakeComposioFetch({ data: {
        ticker: "AAPL", cik: 320193, company_name: "Apple Inc.",
        filings: [{ form_type: "10-K", filing_date: "2024-11-01", accession_number: "a-1", primary_document_url: "https://sec.gov/via-composio" }],
      }, successful: true })) },
    );
    expect(res.ok).toBe(true);
    if (res.ok) {
      const filing = res.points.find((p) => p.field_name === "filing_1");
      expect(filing?.source_url).toBe("https://sec.gov/via-composio");
    }
  });

  test("falls back to direct SEC when the Composio lookup fails", async () => {
    const res = await extractEdgarPreferComposio(
      { query: "AAPL", http: secFetch },
      { composio: cfg(fakeComposioFetch({ successful: false, error: "throttled" })) },
    );
    // Composio missed → direct SEC path produced the answer.
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.company.cikPadded).toBe("0000320193");
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
