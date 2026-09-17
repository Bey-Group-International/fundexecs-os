import {
  verifyStructure,
  verifyCandidates,
  reverifyCached,
  rankVerified,
  domainOf,
  domainsAgree,
  scoreConfidence,
  type VerifiedCandidate,
} from "@/lib/source-verification";
import type { SourceCandidate } from "@/lib/source-ai";

function candidate(overrides: Partial<SourceCandidate> = {}): SourceCandidate {
  return {
    name: "Acme Capital",
    category: "family_office",
    fitScore: 72,
    rationale: "Fits the mandate.",
    firstMove: "Research and qualify.",
    ...overrides,
  };
}

const CATEGORIES = ["family_office", "institution", "other"];

describe("domainOf", () => {
  it("reads the host from a URL and the domain from an email", () => {
    expect(domainOf("https://www.acmecapital.com/team")).toBe("acmecapital.com");
    expect(domainOf("mara@acmecapital.com")).toBe("acmecapital.com");
  });

  it("returns undefined for unusable input", () => {
    expect(domainOf(undefined)).toBeUndefined();
    expect(domainOf("not a url")).toBeUndefined();
  });
});

describe("domainsAgree", () => {
  it("treats subdomains as the same organisation", () => {
    expect(domainsAgree("ir.acme.com", "acme.com")).toBe(true);
    expect(domainsAgree("acme.com", "acme.com")).toBe(true);
  });

  it("keeps lookalike domains apart", () => {
    expect(domainsAgree("acme.com", "acmecapital.com")).toBe(false);
    expect(domainsAgree("acme.com", undefined)).toBe(false);
  });
});

describe("verifyStructure", () => {
  it("keeps a well-formed contact and marks a cited candidate corroborated", () => {
    const v = verifyStructure(
      candidate({
        website: "https://acmecapital.com",
        sourceUrl: "https://press.example.org/acme",
        contactName: "Mara Whitfield",
        contactEmail: "mara@acmecapital.com",
        contactPhone: "+1 (415) 992-4471",
      }),
      CATEGORIES,
    );
    expect(v.contactEmail).toBe("mara@acmecapital.com");
    expect(v.contactPhone).toBe("+1 (415) 992-4471");
    expect(v.verification.status).toBe("corroborated");
  });

  it("marks an uncited candidate as an unverified lead", () => {
    const v = verifyStructure(candidate(), CATEGORIES);
    expect(v.verification.status).toBe("unverified");
    expect(v.verification.checks.find((c) => c.id === "citation")?.ok).toBe(false);
  });

  it("drops a placeholder email rather than presenting it", () => {
    const v = verifyStructure(candidate({ contactEmail: "jane@example.com" }), CATEGORIES);
    expect(v.contactEmail).toBeUndefined();
    expect(v.verification.checks.find((c) => c.id === "email_shape")?.ok).toBe(false);
  });

  it("drops a filler phone number", () => {
    const v = verifyStructure(candidate({ contactPhone: "555-555-5555" }), CATEGORIES);
    expect(v.contactPhone).toBeUndefined();
  });

  it("drops a non-LinkedIn profile URL", () => {
    const v = verifyStructure(candidate({ contactLinkedIn: "https://acmecapital.com/team/mara" }), CATEGORIES);
    expect(v.contactLinkedIn).toBeUndefined();
  });

  it("flags and strips a contact whose domain contradicts the website", () => {
    const v = verifyStructure(
      candidate({
        website: "https://acmecapital.com",
        contactEmail: "mara@totally-different.com",
      }),
      CATEGORIES,
    );
    expect(v.verification.status).toBe("flagged");
    expect(v.contactEmail).toBeUndefined();
    expect(v.verification.checks.find((c) => c.id === "domain_match")?.ok).toBe(false);
  });

  it("does not punish a decision maker using a personal mailbox", () => {
    const v = verifyStructure(
      candidate({ website: "https://acmecapital.com", contactEmail: "mara.whitfield@gmail.com" }),
      CATEGORIES,
    );
    expect(v.contactEmail).toBe("mara.whitfield@gmail.com");
    expect(v.verification.checks.find((c) => c.id === "domain_match")).toBeUndefined();
  });

  it("flags a candidate with no usable name", () => {
    const v = verifyStructure(candidate({ name: "  " }), CATEGORIES);
    expect(v.verification.status).toBe("flagged");
  });

  it("notes a category outside the module's enum", () => {
    const v = verifyStructure(candidate({ category: "sovereign_wealth" }), CATEGORIES);
    expect(v.verification.checks.find((c) => c.id === "category")?.ok).toBe(false);
  });
});

describe("scoreConfidence", () => {
  it("ranks a verified, complete record above an unverified sparse one", () => {
    const rich = candidate({
      website: "https://acmecapital.com",
      contactName: "Mara Whitfield",
      contactEmail: "mara@acmecapital.com",
      contactLinkedIn: "https://linkedin.com/in/marawhitfield",
      aumRange: "$500M–$2B",
      geography: "Austin, TX",
    });
    expect(scoreConfidence("verified", rich, [])).toBeGreaterThan(
      scoreConfidence("unverified", candidate(), []),
    );
  });

  it("stays within 0–1", () => {
    expect(scoreConfidence("flagged", candidate(), [
      { id: "a", label: "a", ok: false },
      { id: "b", label: "b", ok: false },
      { id: "c", label: "c", ok: false },
      { id: "d", label: "d", ok: false },
    ])).toBeGreaterThanOrEqual(0);
    expect(scoreConfidence("verified", candidate(), [])).toBeLessThanOrEqual(1);
  });
});

