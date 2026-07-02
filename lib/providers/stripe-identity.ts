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

async function stripePost<T>(path: string, body: URLSearchParams): Promise<T> {
  const res = await fetch(`${STRIPE_API}${path}`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.STRIPE_SECRET_KEY}`,
      "Content-Type": "application/x-www-form-urlencoded",
    },
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

      const session = await stripePost<{ id: string; status: string; url: string }>(
        "/identity/verification_sessions",
        body,
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
      return {
        ok: false,
        live: false,
        detail: `Identity verification could not be initiated for ${params.subjectName}.`,
        error: err instanceof Error ? err.message : String(err),
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
      const session = await stripeGet<{ id: string; status: string; last_error?: { reason: string } }>(
        `/identity/verification_sessions/${verificationId}`,
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
          ...(status === "approved" ? { completedAt: new Date().toISOString() } : {}),
          ...(session.last_error ? { notes: session.last_error.reason } : {}),
        },
      };
    } catch (err) {
      return {
        ok: false,
        live: false,
        detail: `Could not fetch verification status for ${verificationId}.`,
        error: err instanceof Error ? err.message : String(err),
        data: { verificationId, level: "kyc", status: "pending" },
      };
    }
  },
};
