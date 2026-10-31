import {
  CODE_MAX_PER_HOUR,
  CONSENT_SCOPES,
  CONSENT_TEXT_VERSION,
  canIssueCode,
  generateCode,
  incompleteSteps,
  maskEmail,
  normalizeCode,
  readyToSubmit,
  stepsFor,
  validateAccreditation,
  validateConsent,
  validateDetails,
  validateLinkInput,
  validateOwners,
  wizardEditable,
  type WizardData,
} from "./lp-wizard";

describe("stepsFor", () => {
  it("gives only entities an owners step", () => {
    expect(stepsFor("entity")).toContain("owners");
    expect(stepsFor("individual")).not.toContain("owners");
    expect(stepsFor("institutional")).not.toContain("owners");
  });
  it("always ends in review, with consent before accreditation", () => {
    for (const t of ["individual", "entity", "institutional"] as const) {
      const s = stepsFor(t);
      expect(s[s.length - 1]).toBe("review");
      expect(s.indexOf("consent")).toBeLessThan(s.indexOf("accreditation"));
    }
  });
});

describe("the ID verification step", () => {
  it("appears after consent and before accreditation, only where online verification is set up", () => {
    for (const t of ["individual", "entity", "institutional"] as const) {
      expect(stepsFor(t)).not.toContain("identity");
      const s = stepsFor(t, true);
      expect(s.indexOf("consent")).toBeLessThan(s.indexOf("identity"));
      expect(s.indexOf("identity")).toBeLessThan(s.indexOf("accreditation"));
    }
  });
});

describe("wizardEditable", () => {
  it.each([
    ["not_started", true],
    ["in_progress", true],
    ["changes_requested", true],
    ["submitted", false],
    ["approved", false],
    ["rejected", false],
  ] as const)("%s → %s", (state, expected) => expect(wizardEditable(state)).toBe(expected));
});

describe("validateDetails", () => {
  const base = { legalName: " Jo Park ", entityType: "individual", country: "US", contactPhone: "", signatoryName: "x", signatoryTitle: "y" };
  it("trims, and drops signatory fields for an individual", () => {
    expect(validateDetails("individual", base)).toEqual({
      ok: true,
      value: { legalName: "Jo Park", entityType: "individual", country: "US", contactPhone: null, signatoryName: null, signatoryTitle: null },
    });
  });
  it("requires a name and country", () => {
    expect(validateDetails("individual", { ...base, legalName: "  " }).ok).toBe(false);
    expect(validateDetails("individual", { ...base, country: "U" }).ok).toBe(false);
  });
  it("rejects an investor type that does not fit the kind of LP", () => {
    expect(validateDetails("individual", { ...base, entityType: "trust" }).ok).toBe(false);
    expect(validateDetails("entity", { ...base, entityType: "pension" }).ok).toBe(false);
    expect(validateDetails("institutional", { ...base, entityType: "individual" }).ok).toBe(false);
  });
  it("requires a signatory for entities and institutions", () => {
    const e = { ...base, entityType: "trust", signatoryName: "", signatoryTitle: "" };
    expect(validateDetails("entity", e).ok).toBe(false);
    expect(validateDetails("entity", { ...e, signatoryName: "Jo" }).ok).toBe(false);
    expect(validateDetails("entity", { ...e, signatoryName: "Jo", signatoryTitle: "Trustee" }).ok).toBe(true);
    expect(validateDetails("institutional", { ...e, entityType: "pension" }).ok).toBe(false);
  });
  it("copes with nonsense input", () => {
    expect(validateDetails("individual", null).ok).toBe(false);
    expect(validateDetails("individual", { legalName: 5 }).ok).toBe(false);
  });
});

