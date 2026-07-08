// lib/ingestion/extract.test.ts
// Unit tests for the deterministic extraction path — the fallback that runs
// keyless in CI. No model, no network.
import {
  stripHtml,
  extractTitle,
  extractMetaDescription,
  extractJsonLd,
  organizationFromJsonLd,
  domainOf,
  guessCategories,
  heuristicExtract,
  __test,
} from "@/lib/ingestion/extract";

describe("stripHtml", () => {
  it("removes tags, scripts, and styles and collapses whitespace", () => {
    const html = "<style>.x{}</style><p>Hello   <b>World</b></p><script>bad()</script>";
    expect(stripHtml(html)).toBe("Hello World");
  });

  it("decodes common entities", () => {
    expect(stripHtml("A &amp; B &lt;x&gt;")).toBe("A & B <x>");
  });

  it("strips script/style end tags that carry whitespace or attributes before '>'", () => {
    // Regression (CodeQL js/bad-tag-filter): a crafted "</script >" or
    // "</style foo>" must not leak the element body through as text.
    expect(stripHtml("<script>evil()</script >Visible")).toBe("Visible");
    expect(stripHtml("<style>.x{}</style\t>Shown")).toBe("Shown");
    expect(stripHtml("<script>x</script foo=bar>After")).toBe("After");
  });

  it("does not double-unescape entities", () => {
    // Regression (CodeQL js/double-unescaping): decoding "&amp;" runs last so
    // "&amp;lt;" yields the literal text "&lt;", not the character "<".
    expect(stripHtml("&amp;lt;")).toBe("&lt;");
    expect(stripHtml("a &amp;amp; b")).toBe("a &amp; b");
  });
});

describe("extractTitle", () => {
  it("pulls the title and trims a site-name suffix", () => {
    expect(extractTitle("<title>Acme Capital | Home</title>")).toBe("Acme Capital");
    expect(extractTitle("<title>Acme Capital - Investors</title>")).toBe("Acme Capital");
  });

  it("returns null with no title", () => {
    expect(extractTitle("<h1>no title</h1>")).toBeNull();
  });
});

describe("extractMetaDescription", () => {
  it("reads name=description", () => {
    const html = `<meta name="description" content="A growth-equity firm.">`;
    expect(extractMetaDescription(html)).toBe("A growth-equity firm.");
  });

  it("falls back to og:description", () => {
    const html = `<meta property="og:description" content="OG blurb.">`;
    expect(extractMetaDescription(html)).toBe("OG blurb.");
  });
});

describe("extractJsonLd / organizationFromJsonLd", () => {
  it("parses an Organization node", () => {
    const html = `<script type="application/ld+json">
      {"@type":"Organization","name":"Acme Capital","description":"PE firm",
       "address":{"addressLocality":"Boston","addressRegion":"MA","addressCountry":"US"}}
    </script>`;
    const org = organizationFromJsonLd(extractJsonLd(html));
    expect(org?.name).toBe("Acme Capital");
    expect(org?.description).toBe("PE firm");
    expect(org?.geography).toBe("Boston, MA, US");
  });

  it("skips malformed JSON-LD without throwing", () => {
    const html = `<script type="application/ld+json">{ not json }</script>`;
    expect(extractJsonLd(html)).toEqual([]);
  });

  it("returns null when there is no organization node", () => {
    const html = `<script type="application/ld+json">{"@type":"WebPage","name":"x"}</script>`;
    expect(organizationFromJsonLd(extractJsonLd(html))).toBeNull();
  });
});

describe("domainOf", () => {
  it("strips www and lower-cases", () => {
    expect(domainOf("https://WWW.Acme.com/team")).toBe("acme.com");
  });
  it("returns null for garbage", () => {
    expect(domainOf("not a url")).toBeNull();
  });
});

describe("guessCategories", () => {
  it("tags known verticals from text", () => {
    const cats = guessCategories("A fintech payments platform for lending");
    expect(cats).toContain("fintech");
  });
  it("returns empty for unknown text", () => {
    expect(guessCategories("lorem ipsum dolor")).toEqual([]);
  });
});

describe("heuristicExtract", () => {
  it("prefers JSON-LD and marks its evidence", () => {
    const html = `<title>Ignored | Site</title>
      <script type="application/ld+json">{"@type":"Organization","name":"Acme Capital"}</script>`;
    const out = heuristicExtract({ url: "https://acme.com", html, targetKind: "company" });
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Acme Capital");
    expect(out[0].domain).toBe("acme.com");
    expect(out[0].evidence).toBe("schema.org/Organization");
  });

  it("falls back to title + meta when no JSON-LD", () => {
    const html = `<title>Beta Partners | Home</title><meta name="description" content="A fund.">`;
    const out = heuristicExtract({ url: "https://beta.com", html, targetKind: "investor" });
    expect(out[0].name).toBe("Beta Partners");
    expect(out[0].kind).toBe("investor");
    expect(out[0].evidence).toBe("title+meta");
  });

  it("returns nothing when there is no name signal at all", () => {
    expect(heuristicExtract({ url: "https://x.com", html: "<div>hi</div>", targetKind: "company" })).toEqual([]);
  });
});

describe("parseModelEntities", () => {
  const input = { url: "https://acme.com", html: "", targetKind: "company" as const };

  it("parses a JSON array embedded in prose", () => {
    const raw = 'Here you go:\n[{"name":"Acme","kind":"company","categories":["saas"]}]\nDone.';
    const out = __test.parseModelEntities(raw, input);
    expect(out).toHaveLength(1);
    expect(out[0].name).toBe("Acme");
    expect(out[0].domain).toBe("acme.com");
  });

  it("drops entries with no name and returns [] on non-JSON", () => {
    expect(__test.parseModelEntities("no array here", input)).toEqual([]);
    expect(__test.parseModelEntities('[{"kind":"company"}]', input)).toEqual([]);
  });
});
