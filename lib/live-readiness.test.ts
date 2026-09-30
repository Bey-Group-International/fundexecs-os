/**
 * The inspection exists because "is this live?" was unanswerable. Every gate in
 * the codebase asked "is the key non-empty", so a Stripe test key read as fully
 * configured while no money moved — which is exactly what happened in
 * production, and nobody was told.
 */
import {
  inspectCollection,
  inspectLiveness,
  inspectMetering,
  livenessSummary,
  stripeKeyMode,
  stripePublishableMode,
} from "./live-readiness";

const LIVE = {
  STRIPE_SECRET_KEY: "sk_live_abc",
  STRIPE_PUBLISHABLE_KEY: "pk_live_abc",
  FUNDEXECS_REMITTANCE_BANK_NAME: "First Bank",
  FUNDEXECS_REMITTANCE_ACCOUNT_NAME: "FundExecs LLC",
  FUNDEXECS_REMITTANCE_ACCOUNT_NUMBER: "123456789",
  CREDITS_SPEND_ENABLED: "true",
  CRON_SECRET: "s3cret",
  ANTHROPIC_API_KEY: "sk-ant-x",
};

describe("key mode", () => {
  it("tells a live key from a test key", () => {
    expect(stripeKeyMode("sk_live_abc")).toBe("live");
    expect(stripeKeyMode("sk_test_abc")).toBe("test");
  });

  it("handles restricted keys, which carry the mode in the second segment", () => {
    expect(stripeKeyMode("rk_live_abc")).toBe("live");
    expect(stripeKeyMode("rk_test_abc")).toBe("test");
  });

  it("is untroubled by the whitespace env UIs add", () => {
    expect(stripeKeyMode("  sk_live_abc\n")).toBe("live");
  });

  it("calls a publishable key in the secret slot malformed, not live", () => {
    // The most common paste error. Reading "pk_live_…" as live would report a
    // deployment healthy that cannot charge anything.
    expect(stripeKeyMode("pk_live_abc")).toBe("malformed");
  });

  it("distinguishes absent from malformed", () => {
    expect(stripeKeyMode("")).toBe("absent");
    expect(stripeKeyMode(undefined)).toBe("absent");
    expect(stripeKeyMode("hunter2")).toBe("malformed");
  });

  it("classifies publishable keys, rejecting a secret in that slot", () => {
    expect(stripePublishableMode("pk_test_abc")).toBe("test");
    expect(stripePublishableMode("sk_live_abc")).toBe("malformed");
  });
});

describe("collection", () => {
  it("reports a fully live deployment as ok", () => {
    const findings = inspectCollection(LIVE);
    expect(findings.every((f) => f.severity === "ok")).toBe(true);
  });

  it("calls a test key critical and says why it matters later", () => {
    const findings = inspectCollection({ ...LIVE, STRIPE_SECRET_KEY: "sk_test_abc" });
    const card = findings.find((f) => f.subject === "Card rail");
    expect(card?.severity).toBe("critical");
    // The durable damage is not the missing charge, it is the ids written now.
    expect(card?.detail).toContain("meaningless under a live key");
  });

  it("catches a mixed key pair, which Stripe only rejects at payment time", () => {
    const findings = inspectCollection({ ...LIVE, STRIPE_PUBLISHABLE_KEY: "pk_test_abc" });
    expect(findings.some((f) => f.subject === "Stripe key pair" && f.severity === "critical")).toBe(
      true,
    );
  });

  it("is critical when nothing at all can collect", () => {
    const findings = inspectCollection({ CREDITS_SPEND_ENABLED: "true" });
    const card = findings.find((f) => f.subject === "Card rail");
    expect(card?.severity).toBe("critical");
    expect(card?.detail).toContain("nothing can collect");
  });

  it("is only a warning with no card rail but a working transfer rail", () => {
    const { STRIPE_SECRET_KEY: _s, STRIPE_PUBLISHABLE_KEY: _p, ...noStripe } = LIVE;
    const card = inspectCollection(noStripe).find((f) => f.subject === "Card rail");
    expect(card?.severity).toBe("warn");
  });

  it("treats half-set remittance details as worse than none", () => {
    // The code requires all three; two is a configuration someone believes is
    // done, which is more dangerous than an obviously empty one.
    const partial = inspectCollection({
      ...LIVE,
      FUNDEXECS_REMITTANCE_ACCOUNT_NUMBER: "",
    }).find((f) => f.subject === "Bank transfer rail");
    expect(partial?.severity).toBe("critical");

    const none = inspectCollection({
      ...LIVE,
      FUNDEXECS_REMITTANCE_BANK_NAME: "",
      FUNDEXECS_REMITTANCE_ACCOUNT_NAME: "",
      FUNDEXECS_REMITTANCE_ACCOUNT_NUMBER: "",
    }).find((f) => f.subject === "Bank transfer rail");
    expect(none?.severity).toBe("warn");
  });

  it("never echoes a secret back", () => {
    const serialized = JSON.stringify(inspectCollection(LIVE));
    expect(serialized).not.toContain("sk_live_abc");
    expect(serialized).not.toContain("123456789");
  });
});

describe("metering", () => {
  it("is critical when metering is off, because the paywall cannot fire", () => {
    const f = inspectMetering({ ...LIVE, CREDITS_SPEND_ENABLED: "false" }).find(
      (x) => x.subject === "Credit metering",
    );
    expect(f?.severity).toBe("critical");
  });

  it("only accepts the exact string the code checks for", () => {
    // spendCredits compares against "true"; anything else is a no-op, so "1"
    // and "TRUE" must not report as enabled.
    for (const v of ["1", "TRUE", "yes", ""]) {
      const f = inspectMetering({ ...LIVE, CREDITS_SPEND_ENABLED: v }).find(
        (x) => x.subject === "Credit metering",
      );
      expect(f?.severity).toBe("critical");
    }
  });

  it("is critical with no CRON_SECRET, since the whole sweep stops", () => {
    const { CRON_SECRET: _c, ...noCron } = LIVE;
    const f = inspectMetering(noCron).find((x) => x.subject === "Scheduled sweep");
    expect(f?.severity).toBe("critical");
  });
});

describe("summary", () => {
  it("leads with the blocking count when anything blocks", () => {
    const s = livenessSummary(inspectLiveness({ STRIPE_SECRET_KEY: "sk_test_x" }));
    expect(s.severity).toBe("critical");
    expect(s.headline).toContain("Not live");
  });

  it("says live when everything is", () => {
    expect(livenessSummary(inspectLiveness(LIVE)).severity).toBe("ok");
  });

  it("sorts the worst finding first", () => {
    const findings = inspectLiveness({ ...LIVE, STRIPE_SECRET_KEY: "sk_test_x" });
    expect(findings[0]?.severity).toBe("critical");
  });
});
