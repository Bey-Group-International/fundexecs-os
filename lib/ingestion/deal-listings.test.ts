// lib/ingestion/deal-listings.test.ts
// Unit tests for the deterministic deal-listing parser — the path that runs
// keyless in CI. No model, no network.
import {
  parseMoney,
  parsePercent,
  extractFinancials,
  extractContact,
  extractLocationText,
  marketplaceForUrl,
  parseDealListings,
  formatMoney,
  formatListingNotes,
  listingToDealRow,
  type DealListing,
  __test,
} from "@/lib/ingestion/deal-listings";

describe("parseMoney", () => {
  it("parses comma-grouped dollars", () => {
    expect(parseMoney("$1,250,000")).toBe(1_250_000);
    expect(parseMoney("1,250,000")).toBe(1_250_000);
  });
  it("parses K/M/B and word suffixes", () => {
    expect(parseMoney("$1.25M")).toBe(1_250_000);
    expect(parseMoney("$950K")).toBe(950_000);
    expect(parseMoney("1.2 million")).toBe(1_200_000);
    expect(parseMoney("USD 1.2mm")).toBe(1_200_000);
    expect(parseMoney("$2B")).toBe(2_000_000_000);
  });
  it("passes numbers through", () => {
    expect(parseMoney(499000)).toBe(499_000);
    expect(parseMoney(0)).toBeNull();
  });
  it("returns null for undisclosed / non-numeric", () => {
    expect(parseMoney("Contact for Price")).toBeNull();
    expect(parseMoney("Undisclosed")).toBeNull();
    expect(parseMoney("Call for details")).toBeNull();
    expect(parseMoney("")).toBeNull();
    expect(parseMoney(null)).toBeNull();
  });
});

describe("parsePercent", () => {
  it("parses a percentage", () => {
    expect(parsePercent("7.5%")).toBe(7.5);
    expect(parsePercent("Cap Rate: 6%")).toBe(6);
  });
  it("rejects out-of-range / missing", () => {
    expect(parsePercent("no percent")).toBeNull();
    expect(parsePercent("250%")).toBeNull();
  });
});

describe("extractFinancials", () => {
  it("pulls the standard labeled fields from listing text", () => {
    const text =
      "Asking Price: $1,250,000 Cash Flow: $320,000 Gross Revenue: $1.4M EBITDA $290K Cap Rate: 7.5%";
    expect(extractFinancials(text)).toEqual({
      askingPrice: 1_250_000,
      cashFlow: 320_000,
      revenue: 1_400_000,
      ebitda: 290_000,
      capRate: 7.5,
    });
  });
  it("handles SDE as a cash-flow synonym and undisclosed price", () => {
    const text = "Asking Price: Contact for Price. SDE: $410,000. Annual Revenue $2,100,000.";
    const f = extractFinancials(text);
    expect(f.askingPrice).toBeNull();
    expect(f.cashFlow).toBe(410_000);
    expect(f.revenue).toBe(2_100_000);
  });
});

describe("extractContact", () => {
  it("finds broker name, email, phone and skips platform emails", () => {
    const text = "Listing Agent: Jane Doe. Email support@bizbuysell.com or jane.doe@brokers.com (415) 555-1234";
    const c = extractContact(text);
    expect(c.name).toBe("Jane Doe");
    expect(c.email).toBe("jane.doe@brokers.com");
    expect(c.phone).toBe("(415) 555-1234");
  });
});

describe("extractLocationText", () => {
  it("reads a City, ST phrase", () => {
    expect(extractLocationText("Located in Austin, TX with strong margins")).toBe("Austin, TX");
    expect(extractLocationText("Denver, CO")).toBe("Denver, CO");
  });
});

describe("marketplaceForUrl", () => {
  it("identifies each top network", () => {
    expect(marketplaceForUrl("https://www.loopnet.com/Listing/123").key).toBe("loopnet");
    expect(marketplaceForUrl("https://www.crexi.com/properties/456").key).toBe("crexi");
    expect(marketplaceForUrl("https://www.bizbuysell.com/Business-Opportunity/789/").key).toBe("bizbuysell");
    expect(marketplaceForUrl("https://us.businessesforsale.com/us/x.aspx").key).toBe("businessesforsale");
    expect(marketplaceForUrl("https://www.tworld.com/listing/abc").key).toBe("transworld");
    expect(marketplaceForUrl("https://example.com/x").key).toBe("generic");
  });
});

describe("parseDealListings — JSON-LD search results", () => {
  const html = `
    <script type="application/ld+json">
    {"@context":"https://schema.org","@type":"ItemList","itemListElement":[
      {"@type":"ListItem","item":{"@type":"Product","name":"HVAC Company","url":"https://www.bizbuysell.com/Business-Opportunity/1/","offers":{"@type":"Offer","price":"1250000","priceCurrency":"USD"},"category":"Home Services","description":"Established HVAC business."}},
      {"@type":"ListItem","item":{"@type":"Product","name":"Coffee Roaster","url":"https://www.bizbuysell.com/Business-Opportunity/2/","offers":{"price":"890000"},"address":{"addressLocality":"Portland","addressRegion":"OR"}}}
    ]}
    </script>`;

  it("extracts every listing with price, url, category, and location", () => {
    const out = parseDealListings({ url: "https://www.bizbuysell.com/search", html });
    expect(out).toHaveLength(2);
    const hvac = out.find((l) => l.name === "HVAC Company")!;
    expect(hvac.askingPrice).toBe(1_250_000);
    expect(hvac.source).toBe("bizbuysell");
    expect(hvac.category).toBe("Home Services");
    expect(hvac.url).toBe("https://www.bizbuysell.com/Business-Opportunity/1/");
    const coffee = out.find((l) => l.name === "Coffee Roaster")!;
    expect(coffee.askingPrice).toBe(890_000);
    expect(coffee.location).toBe("Portland, OR");
    // No category on the node → marketplace default fills in.
    expect(coffee.category).toBe("business");
  });
});

