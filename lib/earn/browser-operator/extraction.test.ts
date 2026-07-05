// lib/earn/browser-operator/extraction.test.ts
//
// Pure, network-free tests for SEAM #2 live extraction: EDGAR JSON mapping,
// public-web HTML parsing, the extraction engine's review-record + low-confidence
// behavior (with a fake Supabase), and source-policy rejection of a disallowed
// source. Every HTTP call is an injected fake — no real network is touched.

import type { HttpFetch, HttpResponse } from "./sources/http";
import {
  extractFromEdgar,
  mapSubmissionsToDataPoints,
  padCik,
  primaryDocUrl,
  resolveCompany,
  SEC_USER_AGENT,
  type EdgarCompany,
} from "./sources/edgar.server";
import {
  extractDataPointsFromHtml,
  extractFromPublicWeb,
  isAllowedByRobots,
  parsePublicUrl,
} from "./sources/public-web.server";
import { runExtraction } from "./extraction-engine.server";
import type { EarnBrowserSession } from "@/lib/supabase/database.types";

// ── Fake HTTP layer ──────────────────────────────────────────────────────────

type Recorded = { url: string; headers?: Record<string, string> };

function fakeFetch(routes: Record<string, string>, recorder?: Recorded[]): HttpFetch {
  return (url, init) => {
    recorder?.push({ url, headers: init?.headers });
    const body = routes[url];
    const res: HttpResponse = {
      ok: body !== undefined,
      status: body !== undefined ? 200 : 404,
      headers: { get: () => null },
      text: async () => body ?? "",
    };
    return Promise.resolve(res);
  };
}

const TICKERS_URL = "https://www.sec.gov/files/company_tickers.json";
const APPLE_CIK = "0000320193";
const SUBMISSIONS_URL = `https://data.sec.gov/submissions/CIK${APPLE_CIK}.json`;

const SAMPLE_TICKERS = JSON.stringify({
  "0": { cik_str: 320193, ticker: "AAPL", title: "Apple Inc." },
  "1": { cik_str: 789019, ticker: "MSFT", title: "Microsoft Corp" },
});

const SAMPLE_SUBMISSIONS = JSON.stringify({
  cik: "320193",
  name: "Apple Inc.",
  sic: "3571",
  sicDescription: "Electronic Computers",
  addresses: {
    business: { street1: "One Apple Park Way", city: "Cupertino", stateOrCountry: "CA", zipCode: "95014" },
  },
  filings: {
    recent: {
      accessionNumber: ["0000320193-23-000106", "0000320193-23-000077"],
      form: ["10-K", "10-Q"],
      filingDate: ["2023-11-03", "2023-08-04"],
      primaryDocument: ["aapl-20230930.htm", "aapl-20230701.htm"],
      primaryDocDescription: ["Annual report", "Quarterly report"],
    },
  },
});

// ── EDGAR ─────────────────────────────────────────────────────────────────────

describe("edgar — helpers", () => {
  it("zero-pads a CIK to 10 digits", () => {
    expect(padCik(320193)).toBe("0000320193");
    expect(padCik("CIK320193")).toBe("0000320193");
  });

  it("builds the canonical primary-document URL", () => {
    expect(primaryDocUrl("320193", "0000320193-23-000106", "aapl-20230930.htm")).toBe(
      "https://www.sec.gov/Archives/edgar/data/320193/000032019323000106/aapl-20230930.htm",
    );
  });
});

describe("edgar — resolve + map from sample JSON", () => {
  it("resolves a ticker to a CIK using company_tickers.json", async () => {
    const http = fakeFetch({ [TICKERS_URL]: SAMPLE_TICKERS });
    const company = await resolveCompany("AAPL", http);
    expect(company).toEqual<EdgarCompany>({
      cik: "320193",
      cikPadded: "0000320193",
      ticker: "AAPL",
      title: "Apple Inc.",
    });
  });

  it("resolves by company-name substring when no ticker matches", async () => {
    const http = fakeFetch({ [TICKERS_URL]: SAMPLE_TICKERS });
    const company = await resolveCompany("microsoft", http);
    expect(company?.ticker).toBe("MSFT");
  });

  it("maps submissions to ExtractedDataPoint[] with facts + filings", () => {
    const company: EdgarCompany = { cik: "320193", cikPadded: APPLE_CIK, ticker: "AAPL", title: "Apple Inc." };
    const points = mapSubmissionsToDataPoints(company, JSON.parse(SAMPLE_SUBMISSIONS));

    const byName = Object.fromEntries(points.map((p) => [p.field_name, p]));
    expect(byName.company_name.extracted_value).toBe("Apple Inc.");
    expect(byName.company_cik.extracted_value).toBe(APPLE_CIK);
    expect(byName.company_industry.extracted_value).toContain("Electronic Computers");
    expect(byName.company_address.extracted_value).toContain("Cupertino");

    // Filings are present, structured, and point at the primary doc.
    expect(byName.filing_1.extracted_value).toContain("10-K");
    expect(byName.filing_1.extracted_value).toContain("2023-11-03");
    expect(byName.filing_1.source_url).toContain("/Archives/edgar/data/320193/");

    // EDGAR is authoritative: high confidence, no confirmation gate.
    for (const p of points) {
      expect(p.source_type).toBe("edgar");
      expect(p.confidence_score).toBeGreaterThanOrEqual(90);
      expect(p.requires_user_confirmation).toBe(false);
    }
  });

  it("sends the required SEC User-Agent on every request", async () => {
    const recorder: Recorded[] = [];
    const http = fakeFetch({ [TICKERS_URL]: SAMPLE_TICKERS, [SUBMISSIONS_URL]: SAMPLE_SUBMISSIONS }, recorder);
    const res = await extractFromEdgar({ query: "AAPL", http });
    expect(res.ok).toBe(true);
    expect(recorder.length).toBe(2);
    for (const call of recorder) {
      expect(call.headers?.["User-Agent"]).toBe(SEC_USER_AGENT);
    }
  });

  it("reports not_found for an unknown ticker", async () => {
    const http = fakeFetch({ [TICKERS_URL]: SAMPLE_TICKERS });
    const res = await extractFromEdgar({ query: "NOPE", http });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("not_found");
  });
});

