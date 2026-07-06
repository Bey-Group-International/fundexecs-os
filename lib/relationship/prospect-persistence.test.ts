// Coverage for the pure CRM-persistence helpers. Contracts:
//   - splitName handles mononyms and multi-part names
//   - normalizeForCrm lowercases email, stamps a lawful consent basis, and
//     clamps confidence; verified iff an email is present

import { splitName, normalizeForCrm } from "./prospect-persistence";

describe("splitName", () => {
  it("splits first + last", () => {
    expect(splitName("Jonathan Gray")).toEqual({ first: "Jonathan", last: "Gray" });
  });
  it("keeps multi-part last names", () => {
    expect(splitName("Maria de la Cruz")).toEqual({ first: "Maria", last: "de la Cruz" });
  });
  it("allows a mononym with empty last name", () => {
    expect(splitName("Cher")).toEqual({ first: "Cher", last: "" });
  });
});

describe("normalizeForCrm", () => {
  it("stamps a lawful consent basis and lowercases the email", () => {
    const row = normalizeForCrm({
      candidate: { name: "Mia Reyes", title: "CIO", company: "Cascade FO", location: "Austin", email: "Mia@Cascade.com", confidence: 88 },
    });
    expect(row.first_name).toBe("Mia");
    expect(row.email).toBe("mia@cascade.com");
    expect(row.communication_status).toBe("allowed");
    expect(row.consent_basis).toBe("public_professional");
    expect(row.verified).toBe(true);
    expect(row.confidence).toBe(88);
    expect(row.source).toBe("prospecting");
  });

  it("marks a contact with no email unverified and null", () => {
    const row = normalizeForCrm({ candidate: { name: "No Email", confidence: 200 } });
    expect(row.email).toBeNull();
    expect(row.verified).toBe(false);
    expect(row.confidence).toBe(100); // clamped
  });
});
