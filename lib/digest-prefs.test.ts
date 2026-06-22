import {
  isDigestChannel,
  isDigestCadence,
  recipientRequired,
  validateDigestPref,
  DIGEST_CHANNELS,
  DIGEST_CADENCES,
} from "@/lib/digest-prefs";

describe("digest-prefs", () => {
  describe("isDigestChannel", () => {
    it("accepts the three known channels", () => {
      for (const c of DIGEST_CHANNELS) expect(isDigestChannel(c)).toBe(true);
    });
    it("rejects unknown / non-string values", () => {
      expect(isDigestChannel("sms")).toBe(false);
      expect(isDigestChannel("")).toBe(false);
      expect(isDigestChannel(undefined)).toBe(false);
      expect(isDigestChannel(42)).toBe(false);
    });
  });

  describe("isDigestCadence", () => {
    it("accepts daily and weekly", () => {
      for (const c of DIGEST_CADENCES) expect(isDigestCadence(c)).toBe(true);
    });
    it("rejects anything else", () => {
      expect(isDigestCadence("monthly")).toBe(false);
      expect(isDigestCadence(null)).toBe(false);
    });
  });

  describe("recipientRequired", () => {
    it("is true for slack and email, false for in_app", () => {
      expect(recipientRequired("slack")).toBe(true);
      expect(recipientRequired("email")).toBe(true);
      expect(recipientRequired("in_app")).toBe(false);
    });
  });

  describe("validateDigestPref", () => {
    it("rejects an unknown channel", () => {
      const r = validateDigestPref({ channel: "sms" });
      expect(r.ok).toBe(false);
    });

    it("normalizes a valid in_app pref and nulls the recipient", () => {
      const r = validateDigestPref({
        channel: "in_app",
        recipient: "ignored@example.com",
        cadence: "weekly",
        min_score: "75",
        enabled: "true",
      });
      expect(r).toEqual({
        ok: true,
        value: { channel: "in_app", recipient: null, cadence: "weekly", min_score: 75, enabled: true },
      });
    });

    it("requires a recipient for slack", () => {
      const r = validateDigestPref({ channel: "slack", recipient: "   " });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/Slack channel id/);
    });

    it("requires a recipient for email", () => {
      const r = validateDigestPref({ channel: "email", recipient: "" });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toMatch(/email/i);
    });

    it("trims the recipient for slack/email", () => {
      const r = validateDigestPref({ channel: "slack", recipient: "  C123  " });
      expect(r.ok).toBe(true);
      if (r.ok) expect(r.value.recipient).toBe("C123");
    });

    it("rejects an invalid cadence", () => {
      const r = validateDigestPref({ channel: "in_app", cadence: "hourly" });
      expect(r.ok).toBe(false);
    });

    it("clamps min_score below the floor and above the ceiling", () => {
      const low = validateDigestPref({ channel: "in_app", min_score: -10 });
      const high = validateDigestPref({ channel: "in_app", min_score: 250 });
      expect(low.ok && low.value.min_score).toBe(0);
      expect(high.ok && high.value.min_score).toBe(100);
    });

    it("rounds a fractional min_score", () => {
      const r = validateDigestPref({ channel: "in_app", min_score: 60.6 });
      expect(r.ok && r.value.min_score).toBe(61);
    });

    it("rejects a non-numeric min_score", () => {
      const r = validateDigestPref({ channel: "in_app", min_score: "abc" });
      expect(r.ok).toBe(false);
    });

    it("applies table defaults when fields are omitted", () => {
      const r = validateDigestPref({ channel: "in_app" });
      expect(r).toEqual({
        ok: true,
        value: { channel: "in_app", recipient: null, cadence: "daily", min_score: 60, enabled: true },
      });
    });

    it("coerces an enabled=false string toggle", () => {
      const r = validateDigestPref({ channel: "in_app", enabled: "false" });
      expect(r.ok && r.value.enabled).toBe(false);
    });
  });
});
