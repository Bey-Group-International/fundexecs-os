import {
  parseLinkedInCsv,
  parseNetworkCsv,
  toImportFields,
  scoreImportConfidence,
  consentBasisForSource,
  type ParsedContact,
} from "./network-import";

function parsed(overrides: Partial<ParsedContact>): ParsedContact {
  return {
    firstName: "Ada",
    lastName: "Lovelace",
    email: null,
    company: null,
    title: null,
    linkedinUrl: null,
    phone: null,
    city: null,
    state: null,
    country: null,
    connectedOn: null,
    source: "csv_person_list",
    ...overrides,
  };
}

describe("toImportFields", () => {
  it("drops a malformed/placeholder email, phone, and LinkedIn", () => {
    const f = toImportFields(parsed({ email: "email_not_unlocked@domain.com", phone: "call me", linkedinUrl: "https://twitter.com/x" }));
    expect(f.email).toBeNull();
    expect(f.phone).toBeNull();
    expect(f.linkedin_url).toBeNull();
  });

  it("keeps valid fields and stamps a consent basis", () => {
    const f = toImportFields(parsed({ email: "Ada@Analytical.com", phone: "+1 212-555-0100", linkedinUrl: "https://www.linkedin.com/in/ada", source: "linkedin_csv" }));
    expect(f.email).toBe("ada@analytical.com");
    expect(f.phone).toBe("+1 212-555-0100");
    expect(f.linkedin_url).toBe("https://www.linkedin.com/in/ada");
    expect(f.communication_status).toBe("allowed");
    expect(f.consent_basis).toBe("existing_relationship");
    expect(f.consent_source).toBe("linkedin_csv");
  });
});

describe("scoreImportConfidence", () => {
  it("rewards more identifying fields", () => {
    const rich = scoreImportConfidence({ email: "a@b.com", linkedin_url: "x", phone: "y", title: "CIO", company: "Acme" });
    const sparse = scoreImportConfidence({ email: null, linkedin_url: null, phone: null, title: null, company: null });
    expect(rich).toBeGreaterThan(sparse);
    expect(rich).toBeLessThanOrEqual(100);
  });
});

describe("consentBasisForSource", () => {
  it("maps LinkedIn to existing relationship, else user import", () => {
    expect(consentBasisForSource("linkedin_csv")).toBe("existing_relationship");
    expect(consentBasisForSource("csv_firm_list")).toBe("user_import");
  });
});

describe("network import CSV parsing", () => {
  it("parses LinkedIn connection exports", () => {
    const csv = [
      "First Name,Last Name,URL,Email Address,Company,Position,Connected On",
      "Ada,Lovelace,https://linkedin.com/in/ada,ADA@example.com,Analytical Engines,Partner,2026-01-05",
    ].join("\n");

    expect(parseLinkedInCsv(csv)).toEqual([
      expect.objectContaining({
        firstName: "Ada",
        lastName: "Lovelace",
        email: "ada@example.com",
        company: "Analytical Engines",
        title: "Partner",
        linkedinUrl: "https://linkedin.com/in/ada",
        connectedOn: "2026-01-05",
        source: "linkedin_csv",
      }),
    ]);
  });

  it("keeps quoted commas inside generic person-list fields", () => {
    const csv = [
      "First Name,Last Name,Company,Title,Email",
      'Grace,Hopper,"Navy, Ventures","Founder, GP",grace@example.com',
    ].join("\n");

    expect(parseNetworkCsv(csv, "person")).toEqual([
      expect.objectContaining({
        firstName: "Grace",
        lastName: "Hopper",
        company: "Navy, Ventures",
        title: "Founder, GP",
        email: "grace@example.com",
        source: "csv_person_list",
      }),
    ]);
  });

  it("auto-detects firm-list CSV files", () => {
    const csv = [
      "Fund Name,City,State,Website",
      "Seed Fund I,Chicago,IL,https://seed.example",
    ].join("\n");

    expect(parseNetworkCsv(csv)).toEqual([
      expect.objectContaining({
        firstName: "Seed Fund I",
        lastName: "",
        company: "Seed Fund I",
        title: "Fund / Firm",
        city: "Chicago",
        state: "IL",
        country: "United States",
        linkedinUrl: "https://seed.example",
        source: "csv_firm_list",
      }),
    ]);
  });
});