describe("rankVerified", () => {
  it("puts evidence ahead of a higher unsubstantiated fit score", () => {
    const evidenced = verifyStructure(
      candidate({ name: "Evidenced Capital", fitScore: 70, sourceUrl: "https://press.org/a" }),
      CATEGORIES,
    );
    const unevidenced = verifyStructure(candidate({ name: "Loud Capital", fitScore: 95 }), CATEGORIES);
    const ranked = rankVerified([unevidenced, evidenced]);
    expect(ranked[0].name).toBe("Evidenced Capital");
  });

  it("orders the same set the same way whatever order it arrives in", () => {
    // Confidences one bucket apart pairwise but two apart end to end used to
    // make the comparator intransitive, so the result depended on input order.
    const make = (name: string, confidence: number, fitScore: number) => {
      const base = verifyStructure(candidate({ name, fitScore }), CATEGORIES);
      return { ...base, verification: { ...base.verification, confidence } };
    };
    const a = make("A", 0.6, 50);
    const b = make("B", 0.63, 60);
    const c = make("C", 0.67, 70);
    const order = (list: VerifiedCandidate[]) => rankVerified(list).map((x) => x.name).join(",");
    const expected = order([a, b, c]);
    expect(order([c, b, a])).toBe(expected);
    expect(order([b, a, c])).toBe(expected);
    expect(order([b, c, a])).toBe(expected);
    expect(order([a, c, b])).toBe(expected);
    expect(order([c, a, b])).toBe(expected);
  });

  it("falls back to fit score within the same evidence tier", () => {
    const low = verifyStructure(candidate({ name: "Low Capital", fitScore: 40 }), CATEGORIES);
    const high = verifyStructure(candidate({ name: "High Capital", fitScore: 88 }), CATEGORIES);
    expect(rankVerified([low, high])[0].name).toBe("High Capital");
  });
});

describe("verifyCandidates", () => {
  it("verifies every candidate without corroboration when asked", async () => {
    const out = await verifyCandidates(
      [candidate({ name: "Acme Capital" }), candidate({ name: "Beta Partners" })],
      CATEGORIES,
      { corroborate: false },
    );
    expect(out).toHaveLength(2);
    out.forEach((c: VerifiedCandidate) => expect(c.verification.verifiedAt).toBeTruthy());
  });

  it("returns an empty list unchanged", async () => {
    expect(await verifyCandidates([], CATEGORIES)).toEqual([]);
  });

  it("does not reach for a provider when none is configured", async () => {
    const previous = process.env.APOLLO_API_KEY;
    delete process.env.APOLLO_API_KEY;
    try {
      const out = await verifyCandidates([candidate()], CATEGORIES);
      expect(out[0].verification.status).toBe("unverified");
    } finally {
      if (previous !== undefined) process.env.APOLLO_API_KEY = previous;
    }
  });
});

describe("reverifyCached", () => {
  // A cached entry as it would have been stored after provider corroboration.
  function cachedVerified(overrides: Partial<SourceCandidate> = {}): VerifiedCandidate {
    const base = verifyStructure(
      candidate({
        website: "https://acmecapital.com",
        contactName: "Mara Whitfield",
        contactEmail: "mara@acmecapital.com",
        ...overrides,
      }),
      CATEGORIES,
    );
    return {
      ...base,
      verification: {
        ...base.verification,
        status: "verified",
        provenance: { ...base.verification.provenance, contactEmail: "apollo", website: "apollo" },
      },
    };
  }

  it("keeps provider-backed standing instead of demoting it on a cache hit", async () => {
    const out = await reverifyCached([cachedVerified()], CATEGORIES);
    expect(out[0].verification.status).toBe("verified");
    expect(out[0].verification.provenance.contactEmail).toBe("apollo");
  });

  it("re-runs the structural checks, so a rule change still bites", async () => {
    // Stored before the placeholder rule existed — the fresh pass must drop it.
    const stale = cachedVerified({ contactEmail: "jane@example.com" });
    const out = await reverifyCached([stale], CATEGORIES);
    expect(out[0].contactEmail).toBeUndefined();
    expect(out[0].verification.provenance.contactEmail).toBeUndefined();
  });

  it("demotes a cached entry the fresh checks flag", async () => {
    // Built without going through verifyStructure, so the contradiction is
    // still present — this is what a pre-rule cache entry would look like.
    const clean = cachedVerified();
    const contradictory: VerifiedCandidate = {
      ...clean,
      website: "https://acmecapital.com",
      contactEmail: "mara@totally-different.com",
    };
    const out = await reverifyCached([contradictory], CATEGORIES);
    expect(out[0].verification.status).toBe("flagged");
    expect(out[0].contactEmail).toBeUndefined();
  });

  it("does not promote an entry that was never provider-backed", async () => {
    const lead = verifyStructure(candidate(), CATEGORIES);
    const out = await reverifyCached([lead], CATEGORIES);
    expect(out[0].verification.status).toBe("unverified");
  });
});