describe("parseDealListings — single detail page via labels", () => {
  const html = `
    <title>Profitable Auto Repair Shop for Sale | Crexi</title>
    <meta name="description" content="Turnkey auto shop in a growing market." />
    <div>Asking Price: $2,400,000</div>
    <div>Cash Flow: $560,000</div>
    <div>Gross Revenue: $3.1M</div>
    <div>Cap Rate: 8%</div>
    <div>Location: Phoenix, AZ</div>
    <div>Listed by John Smith — john.smith@crexibrokers.com 602-555-9090</div>`;

  it("parses financials, location, and broker contact from a CRE detail page", () => {
    const out = parseDealListings({ url: "https://www.crexi.com/properties/999/auto-shop", html });
    expect(out).toHaveLength(1);
    const l = out[0];
    expect(l.name).toBe("Profitable Auto Repair Shop for Sale");
    expect(l.source).toBe("crexi");
    expect(l.askingPrice).toBe(2_400_000);
    expect(l.cashFlow).toBe(560_000);
    expect(l.revenue).toBe(3_100_000);
    expect(l.capRate).toBe(8);
    expect(l.location).toBe("Phoenix, AZ");
    expect(l.contactName).toBe("John Smith");
    expect(l.contactEmail).toBe("john.smith@crexibrokers.com");
    // CRE marketplace default applied when node has no category.
    expect(l.category).toBe("commercial_real_estate");
  });

  it("returns nothing when a page has no listing signal", () => {
    expect(parseDealListings({ url: "https://www.loopnet.com/x", html: "<div>hello</div>" })).toEqual([]);
  });
});

describe("parseDealListings — JSON-LD + labels reinforce on a detail page", () => {
  it("merges the priced JSON-LD node with labeled cash flow / revenue", () => {
    const html = `
      <title>Downtown Retail Building | LoopNet</title>
      <script type="application/ld+json">
      {"@type":"RealEstateListing","name":"Downtown Retail Building","url":"https://www.loopnet.com/Listing/5/","offers":{"price":"4500000"}}
      </script>
      <div>Cap Rate: 6.25%</div>
      <div>Net Operating Income: $281,000</div>`;
    const out = parseDealListings({ url: "https://www.loopnet.com/Listing/5/downtown", html });
    expect(out).toHaveLength(1);
    expect(out[0].askingPrice).toBe(4_500_000);
    expect(out[0].capRate).toBe(6.25);
  });
});

describe("formatMoney / formatListingNotes / listingToDealRow", () => {
  const listing: DealListing = {
    name: "HVAC Company",
    source: "bizbuysell",
    sourceLabel: "BizBuySell",
    url: "https://www.bizbuysell.com/Business-Opportunity/1/",
    askingPrice: 1_250_000,
    cashFlow: 320_000,
    revenue: 1_400_000,
    ebitda: null,
    capRate: null,
    location: "Austin, TX",
    category: "home_services",
    description: "Established HVAC business with recurring contracts.",
    contactName: "Jane Doe",
    contactEmail: "jane@brokers.com",
    contactPhone: "(415) 555-1234",
    evidence: "schema.org/JSON-LD",
  };

  it("formats money compactly", () => {
    expect(formatMoney(1_250_000)).toBe("$1.25M");
    expect(formatMoney(950_000)).toBe("$950K");
    expect(formatMoney(0)).toBeNull();
  });

  it("packs financials + provenance into the notes block", () => {
    const notes = formatListingNotes(listing);
    expect(notes).toContain("Asking $1.25M");
    expect(notes).toContain("Cash Flow $320K");
    expect(notes).toContain("Revenue $1.4M");
    expect(notes).toContain("Broker: Jane Doe");
    expect(notes).toContain("Listed on BizBuySell");
  });

  it("maps a listing onto deals columns", () => {
    const row = listingToDealRow(listing);
    expect(row.provenance).toBe("web_ingest");
    expect(row.target_amount).toBe(1_250_000);
    expect(row.geography).toBe("Austin, TX");
    expect(row.asset_class).toBe("home_services");
    expect(row.source).toBe("BizBuySell");
    expect(row.url_source).toBe(listing.url);
    expect(row.contact_email).toBe("jane@brokers.com");
    expect(row.verification_note).toBe(listing.url);
  });
});

describe("mergeDedupe", () => {
  it("merges two records of the same listing, filling blanks", () => {
    const a = { name: "Shop", url: "u", askingPrice: 100, cashFlow: null } as unknown as DealListing;
    const b = { name: "shop", url: "u", askingPrice: null, cashFlow: 50 } as unknown as DealListing;
    const merged = __test.mergeDedupe([a, b]);
    expect(merged).toHaveLength(1);
    expect(merged[0].askingPrice).toBe(100);
    expect(merged[0].cashFlow).toBe(50);
  });
});
