import { parseLinkedInCsv, parseNetworkCsv } from "./network-import";

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