describe("validateOwners", () => {
  const controller = { fullName: "Jo Park", role: "controller", ownershipPct: "", country: "US" };
  it("needs at least one controller", () => {
    expect(validateOwners([{ fullName: "A", role: "owner", ownershipPct: 50 }]).ok).toBe(false);
    expect(validateOwners([]).ok).toBe(false);
    expect(validateOwners([controller]).ok).toBe(true);
  });
  it("needs a share for an owner but not for a controller", () => {
    expect(validateOwners([controller, { fullName: "A", role: "owner", ownershipPct: null }]).ok).toBe(false);
    expect(validateOwners([controller, { fullName: "A", role: "owner", ownershipPct: 0 }]).ok).toBe(true);
  });
  it.each([-1, 101, "abc", NaN])("rejects a share of %p", (pct) => {
    expect(validateOwners([controller, { fullName: "A", role: "owner", ownershipPct: pct }]).ok).toBe(false);
  });
  it("rounds a share to two places and trims names", () => {
    const res = validateOwners([controller, { fullName: " A ", role: "owner", ownershipPct: "33.333", country: " " }]);
    expect(res).toEqual({
      ok: true,
      value: [
        { fullName: "Jo Park", role: "controller", ownershipPct: null, country: "US" },
        { fullName: "A", role: "owner", ownershipPct: 33.33, country: null },
      ],
    });
  });
  it("rejects a nameless person, a bad role, and a list that is too long or not a list", () => {
    expect(validateOwners([controller, { fullName: " ", role: "owner", ownershipPct: 5 }]).ok).toBe(false);
    expect(validateOwners([{ fullName: "A", role: "boss" }]).ok).toBe(false);
    expect(validateOwners(Array.from({ length: 26 }, () => controller)).ok).toBe(false);
    expect(validateOwners(Array.from({ length: 25 }, () => controller)).ok).toBe(true);
    expect(validateOwners("nope").ok).toBe(false);
  });
});

describe("validateConsent", () => {
  it("needs a known scope and a typed name", () => {
    expect(validateConsent({ scope: "identity_verification", typedName: " Jo Park " })).toEqual({
      ok: true,
      value: { scope: "identity_verification", typedName: "Jo Park" },
    });
    expect(validateConsent({ scope: "everything", typedName: "Jo" }).ok).toBe(false);
    expect(validateConsent({ scope: "background_screening", typedName: " " }).ok).toBe(false);
  });
});

describe("validateAccreditation", () => {
  const ok = { basis: "accredited_investor", statement: true, sourceOfFunds: "Sale of my company in 2022" };
  it("accepts a complete statement", () => {
    expect(validateAccreditation(ok)).toEqual({ ok: true, value: { basis: "accredited_investor", sourceOfFunds: "Sale of my company in 2022" } });
  });
  it("needs the basis, the confirmed statement, and a real source of funds", () => {
    expect(validateAccreditation({ ...ok, basis: "rich" }).ok).toBe(false);
    expect(validateAccreditation({ ...ok, statement: false }).ok).toBe(false);
    expect(validateAccreditation({ ...ok, statement: "true" }).ok).toBe(false);
    expect(validateAccreditation({ ...ok, sourceOfFunds: "savings" }).ok).toBe(false);
    expect(validateAccreditation({ ...ok, sourceOfFunds: "x".repeat(1001) }).ok).toBe(false);
  });
});

describe("incompleteSteps", () => {
  const profile = {
    legal_name: "Jo Park",
    entity_type: "individual" as const,
    country: "US",
    signatory_name: null,
    signatory_title: null,
    source_of_funds: "Sale of my company in 2022",
    accreditation_basis: "accredited_investor" as const,
    accreditation_statement_at: "2026-10-31T00:00:00Z",
  };
  const consents = CONSENT_SCOPES.map((scope) => ({ scope, text_version: CONSENT_TEXT_VERSION }));
  const full = (over: Partial<WizardData> = {}): WizardData => ({ lpType: "individual", profile, owners: [], consents, ...over });

  it("is empty for a finished individual", () => {
    expect(incompleteSteps(full())).toEqual([]);
    expect(readyToSubmit(full())).toBe(true);
  });
  it("lists everything for a blank wizard", () => {
    expect(incompleteSteps(full({ lpType: "entity", profile: null, consents: [] }))).toEqual(["details", "owners", "consent", "accreditation"]);
  });
  it("needs a signatory for an entity, and a controller among its owners", () => {
    expect(incompleteSteps(full({ lpType: "entity", owners: [{ role: "controller" }] }))).toEqual(["details"]);
    expect(incompleteSteps(full({ lpType: "entity", profile: { ...profile, signatory_name: "A", signatory_title: "B" }, owners: [{ role: "owner" }] }))).toEqual(["owners"]);
  });
  it("needs every consent, at the current wording", () => {
    expect(incompleteSteps(full({ consents: consents.slice(0, 1) }))).toEqual(["consent"]);
    expect(incompleteSteps(full({ consents: consents.map((c) => ({ ...c, text_version: "2020-01-01" })) }))).toEqual(["consent"]);
  });
  it("needs the accreditation statement and a source of funds", () => {
    expect(incompleteSteps(full({ profile: { ...profile, accreditation_statement_at: null } }))).toEqual(["accreditation"]);
    expect(incompleteSteps(full({ profile: { ...profile, source_of_funds: "short" } }))).toEqual(["accreditation"]);
  });
});

