// lib/lp-identity.ts
// What a Stripe Identity result means for an LP's onboarding. Pure, so the rules
// are tested on their own and the LP wizard and the fund manager's refresh read
// the same ones.
//
// Only Stripe's own "verified" ever clears the identity check. Everything else
// leaves it pending (still to do, or being processed) or failed (canceled).
import type { VerificationRecord } from "@/lib/providers/types";

/** A cleared identity check is good for a year, matching how long a returning LP's clearance is reused. */
export const IDENTITY_VALID_DAYS = 365;

export type IdentityState = "none" | "needs_input" | "processing" | "verified" | "canceled";

export interface IdentityOutcome {
  state: Exclude<IdentityState, "none">;
  check: {
    status: "pending" | "clear" | "failed";
    summary: string;
    checked_at: string | null;
    expires_at: string | null;
  };
}

const MAX_NOTE = 200;

export function identityOutcome(
  record: Pick<VerificationRecord, "status" | "providerStatus" | "notes">,
  now: number = Date.now(),
): IdentityOutcome {
  if (record.status === "approved") {
    return {
      state: "verified",
      check: {
        status: "clear",
        summary: "Government ID and selfie verified by Stripe Identity. Compare the name on the ID with the legal name given.",
        checked_at: new Date(now).toISOString(),
        expires_at: new Date(now + IDENTITY_VALID_DAYS * 86_400_000).toISOString(),
      },
    };
  }
  if (record.status === "rejected") {
    return {
      state: "canceled",
      check: { status: "failed", summary: "The verification was canceled.", checked_at: new Date(now).toISOString(), expires_at: null },
    };
  }
  if (record.providerStatus === "processing") {
    return {
      state: "processing",
      check: { status: "pending", summary: "Submitted to Stripe Identity. Waiting for the result.", checked_at: null, expires_at: null },
    };
  }
  const note = (record.notes ?? "").trim().slice(0, MAX_NOTE);
  return {
    state: "needs_input",
    check: {
      status: "pending",
      summary: note ? `The last attempt did not pass: ${note}` : "Waiting for the LP to complete verification with Stripe Identity.",
      checked_at: null,
      expires_at: null,
    },
  };
}

/** The words an LP sees for each state. */
export const IDENTITY_STATE_LABEL: Record<IdentityState, string> = {
  none: "Not started",
  needs_input: "Waiting for you to finish",
  processing: "Being checked",
  verified: "Verified",
  canceled: "Canceled",
};
