// lib/live-readiness.ts
// Is this deployment actually live?
//
// The question sounds like it should be easy to answer and was not answerable
// at all. Every integration gated itself on "is the key non-empty" — so a
// Stripe TEST key read as fully configured, the paywall offered "Card —
// charged immediately", and no money moved. Nobody was told, because nothing
// in the codebase knew the difference between a test key and a live one.
//
// Worse, absence of a processor is itself a silent success: chargeSubscription
// returns `ok` with a `native_…` reference when Stripe is unset, on the theory
// that a native deployment settles in-app. That is true only when the native
// rail can actually collect — and with remittance details also unset there is
// no rail at all, so the product is free and reports itself healthy.
//
// This module is the missing answer. It is pure: it takes an environment and
// returns verdicts, so it is testable, and it runs inside production where the
// environment actually exists (nothing outside the deployment can read it).
// It never returns a secret — only what mode a secret is in.

/** What mode a credential is in, without ever revealing it. */
export type KeyMode = "live" | "test" | "absent" | "malformed";

export type Severity = "ok" | "warn" | "critical";

export interface Finding {
  /** What was inspected, in the operator's language. */
  subject: string;
  severity: Severity;
  /** What is true right now. */
  detail: string;
  /** What to do about it, when there is something to do. */
  action?: string;
}

/**
 * Classify a Stripe-style key by its documented prefix.
 *
 * Deliberately prefix-based and offline: asking Stripe which mode a key is in
 * requires using the key, and a readiness check that needs the network cannot
 * report on a key that is missing. `rk_` is a restricted key, which carries the
 * mode in its second segment.
 */
export function stripeKeyMode(raw: string | undefined | null): KeyMode {
  const key = raw?.trim() ?? "";
  if (!key) return "absent";
  // A publishable key in the secret slot is the single most common paste error.
  if (key.startsWith("pk_")) return "malformed";
  if (key.startsWith("sk_live_") || key.startsWith("rk_live_")) return "live";
  if (key.startsWith("sk_test_") || key.startsWith("rk_test_")) return "test";
  if (key.startsWith("sk_") || key.startsWith("rk_")) return "malformed";
  return "malformed";
}

/** Classify a publishable key the same way. */
export function stripePublishableMode(raw: string | undefined | null): KeyMode {
  const key = raw?.trim() ?? "";
  if (!key) return "absent";
  if (key.startsWith("sk_") || key.startsWith("rk_")) return "malformed";
  if (key.startsWith("pk_live_")) return "live";
  if (key.startsWith("pk_test_")) return "test";
  return "malformed";
}

export interface EnvView {
  [key: string]: string | undefined;
}

function present(env: EnvView, name: string): boolean {
  return (env[name]?.trim() ?? "").length > 0;
}

/**
 * Whether money can actually be collected, and by what.
 *
 * This is the finding that matters most and the one nothing reported: a
 * deployment with no card rail AND no remittance details cannot collect a
 * subscription at all, yet grants the period's credits and records the charge
 * as settled.
 */
