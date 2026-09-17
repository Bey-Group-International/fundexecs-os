import {
  normalizeEntityName,
  isSameEntity,
  EntityDedupe,
  cleanEmail,
  cleanPhone,
  cleanWebUrl,
  cleanLinkedIn,
  matchCategory,
} from "@/lib/source-identity";

describe("normalizeEntityName", () => {
  it("strips legal form, punctuation, and case", () => {
    expect(normalizeEntityName("Acme Capital, L.P.")).toBe("acme capital");
    expect(normalizeEntityName("ACME CAPITAL LLC")).toBe("acme capital");
    expect(normalizeEntityName("Acme Capital Inc.")).toBe("acme capital");
  });

  it("peels repeated legal suffixes", () => {
    expect(normalizeEntityName("Acme Holdings Ltd Co")).toBe("acme holdings");
  });

  it("drops a leading article and folds ampersands", () => {
    expect(normalizeEntityName("The Smith & Jones Group")).toBe("smith and jones group");
  });

  it("de-accents without splitting apostrophes", () => {
    expect(normalizeEntityName("O'Brien Zürich")).toBe("obrien zurich");
  });

  it("transliterates latin letters NFD leaves whole", () => {
    expect(normalizeEntityName("Ørsted")).toBe("orsted");
    expect(normalizeEntityName("Straße Kapital")).toBe("strasse kapital");
  });

  it("never reduces a name to nothing but its legal form", () => {
    expect(normalizeEntityName("LLC")).toBe("llc");
  });

  it("returns empty for non-strings", () => {
    expect(normalizeEntityName(null)).toBe("");
    expect(normalizeEntityName(42)).toBe("");
  });
});

describe("isSameEntity", () => {
  it("matches across legal form and punctuation", () => {
    expect(isSameEntity("Acme Capital", "Acme Capital LLC")).toBe(true);
    expect(isSameEntity("Acme Capital, L.P.", "acme capital")).toBe(true);
  });

  it("matches when the only extra tokens are generic descriptors", () => {
    expect(isSameEntity("Acme Capital", "Acme Capital Management")).toBe(true);
    expect(isSameEntity("Acme Capital", "Acme Capital Advisors")).toBe(true);
  });

  it("keeps genuinely different firms apart", () => {
    // Both real, unrelated firms — a looser "first token" rule would merge them.
    expect(isSameEntity("Summit Partners", "Summit Capital")).toBe(false);
    expect(isSameEntity("Acme Capital", "Acme Ventures")).toBe(false);
    expect(isSameEntity("Acme Capital", "Beta Capital")).toBe(false);
  });

  it("does not match on a shared suffix", () => {
    expect(isSameEntity("Capital Group", "Acme Capital Group")).toBe(false);
  });

  it("is false when either side is empty", () => {
    expect(isSameEntity("", "Acme")).toBe(false);
    expect(isSameEntity("Acme", null)).toBe(false);
  });
});

describe("EntityDedupe", () => {
  it("rejects a seeded name in any legal form", () => {
    const d = new EntityDedupe(["Acme Capital LLC"]);
    expect(d.add("Acme Capital, L.P.")).toBe(false);
    expect(d.has("acme capital")).toBe(true);
  });

  it("stops a batch repeating itself", () => {
    const d = new EntityDedupe();
    expect(d.add("Acme Capital")).toBe(true);
    expect(d.add("Acme Capital Management")).toBe(false);
    expect(d.add("Beta Partners")).toBe(true);
    expect(d.size).toBe(2);
  });

  it("ignores unusable names", () => {
    const d = new EntityDedupe();
    expect(d.add("")).toBe(false);
    expect(d.add(null)).toBe(false);
  });
});

describe("cleanEmail", () => {
  it("normalizes the domain but preserves the local part's casing", () => {
    // The local part is case-sensitive per RFC 5321. Most providers ignore
    // that, but lowercasing it is still rewriting someone's address.
    expect(cleanEmail("  Mara.Whitfield@AcmeCapital.com ")).toBe("Mara.Whitfield@acmecapital.com");
  });

  it("catches placeholders regardless of casing", () => {
    expect(cleanEmail("Jane.Doe@AcmeCapital.com")).toBeUndefined();
    expect(cleanEmail("info@EXAMPLE.com")).toBeUndefined();
  });

  it("rejects malformed addresses", () => {
    expect(cleanEmail("not-an-email")).toBeUndefined();
    expect(cleanEmail("mara@acme")).toBeUndefined();
    expect(cleanEmail("mara@@acme.com")).toBeUndefined();
    expect(cleanEmail("mara whitfield@acme.com")).toBeUndefined();
  });

  it("rejects documentation placeholders", () => {
    expect(cleanEmail("mara@example.com")).toBeUndefined();
    expect(cleanEmail("firstname.lastname@acmecapital.com")).toBeUndefined();
    expect(cleanEmail("jane.doe@acmecapital.com")).toBeUndefined();
    expect(cleanEmail("email@yourcompany.com")).toBeUndefined();
  });

  it("rejects a numeric TLD", () => {
    expect(cleanEmail("mara@acme.12")).toBeUndefined();
  });
});

