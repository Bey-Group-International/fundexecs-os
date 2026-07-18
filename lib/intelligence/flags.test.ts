// Tests for the feature-flag gating — a capability is live only with the core on.
import { flagEnabled, coreEnabled, capabilityEnabled } from "./flags";

describe("intelligence flags", () => {
  it("reads a flag from an explicit env map", () => {
    expect(flagEnabled("intelligence_core", { INTELLIGENCE_CORE_ENABLED: "true" })).toBe(true);
    expect(flagEnabled("intelligence_core", { INTELLIGENCE_CORE_ENABLED: "1" })).toBe(false);
    expect(flagEnabled("intelligence_core", {})).toBe(false);
  });

  it("coreEnabled reflects the core switch", () => {
    expect(coreEnabled({ INTELLIGENCE_CORE_ENABLED: "true" })).toBe(true);
    expect(coreEnabled({})).toBe(false);
  });

  it("a capability requires BOTH its flag and the core", () => {
    const bureauOnly = { PROVIDER_SIGNAL_BUREAU_ENABLED: "true" };
    expect(capabilityEnabled("provider_signal_bureau", bureauOnly)).toBe(false);

    const both = { INTELLIGENCE_CORE_ENABLED: "true", PROVIDER_SIGNAL_BUREAU_ENABLED: "true" };
    expect(capabilityEnabled("provider_signal_bureau", both)).toBe(true);

    const coreOnly = { INTELLIGENCE_CORE_ENABLED: "true" };
    expect(capabilityEnabled("provider_signal_bureau", coreOnly)).toBe(false);
  });
});