export function inspectCollection(env: EnvView): Finding[] {
  const findings: Finding[] = [];
  const secret = stripeKeyMode(env.STRIPE_SECRET_KEY);
  const publishable = stripePublishableMode(env.STRIPE_PUBLISHABLE_KEY);
  const remittance =
    present(env, "FUNDEXECS_REMITTANCE_BANK_NAME") &&
    present(env, "FUNDEXECS_REMITTANCE_ACCOUNT_NAME") &&
    present(env, "FUNDEXECS_REMITTANCE_ACCOUNT_NUMBER");

  if (secret === "test") {
    findings.push({
      subject: "Card rail",
      severity: "critical",
      detail:
        "STRIPE_SECRET_KEY is a TEST key. Checkout completes and no money moves. " +
        "Customer and payment-method ids created now are meaningless under a live key.",
      action: "Replace with the sk_live_… key, or stop presenting the card rail.",
    });
  } else if (secret === "malformed") {
    findings.push({
      subject: "Card rail",
      severity: "critical",
      detail: "STRIPE_SECRET_KEY is set but is not a recognisable secret key.",
      action: "Use the secret key (sk_live_…), not the publishable key.",
    });
  } else if (secret === "absent") {
    findings.push({
      subject: "Card rail",
      severity: remittance ? "warn" : "critical",
      detail: remittance
        ? "No card rail. Collection depends entirely on bank transfer."
        : "No card rail AND no remittance details: nothing can collect a subscription.",
      action: remittance ? undefined : "Set a live Stripe key or the remittance details.",
    });
  }

  // A live secret with a test publishable key (or the reverse) is a mismatch
  // Stripe rejects at the point of payment, which is the worst place to find it.
  if (secret !== "absent" && publishable !== "absent" && secret !== publishable) {
    findings.push({
      subject: "Stripe key pair",
      severity: "critical",
      detail: `Secret key is ${secret} but publishable key is ${publishable}. Stripe rejects a mixed pair.`,
      action: "Use both keys from the same mode.",
    });
  }

  if (!remittance) {
    const partial =
      present(env, "FUNDEXECS_REMITTANCE_BANK_NAME") ||
      present(env, "FUNDEXECS_REMITTANCE_ACCOUNT_NAME") ||
      present(env, "FUNDEXECS_REMITTANCE_ACCOUNT_NUMBER");
    findings.push({
      subject: "Bank transfer rail",
      severity: partial ? "critical" : "warn",
      detail: partial
        ? "Remittance details are partially set, which the code treats as unconfigured."
        : "Remittance details are unset, so the bank-transfer option never appears.",
      action:
        "Set FUNDEXECS_REMITTANCE_BANK_NAME, _ACCOUNT_NAME and _ACCOUNT_NUMBER together — all three or none.",
    });
  }

  if (secret === "live" && findings.length === 0) {
    findings.push({
      subject: "Card rail",
      severity: "ok",
      detail: "Live Stripe key. Card charges are real.",
    });
  }
  return findings;
}

/** Whether metering, the sweep and AI spend are actually switched on. */
export function inspectMetering(env: EnvView): Finding[] {
  const findings: Finding[] = [];

  findings.push(
    env.CREDITS_SPEND_ENABLED?.trim() === "true"
      ? { subject: "Credit metering", severity: "ok", detail: "Enabled. AI actions debit credits." }
      : {
          subject: "Credit metering",
          severity: "critical",
          detail:
            "CREDITS_SPEND_ENABLED is not \"true\", so spendCredits is a no-op: every AI action is free and the paywall can never fire.",
          action: 'Set CREDITS_SPEND_ENABLED="true".',
        },
  );

  findings.push(
    present(env, "CRON_SECRET")
      ? { subject: "Scheduled sweep", severity: "ok", detail: "CRON_SECRET set; the hourly sweep can run." }
      : {
          subject: "Scheduled sweep",
          severity: "critical",
          detail:
            "CRON_SECRET is unset, so /api/cron refuses every request: no renewals, no dunning, no settlement polling.",
          action: "Set CRON_SECRET and confirm the Vercel cron is firing.",
        },
  );

  findings.push(
    present(env, "ANTHROPIC_API_KEY")
      ? { subject: "AI", severity: "ok", detail: "Claude configured." }
      : {
          subject: "AI",
          severity: "warn",
          detail:
            "ANTHROPIC_API_KEY unset. Conversational routes fall back to deterministic stubs and the credit gate is skipped entirely.",
        },
  );

  return findings;
}

/** Everything, worst first, so the top of the list is the thing to fix. */
export function inspectLiveness(env: EnvView): Finding[] {
  const order: Record<Severity, number> = { critical: 0, warn: 1, ok: 2 };
  return [...inspectCollection(env), ...inspectMetering(env)].sort(
    (a, b) => order[a.severity] - order[b.severity],
  );
}

/** One line for the top of the page. */
export function livenessSummary(findings: Finding[]): {
  severity: Severity;
  headline: string;
} {
  const critical = findings.filter((f) => f.severity === "critical").length;
  const warn = findings.filter((f) => f.severity === "warn").length;
  if (critical > 0) {
    return {
      severity: "critical",
      headline: `Not live: ${critical} blocking ${critical === 1 ? "problem" : "problems"}${
        warn ? `, ${warn} to review` : ""
      }.`,
    };
  }
  if (warn > 0) return { severity: "warn", headline: `Live, with ${warn} to review.` };
  return { severity: "ok", headline: "Live. Money moves and metering runs." };
}
