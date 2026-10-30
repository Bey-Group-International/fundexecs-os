import { isOnboardingStale, ONBOARDING_MAX_AGE_MS } from "./onboarding-session";

describe("isOnboardingStale", () => {
  const now = Date.parse("2026-10-30T12:00:00Z");

  it("is fresh inside the window", () => {
    expect(isOnboardingStale(new Date(now - 60_000).toISOString(), now)).toBe(false);
  });

  it("is stale past the window", () => {
    expect(
      isOnboardingStale(new Date(now - ONBOARDING_MAX_AGE_MS - 1).toISOString(), now),
    ).toBe(true);
  });

  it("never evicts on missing or unparseable data", () => {
    expect(isOnboardingStale(null, now)).toBe(false);
    expect(isOnboardingStale(undefined, now)).toBe(false);
    expect(isOnboardingStale("not-a-date", now)).toBe(false);
  });
});
