import {
  blockingDuplicates,
  findDuplicates,
  fromCsvRow,
  fromLinkedInUrl,
  fromManualEntry,
  inferCapitalRole,
  initialScores,
  linkedinApiConnector,
  nameFromLinkedInSlug,
  normalizeLinkedInUrl,
  scoreRelevance,
  scoreStrength,
  strengthLabel,
} from "./index";
import { formatPromptBlock } from "@/lib/copilot/context/relationship-context-provider";
import type { ExistingContactRef, NormalizedProfile } from "./types";

describe("normalizeLinkedInUrl", () => {
  it("canonicalizes profile URLs and rejects non-LinkedIn hosts", () => {
    expect(normalizeLinkedInUrl("linkedin.com/in/jane-doe/")).toBe("https://www.linkedin.com/in/jane-doe");
    expect(normalizeLinkedInUrl("https://www.linkedin.com/in/jane-doe?utm=x")).toBe("https://www.linkedin.com/in/jane-doe");
    expect(normalizeLinkedInUrl("https://evil.com/in/jane-doe")).toBeNull();
    expect(normalizeLinkedInUrl("https://linkedin.com/feed/")).toBeNull();
    expect(normalizeLinkedInUrl("")).toBeNull();
  });

  it("guesses a display name from an /in/ slug, dropping id noise", () => {
    expect(nameFromLinkedInSlug("https://www.linkedin.com/in/jane-a-doe-1b2c3d4")).toEqual({
      first: "Jane",
      last: "A Doe",
    });
  });
});

describe("adapters", () => {
  it("linkedin_url adapter stores a reference with low confidence, no scraping", () => {
    const result = fromLinkedInUrl({ linkedinUrl: "linkedin.com/in/marcus-hill" });
    expect("error" in result).toBe(false);
    const profile = result as NormalizedProfile;
    expect(profile.source).toBe("linkedin_url");
    expect(profile.first_name).toBe("Marcus");
    expect(profile.linkedin_url).toBe("https://www.linkedin.com/in/marcus-hill");
    expect(profile.confidence).toBeLessThan(60);
  });

  it("manual adapter trusts identity and infers capital role from title", () => {
    const result = fromManualEntry({
      fullName: "Ada Chen",
      title: "Managing Partner",
      company: "Chen Family Office",
      email: "ADA@example.com ",
    });
    const profile = result as NormalizedProfile;
    expect(profile.email).toBe("ada@example.com");
    expect(profile.capital_role).toBe("family_office");
    expect(profile.confidence).toBeGreaterThanOrEqual(70);
  });

  it("csv adapter (fallback) maps parsed rows through the same pipeline", () => {
    const result = fromCsvRow({
      firstName: "Ravi",
      lastName: "Patel",
      email: null,
      company: "Northgate Credit",
      title: "Director, Direct Lending",
      linkedinUrl: null,
      phone: null,
      city: "Chicago",
      state: "IL",
      country: null,
      connectedOn: "2023-04-01",
      source: "linkedin_csv",
    });
    const profile = result as NormalizedProfile;
    expect(profile.source).toBe("linkedin_csv");
    expect(profile.capital_role).toBe("lender");
    expect(profile.location).toBe("Chicago, IL");
  });

  it("rejects input with no identity at all", () => {
    expect(fromManualEntry({})).toEqual({ error: expect.stringContaining("name") });
  });
});

describe("capital role inference", () => {
  it.each([
    ["Limited Partner", null, "limited_partner"],
    ["Managing Partner", "Hillstone Capital Partners", "fund_manager"],
    ["VP Lending", "Private Credit Fund", "lender"],
    ["CEO", null, "operator"],
    ["Attorney", null, "advisor"],
    [null, null, "unknown"],
  ])("title=%s company=%s → %s", (title, company, expected) => {
    expect(inferCapitalRole(title as string | null, company as string | null)).toBe(expected);
  });
});