// ── Public web ─────────────────────────────────────────────────────────────────

const SAMPLE_HTML = `
<!doctype html><html><head>
<title>Cedar Ridge Capital — Home</title>
<meta name="description" content="A lower middle-market private equity firm.">
</head><body>
<h2>Leadership</h2>
<p>Jane Doe — Managing Partner</p>
<p>John Smith, Chief Investment Officer</p>
<a href="mailto:ir@cedarridge.com">Contact IR</a>
</body></html>`;

describe("public-web — parsing", () => {
  it("validates and rejects unsafe URLs", () => {
    expect(parsePublicUrl("https://cedarridge.com/team")?.host).toBe("cedarridge.com");
    expect(parsePublicUrl("http://localhost/x")).toBeNull();
    expect(parsePublicUrl("http://192.168.1.10/x")).toBeNull();
    expect(parsePublicUrl("ftp://cedarridge.com")).toBeNull();
    expect(parsePublicUrl("not a url")).toBeNull();
  });

  it("evaluates robots.txt best-effort for the wildcard agent", () => {
    const robots = "User-agent: *\nDisallow: /private\n";
    expect(isAllowedByRobots(robots, "/team")).toBe(true);
    expect(isAllowedByRobots(robots, "/private/board")).toBe(false);
    expect(isAllowedByRobots("", "/anything")).toBe(true);
  });

  it("extracts title, meta description, email, and leadership hints from HTML", () => {
    const points = extractDataPointsFromHtml(SAMPLE_HTML, {
      url: "https://cedarridge.com/team",
      source: "company_website",
    });
    const byName = Object.fromEntries(points.map((p) => [p.field_name, p]));
    expect(byName.company_name.extracted_value).toBe("Cedar Ridge Capital — Home");
    expect(byName.company_description.extracted_value).toContain("private equity");
    expect(byName.contact_email_1.extracted_value).toBe("ir@cedarridge.com");

    const people = points.filter((p) => p.field_name.startsWith("person_"));
    expect(people.length).toBeGreaterThan(0);
    expect(people.some((p) => p.extracted_value.includes("Jane Doe"))).toBe(true);

    // Public-web is corroboration-grade: always requires confirmation.
    for (const p of points) expect(p.requires_user_confirmation).toBe(true);
  });

  it("strips script/style even with whitespace end tags and no leftover markup (CWE-116)", () => {
    const html =
      "<html><head><title>Acme &amp;lt;Co&amp;gt;</title>" +
      "<script >window.x='<b>leak</b>'</script >" +
      "<style\n>.a{color:red}</style>" +
      "</head><body><p>Contact ir@acme.com</p></body></html>";
    const points = extractDataPointsFromHtml(html, { url: "https://acme.com" });
    const values = points.map((p) => p.extracted_value).join(" | ");
    // No script/style contents survive the strip.
    expect(values).not.toContain("window.x");
    expect(values).not.toContain("color:red");
    // "&amp;lt;" decodes to the literal "&lt;", not double-unescaped to "<".
    const title = points.find((p) => p.field_name === "company_name");
    expect(title?.extracted_value).toBe("Acme &lt;Co&gt;");
  });

  it("fetches a page via injected HTTP and returns points", async () => {
    const http = fakeFetch({ "https://cedarridge.com/team": SAMPLE_HTML });
    const res = await extractFromPublicWeb({ url: "https://cedarridge.com/team", http, skipRobots: true });
    expect(res.ok).toBe(true);
    if (res.ok) expect(res.points.length).toBeGreaterThan(0);
  });

  it("rejects a private-host URL before fetching", async () => {
    const res = await extractFromPublicWeb({ url: "http://localhost/x", http: fakeFetch({}) });
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.reason).toBe("invalid_url");
  });
});

