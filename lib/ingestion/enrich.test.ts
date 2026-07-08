// lib/ingestion/enrich.test.ts
// Unit tests for the enrich orchestration + pure helpers. The fetcher is stubbed
// so there's no network; extraction falls back deterministically with no key.
import { enrichFromWeb, extractHeadlines, normalizeDomain } from "@/lib/ingestion/enrich";
import type { FetcherStrategy, FetchResult } from "@/lib/ingestion/fetcher";

const stubFetcher = (result: Partial<FetchResult>): FetcherStrategy => ({
  fetch: async (url) => ({ url, ok: true, status: 200, html: "", contentType: "text/html", ...result }),
});

describe("normalizeDomain", () => {
  it("strips scheme, path, and www", () => {
    expect(normalizeDomain("https://www.Acme.com/team")).toBe("acme.com");
    expect(normalizeDomain("acme.com")).toBe("acme.com");
    expect(normalizeDomain("  HTTP://Acme.com  ")).toBe("acme.com");
  });
});

describe("extractHeadlines", () => {
  it("collects title, meta, and h1/h2, de-duped", () => {
    const html = `
      <title>Acme Capital | Home</title>
      <meta name="description" content="Record growth this quarter">
      <h1>Acme posts record profit</h1>
      <h2>Analysts upgrade Acme</h2>
      <h2>Analysts upgrade Acme</h2>`;
    const hs = extractHeadlines(html);
    expect(hs).toContain("Acme Capital");
    expect(hs).toContain("Record growth this quarter");
    expect(hs).toContain("Acme posts record profit");
    // The duplicate h2 appears once.
    expect(hs.filter((h) => h === "Analysts upgrade Acme")).toHaveLength(1);
  });

  it("matches heading end tags with whitespace before '>'", () => {
    expect(extractHeadlines("<h1>Record profit</h1>")).toContain("Record profit");
  });

  it("returns [] for empty markup", () => {
    expect(extractHeadlines("<div>nothing</div>")).toEqual([]);
  });
});

describe("enrichFromWeb", () => {
  it("errors on a missing domain without fetching", async () => {
    const res = await enrichFromWeb({ subjectName: "Acme", kind: "company", domain: "" });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("no_domain");
  });

  it("returns a reasoned empty result when the fetch is blocked", async () => {
    const res = await enrichFromWeb({
      subjectName: "Acme",
      kind: "company",
      domain: "acme.com",
      fetcher: stubFetcher({ ok: false, reason: "robots", html: "" }),
    });
    expect(res.ok).toBe(false);
    expect(res.reason).toBe("robots");
    expect(res.sourceUrl).toBe("https://acme.com");
  });

  it("produces a refreshed entity and a positive news signal from a good page", async () => {
    const html = `
      <title>Acme Capital</title>
      <meta name="description" content="A growth-equity firm">
      <h1>Acme posts record profit and strong growth</h1>`;
    const res = await enrichFromWeb({
      subjectName: "Acme Capital",
      entityId: "e1",
      kind: "company",
      domain: "acme.com",
      fetcher: stubFetcher({ html }),
    });
    expect(res.ok).toBe(true);
    expect(res.entity?.name).toBe("Acme Capital");
    expect(res.entity?.provenance).toBe("web_enrich");
    expect(res.newsSignal?.signalType).toBe("news");
    expect((res.newsSignal?.metadata as { label: string }).label).toBe("positive");
  });

  it("still returns ok with no news signal when coverage is neutral", async () => {
    const html = `<title>Acme Capital</title><h1>Annual meeting held on Tuesday</h1>`;
    const res = await enrichFromWeb({
      subjectName: "Acme Capital",
      kind: "company",
      domain: "acme.com",
      fetcher: stubFetcher({ html }),
    });
    expect(res.ok).toBe(true);
    expect(res.newsSignal).toBeUndefined();
  });
});