describe("dedupe", () => {
  const existing: ExistingContactRef[] = [
    { id: "1", full_name: "Jane Doe", first_name: "Jane", last_name: "Doe", email: "jane@x.com", linkedin_url: "https://www.linkedin.com/in/jane-doe", company: "Acme Capital" },
    { id: "2", full_name: "John Roe", first_name: "John", last_name: "Roe", email: null, linkedin_url: null, company: "Roe Partners" },
  ];

  const base: NormalizedProfile = {
    first_name: "Jane", last_name: "Doe", email: null, phone: null,
    linkedin_url: null, title: null, company: null, location: null,
    capital_role: "unknown", tags: [], notes: null, connected_on: null,
    source: "manual", confidence: 70,
  };

  it("email and linkedin matches are blocking; bare name match is advisory", () => {
    const emailMatch = findDuplicates({ ...base, email: "jane@x.com" }, existing);
    expect(emailMatch[0]).toMatchObject({ contactId: "1", matchedOn: "email" });
    expect(blockingDuplicates(emailMatch)).toHaveLength(1);

    const nameOnly = findDuplicates(base, existing);
    expect(nameOnly[0]).toMatchObject({ matchedOn: "name", matchConfidence: 60 });
    expect(blockingDuplicates(nameOnly)).toHaveLength(0);

    const nameCompany = findDuplicates({ ...base, company: "Acme Capital" }, existing);
    expect(nameCompany[0]).toMatchObject({ matchedOn: "name_company", matchConfidence: 90 });
    expect(blockingDuplicates(nameCompany)).toHaveLength(1);
  });
});

describe("scoring", () => {
  it("strength rewards volume and recency, decays with staleness", () => {
    const hot = scoreStrength({ interactions: 12, daysSinceLastInteraction: 3, daysConnected: 800 });
    const cold = scoreStrength({ interactions: 1, daysSinceLastInteraction: 400, daysConnected: 800 });
    expect(hot).toBeGreaterThan(70);
    expect(cold).toBeLessThan(30);
    expect(strengthLabel(hot)).toMatch(/strong|active/);
    expect(strengthLabel(cold)).toBe("cold");
  });

  it("relevance weights capital roles and scope keywords", () => {
    const lp = scoreRelevance({ capitalRole: "limited_partner", title: "Director of Investments", tags: ["lp"] });
    const vendor = scoreRelevance({ capitalRole: "service_provider", title: null, tags: [] });
    expect(lp).toBeGreaterThan(vendor + 30);

    const unscoped = scoreRelevance({ capitalRole: "lender", title: "Credit Partner", tags: [] });
    const scoped = scoreRelevance({
      capitalRole: "lender", title: "Credit Partner", tags: ["acquisition financing"],
      scopeKeywords: ["acquisition", "financing"],
    });
    expect(scoped).toBeGreaterThan(unscoped);
  });

  it("initialScores derives strength from tenure only (no interactions yet)", () => {
    const profile = fromManualEntry({ fullName: "New Person" }) as NormalizedProfile;
    const scores = initialScores(profile);
    expect(scores.strength).toBeLessThan(25);
    expect(scores.strengthLabel).toBe("cold");
  });
});

describe("backend connectors", () => {
  it("linkedin connector reports unavailable with guidance when no API creds", () => {
    const availability = linkedinApiConnector.availability();
    if (!availability.available) {
      expect(availability.reason).toMatch(/official API/i);
    }
  });
});

describe("copilot prompt block", () => {
  it("carries evidence (scores, source, confidence) and the approval rule", () => {
    const block = formatPromptBlock([
      {
        contactId: "1", fullName: "Marcus Hill", title: "Managing Partner",
        company: "Hillstone Capital", capitalRole: "lender", relevance: 86,
        strength: 74, strengthLabel: "active", confidence: 81,
        source: "linkedin_csv", tags: ["credit"], lastNote: null,
      },
    ]);
    expect(block).toContain("Marcus Hill");
    expect(block).toContain("relevance 86/100");
    expect(block).toContain("confidence 81/100");
    expect(block).toContain("linkedin csv");
    expect(block).toMatch(/approval before sending/i);
    expect(formatPromptBlock([])).toBe("");
  });
});
