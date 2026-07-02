// lib/providers/stripe-identity.ts
// IdentityVerificationProvider backed by Stripe Identity.
// Requires STRIPE_SECRET_KEY. Falls back to the mock provider when unconfigured.
//
// Each initiate() call creates a Stripe VerificationSession and returns its
// client_secret URL so the operator can share it with the subject (LP/investor).
// getStatus() polls the session and maps Stripe's status back to VerificationRecord.
import type {
  IdentityVerificationProvider,
  IdentityVerificationParams,
  VerificationRecord,
  ProviderResult,
} from "./types";

function configured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

const STRIPE_API = "https://api.stripe.com/v1";

// Stripe IDs are alphanumeric+underscore only — validate before interpolating into paths.
function assertStripeId(id: string): void {
  if (!/^[a-zA-Z0-9_]+$/.test(id)) throw new Error(`Invalid Stripe ID: "${id}"`);
}

async function stripePost<T>(path: string, body: URLSearchParams, idempotencyKey?: string): Promise<T> {
  const headers: Record<string, string> = {
    Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
    "Content-Type": "application/x-www-form-urlencoded",
  };
  if (idempotencyKey) headers["Idempotency-Key"] = idempotencyKey;
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers,
    body: body.toString(),
    signal: AbortSignal.timeout(10_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Stripe ${path}: ${res.status} — ${text}`);
  }
  return res.json() as Promise<T>;
}

async function stripeGet<T>(path: string): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    headers: { Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}` },
    signal: AbortSignal.timeout(8_000),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Stripe ${path}: ${res.status} — ${text}`);
  }
  return res.json() as Promise<T>;
}

// Stripe Identity VerificationSession status → internal VerificationRecord status
function mapStatus(s: string): VerificationRecord["status"] {
  if (s === "verified") return "approved";
  if (s === "canceled") return "rejected";
  return "pending";
}

export const stripeIdentityProvider: IdentityVerificationProvider = {
  name: "stripe-identity",
  isConfigured: configured,

  async initiate(params: IdentityVerificationParams): Promise<ProviderResult<VerificationRecord>> {
    if (!configured()) {
      return {
        ok: false,
        live: false,
        detail: "Stripe not configured — set STRIPE_SECRET_KEY to enable identity verification.",
        data: { verificationId: "", level: params.level, status: "pending" },
      };
    }

    try {
      const body = new URLSearchParams({
        type: "document",
        "options[document][require_matching_selfie]": "true",
        "metadata[org_id]": params.orgId,
        "metadata[subject_id]": params.subjectId,
        "metadata[subject_type]": params.subjectType,
        "metadata[level]": params.level,
        "metadata[requested_by]": params.requestedBy,
      });
      if (params.subjectEmail) body.set("email", params.subjectEmail);

      // Use | separator (can't appear in Stripe IDs) to prevent field-value collision.
      // Include today's date so a re-initiation the next day creates a fresh session
      // rather than returning the cached canceled one within the 24h idempotency window.
      const today = new Date().toISOString().slice(0, 10);
      const idempotencyKey = `stripe-kyc|${params.orgId}|${params.subjectId}|${params.level}|${today}`;
      const session = await stripePost<{ id: string; status: string; url: string; created: number }>(
        "/identity/verification_sessions",
        body,
        idempotencyKey,
      );

      return {
        ok: true,
        live: true,
        detail: `${params.level.toUpperCase()} verification initiated for ${params.subjectName}. Share the link to complete verification.`,
        reference: session.url,
        data: {
          verificationId: session.id,
          level: params.level,
          status: mapStatus(session.status),
        },
      };
    } catch (err) {
      const ref = crypto.randomUUID().slice(0, 8);
      // Log only error type — message may contain user-supplied IDs from the Stripe request path.
      console.error(`[stripe-identity:${ref}] initiate failed (${err instanceof Error ? err.constructor.name : typeof err})`);
      return {
        ok: false,
        live: false,
        detail: `Identity verification could not be initiated for ${params.subjectName}. Ref: ${ref}`,
        data: { verificationId: "", level: params.level, status: "pending" },
      };
    }
  },

  async getStatus(verificationId: string): Promise<ProviderResult<VerificationRecord>> {
    if (!configured()) {
      return {
        ok: false,
        live: false,
        detail: "Stripe not configured.",
        data: { verificationId, level: "kyc", status: "pending" },
      };
    }

    try {
      assertStripeId(verificationId);
      const session = await stripeGet<{ id: string; status: string; created: number; last_error?: { reason: string } }>(
        `/identity/verification_sessions/${encodeURIComponent(verificationId)}`,
      );

      const status = mapStatus(session.status);
      return {
        ok: true,
        live: true,
        detail: `Verification ${verificationId}: ${session.status}.`,
        data: {
          verificationId: session.id,
          level: "kyc",
          status,
          // Use Stripe's authoritative created timestamp, not the server clock.
          ...(status === "approved" ? { completedAt: new Date(session.created * 1000).toISOString() } : {}),
          ...(session.last_error ? { notes: session.last_error.reason } : {}),
        },
      };
    } catch (err) {
      const ref = crypto.randomUUID().slice(0, 8);
      // Log only error type — message may contain user-supplied verificationId from the Stripe request path.
      console.error(`[stripe-identity:${ref}] getStatus failed (${err instanceof Error ? err.constructor.name : typeof err})`);
      return {
        ok: false,
        live: false,
        detail: `Could not fetch verification status. Ref: ${ref}`,
        data: { verificationId, level: "kyc", status: "pending" },
      };
    }
  },
};