describe("incompleteSteps with ID verification", () => {
  const profile = {
    legal_name: "Jo Park",
    entity_type: "individual" as const,
    country: "US",
    signatory_name: null,
    signatory_title: null,
    source_of_funds: "Sale of my company in 2022",
    accreditation_basis: "accredited_investor" as const,
    accreditation_statement_at: "2026-10-31T00:00:00Z",
  };
  const consents = CONSENT_SCOPES.map((scope) => ({ scope, text_version: CONSENT_TEXT_VERSION }));
  const base = { lpType: "individual" as const, profile, owners: [], consents };

  it("needs a verified ID when it is set up", () => {
    expect(incompleteSteps({ ...base, identity: { enabled: true, verified: false } })).toEqual(["identity"]);
    expect(incompleteSteps({ ...base, identity: { enabled: true, verified: true } })).toEqual([]);
  });
  it("ignores it when it is not set up, or not mentioned", () => {
    expect(incompleteSteps({ ...base, identity: { enabled: false, verified: false } })).toEqual([]);
    expect(incompleteSteps(base)).toEqual([]);
  });
});

describe("codes", () => {
  it("pads to six digits", () => {
    expect(generateCode(() => 42)).toBe("000042");
    expect(generateCode(() => 999999)).toBe("999999");
  });
  it("normalizes what people type", () => {
    expect(normalizeCode("123 456")).toBe("123456");
    expect(normalizeCode("123-456")).toBe("123456");
    expect(normalizeCode("12345")).toBeNull();
    expect(normalizeCode("1234567")).toBeNull();
    expect(normalizeCode("12345a")).toBeNull();
    expect(normalizeCode(123456)).toBeNull();
  });
  it("allows one code a minute and a handful an hour", () => {
    const now = Date.parse("2026-10-31T12:00:00Z");
    const ago = (s: number) => new Date(now - s * 1000).toISOString();
    expect(canIssueCode([], now).ok).toBe(true);
    expect(canIssueCode([ago(30)], now).ok).toBe(false);
    expect(canIssueCode([ago(61)], now).ok).toBe(true);
    const many = Array.from({ length: CODE_MAX_PER_HOUR }, (_, i) => ago(120 + i * 300));
    expect(canIssueCode(many, now).ok).toBe(false);
    expect(canIssueCode(many.map((_, i) => ago(3700 + i)), now).ok).toBe(true);
  });
  it("masks an email", () => {
    expect(maskEmail("jane.doe@example.com")).toBe("j•••@example.com");
    expect(maskEmail("nonsense")).toBe("your email");
  });
});

describe("validateLinkInput", () => {
  const ok = { lpName: " Calpers ", lpEmail: " Ops@Calpers.CA.gov ", lpType: "institutional" };
  it("normalizes, with a 25% default threshold", () => {
    expect(validateLinkInput(ok)).toEqual({
      ok: true,
      value: { lpName: "Calpers", lpEmail: "ops@calpers.ca.gov", lpType: "institutional", ownerThresholdPct: 25, fundId: null, commitmentAmount: null },
    });
  });
  it("takes a per-link threshold, fund and commitment", () => {
    const res = validateLinkInput({ ...ok, ownerThresholdPct: "10", fundId: "f1", commitmentAmount: "250000" });
    expect(res).toMatchObject({ ok: true, value: { ownerThresholdPct: 10, fundId: "f1", commitmentAmount: 250000 } });
  });
  it.each([0, 101, 2.5, "x"])("rejects a threshold of %p", (n) => expect(validateLinkInput({ ...ok, ownerThresholdPct: n }).ok).toBe(false));
  it("rejects a bad name, email, type or commitment", () => {
    expect(validateLinkInput({ ...ok, lpName: " " }).ok).toBe(false);
    expect(validateLinkInput({ ...ok, lpEmail: "nope" }).ok).toBe(false);
    expect(validateLinkInput({ ...ok, lpType: "alien" }).ok).toBe(false);
    expect(validateLinkInput({ ...ok, commitmentAmount: -5 }).ok).toBe(false);
    expect(validateLinkInput(null).ok).toBe(false);
  });
});
