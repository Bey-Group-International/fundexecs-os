// Coverage for the chat contact-enrichment seam. The contracts:
//   - never fabricate: no APOLLO_API_KEY → buildContactAppendix returns ""
//   - the pre-filter only fires on entity-ish text
//   - enrichment surfaces only contactable people (email or phone) from Apollo,
//     de-duplicated, and formats an Apollo-attributed appendix
//   - Apollo is called through the real provider seam (mocked here)

import {
  mightMentionEntity,
  formatContactAppendix,
  enrichEntities,
  extractEntities,
  extractEntitiesDeterministic,
  buildContactAppendix,
  type EnrichedContacts,
} from "./chat-enrichment";
import type { VerifiedPerson, VerifiedResult } from "./source-hub-types";
import { searchPeople, enrichOrganization } from "./integrations/providers/apollo";

jest.mock("./integrations/providers/apollo", () => ({
  searchPeople: jest.fn(),
  enrichOrganization: jest.fn(),
}));

const mockSearchPeople = searchPeople as jest.MockedFunction<typeof searchPeople>;
const mockEnrichOrg = enrichOrganization as jest.MockedFunction<typeof enrichOrganization>;

function ok<T>(data: T): VerifiedResult<T> {
  return {
    status: "success",
    verified: true,
    confidence: 0.8,
    timestamp: "2026-01-01T00:00:00Z",
    sources: [],
    data,
  };
}

function person(overrides: Partial<VerifiedPerson>): VerifiedPerson {
  return {
    name: "Jane Doe",
    provenance: "apollo",
    confidence: 0.82,
    ...overrides,
  };
}

beforeEach(() => {
  mockSearchPeople.mockReset();
  mockEnrichOrg.mockReset();
  delete process.env.APOLLO_API_KEY;
  delete process.env.ANTHROPIC_API_KEY;
});

describe("mightMentionEntity", () => {
  it("fires on org suffixes and reach intent", () => {
    expect(mightMentionEntity("Blackstone Capital Partners is a big firm")).toBe(true);
    expect(mightMentionEntity("who runs their real estate group?")).toBe(true);
    expect(mightMentionEntity("get me the email for their CIO")).toBe(true);
  });

  it("stays quiet on casual chat", () => {
    expect(mightMentionEntity("what's on my plate today?")).toBe(false);
    expect(mightMentionEntity("summarize my open diligence")).toBe(false);
  });
});

describe("formatContactAppendix", () => {
  it("returns empty string when nothing verified", () => {
    expect(formatContactAppendix({ people: [], companies: [] })).toBe("");
  });

  it("renders only the reach fields Apollo returned, attributed to Apollo", () => {
    const enriched: EnrichedContacts = {
      people: [
        person({ name: "Jon Gray", title: "President", company: "Blackstone", email: "jg@bx.com", phone: "+1 212-555-0100", linkedin_url: "https://linkedin.com/in/jongray" }),
      ],
      companies: [],
    };
    const out = formatContactAppendix(enriched);
    expect(out).toContain("Verified contacts");
    expect(out).toContain("source: Apollo.io");
    expect(out).toContain("**Jon Gray** — President, Blackstone");
    expect(out).toContain("📞 +1 212-555-0100");
    expect(out).toContain("✉️ jg@bx.com");
    expect(out).toContain("[LinkedIn](https://linkedin.com/in/jongray)");
    expect(out).toContain("confidence 82%");
  });

  it("omits a reach line entirely when there is no email/phone/linkedin", () => {
    const out = formatContactAppendix({ people: [person({ email: undefined, phone: undefined })], companies: [] });
    expect(out).toContain("**Jane Doe**");
    expect(out).not.toContain("📞");
    expect(out).not.toContain("✉️");
  });
});

describe("enrichEntities", () => {
  it("keeps only contactable people and de-duplicates by email", async () => {
    mockSearchPeople.mockImplementation(async (params) => {
      if (params.name === "Jon Gray") return ok([person({ name: "Jon Gray", email: "jg@bx.com", phone: "+1 212-555-0100" })]);
      if (params.company === "Blackstone") return ok([person({ name: "Jon Gray", email: "jg@bx.com" })]); // dup by email
      return ok([]);
    });
    mockEnrichOrg.mockResolvedValue(ok(null));

    const enriched = await enrichEntities({
      companies: [{ name: "Blackstone", domain: "" }],
      people: [{ name: "Jon Gray", company: "Blackstone" }],
    });

    expect(enriched.people).toHaveLength(1);
    expect(enriched.people[0].email).toBe("jg@bx.com");
  });

  it("drops people with no email and no phone", async () => {
    mockSearchPeople.mockResolvedValue(ok([person({ email: undefined, phone: undefined })]));
    mockEnrichOrg.mockResolvedValue(ok(null));

    const enriched = await enrichEntities({ companies: [], people: [{ name: "Nobody Reachable", company: "" }] });
    expect(enriched.people).toHaveLength(0);
  });
});

describe("extractEntitiesDeterministic", () => {
  it("pulls org-suffix company names out of the text", () => {
    const out = extractEntitiesDeterministic(
      "who should I talk to?",
      "Consider Carlyle Group and Apollo Global Management for this mandate.",
    );
    const names = out.companies.map((c) => c.name);
    expect(names).toContain("Carlyle Group");
    expect(names).toContain("Apollo Global Management");
  });

  it("keeps the longest form and drops nested fragments", () => {
    const out = extractEntitiesDeterministic("", "Apollo Global Management is hiring.");
    const names = out.companies.map((c) => c.name);
    expect(names).toContain("Apollo Global Management");
    expect(names).not.toContain("Global Management");
  });

  it("extracts person names but skips Titlecase non-name phrases", () => {
    const out = extractEntitiesDeterministic(
      "who runs it?",
      "Jonathan Gray leads the Private Equity effort in New York.",
    );
    const people = out.people.map((p) => p.name);
    expect(people).toContain("Jonathan Gray");
    expect(people).not.toContain("Private Equity");
    expect(people).not.toContain("New York");
  });

  it("returns empty arrays for casual text with no entities", () => {
    const out = extractEntitiesDeterministic("hi", "you have three tasks today.");
    expect(out.companies).toHaveLength(0);
    expect(out.people).toHaveLength(0);
  });
});

describe("extractEntities without a model key", () => {
  it("falls back to the deterministic extractor (no ANTHROPIC key)", async () => {
    const out = await extractEntities("", "Reach out to Blackstone Group about the deal.");
    expect(out.companies.map((c) => c.name)).toContain("Blackstone Group");
  });
});

describe("buildContactAppendix", () => {
  it("returns '' without an Apollo key — never fabricates", async () => {
    // ANTHROPIC set but APOLLO absent: still no real source, so nothing.
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const out = await buildContactAppendix("who runs Blackstone?", "Jon Gray runs Blackstone.");
    expect(out).toBe("");
    expect(mockSearchPeople).not.toHaveBeenCalled();
  });

  it("returns '' when the text mentions no entity, without calling the model", async () => {
    process.env.APOLLO_API_KEY = "ak-test";
    process.env.ANTHROPIC_API_KEY = "sk-test";
    const out = await buildContactAppendix("what's on my plate today?", "You have three tasks.");
    expect(out).toBe("");
  });
});