// ── Extraction engine (fake Supabase) ──────────────────────────────────────────

function baseSession(status: string): EarnBrowserSession {
  return {
    id: "sess-1",
    organization_id: "org-1",
    user_id: "user-1",
    task_id: null,
    status,
    requested_prompt: "Research Apple on EDGAR",
    approved_scope: null,
    requires_user_auth: false,
    auth_handoff_completed: false,
    current_url: null,
    review_required: true,
    save_approved: false,
    external_action_approved: false,
    created_at: "2026-07-05T00:00:00.000Z",
    updated_at: "2026-07-05T00:00:00.000Z",
    completed_at: null,
  };
}

type Ctx = { table: string; op: string | null; payload: Record<string, unknown> | null };

function makeFakeSupabase(session: EarnBrowserSession) {
  let current = { ...session };
  const audits: Array<Record<string, unknown>> = [];
  const reviewInserts: Array<Record<string, unknown>> = [];

  function resolve(ctx: Ctx) {
    if (ctx.table === "earn_browser_sessions" && ctx.op === "update") {
      current = { ...current, ...(ctx.payload ?? {}) } as EarnBrowserSession;
      return { data: current, error: null };
    }
    if (ctx.table === "earn_browser_audit_logs" && ctx.op === "insert") {
      audits.push(ctx.payload ?? {});
      return { data: null, error: null };
    }
    if (ctx.table === "earn_review_queue" && ctx.op === "insert") {
      reviewInserts.push(ctx.payload ?? {});
      return { data: { id: "review-123" }, error: null };
    }
    return { data: null, error: null };
  }

  const client = {
    from(table: string) {
      const ctx: Ctx = { table, op: null, payload: null };
      const builder: Record<string, unknown> = {
        insert(p: Record<string, unknown>) { ctx.op = "insert"; ctx.payload = p; return builder; },
        update(p: Record<string, unknown>) { ctx.op = "update"; ctx.payload = p; return builder; },
        select() { return builder; },
        eq() { return builder; },
        maybeSingle() { return Promise.resolve(resolve(ctx)); },
        single() { return Promise.resolve(resolve(ctx)); },
        then(onF: (v: unknown) => unknown, onR?: (e: unknown) => unknown) {
          return Promise.resolve(resolve(ctx)).then(onF, onR);
        },
      };
      return builder;
    },
  };

  return { client, audits, reviewInserts, getSession: () => current };
}

type EngineSupabase = Parameters<typeof runExtraction>[0];

describe("extraction-engine", () => {
  it("builds a review record and drives the session to awaiting_user_review", async () => {
    const fake = makeFakeSupabase(baseSession("navigating"));
    const http = fakeFetch({ [TICKERS_URL]: SAMPLE_TICKERS, [SUBMISSIONS_URL]: SAMPLE_SUBMISSIONS });

    const result = await runExtraction(fake.client as unknown as EngineSupabase, {
      session: baseSession("navigating"),
      source: "edgar",
      target: { query: "AAPL" },
      http,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.reviewQueueId).toBe("review-123");
      expect(result.session.status).toBe("awaiting_user_review");
      expect(result.review.summary.total).toBeGreaterThan(0);
      // EDGAR is high-confidence — nothing blocks.
      expect(result.review.summary.needs_confirmation).toBe(false);
    }
    // A data_extracted audit row was written.
    expect(fake.audits.some((a) => a.action === "data_extracted")).toBe(true);
  });

  it("flags low-confidence public-web fields as needing confirmation", async () => {
    const fake = makeFakeSupabase(baseSession("navigating"));
    const http = fakeFetch({ "https://cedarridge.com/team": SAMPLE_HTML });

    const result = await runExtraction(fake.client as unknown as EngineSupabase, {
      session: baseSession("navigating"),
      source: "public_web",
      target: { url: "https://cedarridge.com/team" },
      http,
    });

    expect(result.ok).toBe(true);
    if (result.ok) {
      // public_web base confidence (50) < threshold (60): every field blocks.
      expect(result.review.summary.low_confidence).toBeGreaterThan(0);
      expect(result.review.summary.needs_confirmation).toBe(true);
    }
  });

  it("rejects a disallowed (authenticated) source via policy", async () => {
    const fake = makeFakeSupabase(baseSession("navigating"));
    const result = await runExtraction(fake.client as unknown as EngineSupabase, {
      session: baseSession("navigating"),
      source: "linkedin",
      target: { url: "https://linkedin.com/in/x" },
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("policy_rejected");
  });

  it("rejects extraction from an illegal session state", async () => {
    const fake = makeFakeSupabase(baseSession("planned"));
    const http = fakeFetch({ [TICKERS_URL]: SAMPLE_TICKERS, [SUBMISSIONS_URL]: SAMPLE_SUBMISSIONS });
    const result = await runExtraction(fake.client as unknown as EngineSupabase, {
      session: baseSession("planned"),
      source: "edgar",
      target: { query: "AAPL" },
      http,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.reason).toBe("illegal_transition");
  });
});
