import { describeDomains, emailDomainAllowed, parseDomains } from "./data-room-link-rules";

describe("parseDomains", () => {
  it("cleans what an operator types and reports what isn't a domain", () => {
    expect(parseDomains(" @CalPERS.ca.gov, ilpa.org; ilpa.org  not a domain  x ")).toEqual({
      domains: ["calpers.ca.gov", "ilpa.org"],
      invalid: ["not", "a", "domain", "x"],
    });
  });
  it("treats blank as no limit", () => {
    expect(parseDomains("  ")).toEqual({ domains: [], invalid: [] });
  });
});

describe("emailDomainAllowed", () => {
  const list = ["calpers.ca.gov"];
  it("admits the domain and its subdomains, case-insensitively", () => {
    expect(emailDomainAllowed("a@CalPERS.ca.gov", list)).toBe(true);
    expect(emailDomainAllowed("a@mail.calpers.ca.gov", list)).toBe(true);
  });
  it("refuses look-alikes", () => {
    expect(emailDomainAllowed("a@evilcalpers.ca.gov", list)).toBe(false);
    expect(emailDomainAllowed("a@calpers.ca.gov.evil.com", list)).toBe(false);
    expect(emailDomainAllowed("calpers.ca.gov", list)).toBe(false);
  });
  it("admits anyone when there is no list", () => {
    expect(emailDomainAllowed("a@x.com", null)).toBe(true);
    expect(emailDomainAllowed("a@x.com", [])).toBe(true);
  });
});

it("describes a list briefly", () => {
  expect(describeDomains(["a.com", "b.com"])).toBe("@a.com, @b.com");
  expect(describeDomains(["a.com", "b.com", "c.com", "d.com"])).toBe("@a.com, @b.com, @c.com +1");
});