describe("cleanPhone", () => {
  it("keeps a real number in its original formatting", () => {
    expect(cleanPhone("+1 (415) 555-2671")).toBe("+1 (415) 555-2671");
    expect(cleanPhone("020 7123 4567")).toBe("020 7123 4567");
  });

  it("rejects filler patterns", () => {
    expect(cleanPhone("555-555-5555")).toBeUndefined();
    expect(cleanPhone("123-456-7890")).toBeUndefined();
    expect(cleanPhone("(415) 555-0142")).toBeUndefined(); // fictional 555-01xx range
  });

  it("rejects wrong-length and non-numeric values", () => {
    expect(cleanPhone("12345")).toBeUndefined();
    expect(cleanPhone("call the main line")).toBeUndefined();
    expect(cleanPhone("1234567890123456789")).toBeUndefined();
  });

  it("allows a trailing extension", () => {
    expect(cleanPhone("+1 415 992 4471 ext 204")).toBe("+1 415 992 4471 ext 204");
    expect(cleanPhone("415 992 4471 x204")).toBe("415 992 4471 x204");
  });

  it("does not count extension digits toward the length", () => {
    // Six real digits plus a one-digit extension is not a seven-digit number.
    expect(cleanPhone("123456 ext 7")).toBeUndefined();
    // A full-length (15-digit) international number with an extension still
    // fits — before the fix, the extension's digits pushed it over the max.
    expect(cleanPhone("+44 20 7946 0958 123 ext 12")).toBe("+44 20 7946 0958 123 ext 12");
  });
});

describe("cleanWebUrl", () => {
  it("accepts http(s) URLs", () => {
    expect(cleanWebUrl("https://acmecapital.com/team")).toBe("https://acmecapital.com/team");
  });

  it("rejects non-URLs and placeholders", () => {
    expect(cleanWebUrl("acmecapital.com")).toBeUndefined();
    expect(cleanWebUrl("ftp://acmecapital.com")).toBeUndefined();
    expect(cleanWebUrl("https://example.com")).toBeUndefined();
    expect(cleanWebUrl("https://www.example.com/firm")).toBeUndefined();
  });
});

describe("cleanLinkedIn", () => {
  it("accepts profile and company URLs", () => {
    expect(cleanLinkedIn("https://www.linkedin.com/in/janedoe")).toBe("https://www.linkedin.com/in/janedoe");
    expect(cleanLinkedIn("https://linkedin.com/company/acme-capital")).toBe("https://linkedin.com/company/acme-capital");
  });

  it("rejects anything that isn't a LinkedIn profile", () => {
    expect(cleanLinkedIn("https://acmecapital.com/in/janedoe")).toBeUndefined();
    expect(cleanLinkedIn("https://linkedin.com/feed")).toBeUndefined();
    expect(cleanLinkedIn("https://not-linkedin.com/in/janedoe")).toBeUndefined();
  });
});

describe("matchCategory", () => {
  const options = ["family_office", "institution", "fund_of_funds", "other"];

  it("matches regardless of separator or case", () => {
    expect(matchCategory("Family Office", options)).toBe("family_office");
    expect(matchCategory("family-office", options)).toBe("family_office");
    expect(matchCategory("FAMILY_OFFICE", options)).toBe("family_office");
  });

  it("tolerates plurals", () => {
    expect(matchCategory("institutions", options)).toBe("institution");
  });

  it("matches on token containment", () => {
    expect(matchCategory("single family office", options)).toBe("family_office");
  });

  it("returns null rather than guessing", () => {
    expect(matchCategory("sovereign wealth fund", options)).toBeNull();
    expect(matchCategory("", options)).toBeNull();
    expect(matchCategory("family_office", [])).toBeNull();
  });
});
