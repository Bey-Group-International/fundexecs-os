// lib/treasury/linked-accounts.test.ts
// Unit tests for the pure linked-account display helpers. No I/O.
import {
  maskAccount,
  linkedAccountLabel,
  summarizeLinkedAccounts,
  isActive,
} from "@/lib/treasury/linked-accounts";

describe("maskAccount", () => {
  it("masks to the last four digits", () => {
    expect(maskAccount("1234")).toBe("••••1234");
    expect(maskAccount("000111222333")).toBe("••••2333");
  });

  it("handles missing / non-digit input", () => {
    expect(maskAccount(null)).toBe("••••");
    expect(maskAccount("")).toBe("••••");
    expect(maskAccount("ab")).toBe("••••");
  });
});

describe("linkedAccountLabel", () => {
  it("combines institution and masked number", () => {
    expect(linkedAccountLabel({ institution_name: "Chase", display_name: null, last4: "6789" })).toBe(
      "Chase ••••6789",
    );
  });

  it("falls back to display name, then a generic label", () => {
    expect(linkedAccountLabel({ institution_name: null, display_name: "Operating", last4: "1111" })).toBe(
      "Operating ••••1111",
    );
    expect(linkedAccountLabel({ institution_name: null, display_name: null, last4: null })).toBe(
      "Bank account ••••",
    );
  });
});

describe("summarizeLinkedAccounts", () => {
  it("counts accounts and sums only active balances", () => {
    const s = summarizeLinkedAccounts([
      { status: "active", balance_cents: 100_000 },
      { status: "active", balance_cents: 50_000 },
      { status: "disconnected", balance_cents: 999_999 },
      { status: "active", balance_cents: null },
    ]);
    expect(s.count).toBe(4);
    expect(s.active).toBe(3);
    expect(s.totalBalanceCents).toBe(150_000);
  });

  it("is zeroed for an empty list", () => {
    expect(summarizeLinkedAccounts([])).toEqual({ count: 0, active: 0, totalBalanceCents: 0 });
  });
});

describe("isActive", () => {
  it("is true only for active accounts", () => {
    expect(isActive({ status: "active" })).toBe(true);
    expect(isActive({ status: "disconnected" })).toBe(false);
    expect(isActive({ status: "errored" })).toBe(false);
  });
});
