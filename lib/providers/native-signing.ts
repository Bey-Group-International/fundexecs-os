// lib/providers/native-signing.ts
// IssuanceProvider implementation using the FundExecs native signing system.
// No external dependency — always available (isConfigured returns true).
// Follows mock-or-real discipline: when NEXT_PUBLIC_SUPABASE_URL is absent the
// provider returns well-formed mock responses so the product runs locally.

import { headers } from "next/headers";
import { getAppUrl } from "@/lib/integrations/adapters/app-url";
import type {
  IssuanceProvider,
  IssuanceParams,
  IssuanceRecord,
  ProviderResult,
} from "./types";

// ─── Helpers ──────────────────────────────────────────────────────────────────

function isMockMode(): boolean {
  return !process.env.NEXT_PUBLIC_SUPABASE_URL;
}

function buildSubscriptionAgreement(params: IssuanceParams): string {
  return `SUBSCRIPTION AGREEMENT

Security Name: ${params.securityName}
Offering Amount: $${params.offeringAmountUsd.toLocaleString("en-US")} USD
Deal ID: ${params.dealId}
Organization ID: ${params.orgId}
Requested By: ${params.requestedBy}
Date: ${new Date().toISOString()}

This Subscription Agreement ("Agreement") is entered into between the issuer
identified above ("Issuer") and each investor identified below ("Subscriber").

Subscribers:
${params.investorIds.map((id, i) => `  ${i + 1}. Investor ID: ${id}`).join("\n")}

By executing this Agreement, each Subscriber agrees to purchase, and the Issuer
agrees to sell, the security described herein on the terms and conditions set
forth in the accompanying offering documents.

[Signature pages follow]
`;
}

// The envelope routes authenticate from the session cookie, and this is a
// server-to-server call, so without forwarding it every request is a 401.
async function sessionCookie(): Promise<Record<string, string>> {
  try {
    const cookie = (await headers()).get("cookie");
    return cookie ? { Cookie: cookie } : {};
  } catch {
    // Not inside a request (a script or a test): there is no session to forward.
    return {};
  }
}

async function apiFetch<T>(
  path: string,
  options?: RequestInit
): Promise<{ ok: boolean; data?: T; error?: string; status?: number }> {
  // getAppUrl only returns localhost or this deploy's own hosts, so the
  // caller's session cookie below never leaves the app.
  const url = `${getAppUrl()}${path}`;
  try {
    const res = await fetch(url, {
      ...options,
      headers: {
        "Content-Type": "application/json",
        ...(await sessionCookie()),
        ...(options?.headers ?? {}),
      },
    });
    const text = await res.text();
    let data: T | undefined;
    try {
      data = text ? (JSON.parse(text) as T) : undefined;
    } catch {
      // non-JSON body; leave data undefined
    }
    if (!res.ok) {
      return {
        ok: false,
        status: res.status,
        error: (data as { error?: string } | undefined)?.error ?? text,
      };
    }
    return { ok: true, data, status: res.status };
  } catch (err) {
    return { ok: false, error: String(err) };
  }
}

// ─── Mock helpers ─────────────────────────────────────────────────────────────

function mockEnvelopeId(): string {
  return `mock-env-${Date.now()}-${Math.random().toString(36).slice(2, 7)}`;
}

function mockDraft(
  securityId: string
): ProviderResult<IssuanceRecord> {
  return {
    ok: true,
    live: false,
    detail: "Mock draft envelope created (no Supabase configured).",
    reference: securityId,
    data: { securityId, status: "draft" },
  };
}

function mockIssued(
  securityId: string,
  status: IssuanceRecord["status"]
): ProviderResult<IssuanceRecord> {
  return {
    ok: true,
    live: false,
    detail: `Mock envelope ${securityId} — status: ${status}.`,
    reference: securityId,
    data: {
      securityId,
      status,
      ...(status === "issued" ? { issuedAt: new Date().toISOString() } : {}),
    },
  };
}

// ─── Envelope status mapping ──────────────────────────────────────────────────

function mapEnvelopeStatus(
  raw: string | undefined
): IssuanceRecord["status"] {
  switch (raw?.toLowerCase()) {
    case "completed":
      return "issued";
    case "voided":
    case "declined":
      return "cancelled";
    default:
      return "draft";
  }
}

// ─── Provider implementation ──────────────────────────────────────────────────

export const nativeSigningProvider: IssuanceProvider = {
  name: "native-signing",

  isConfigured(): boolean {
    return true;
  },

  async draftSecurity(
    params: IssuanceParams
  ): Promise<ProviderResult<IssuanceRecord>> {
    if (isMockMode()) {
      return mockDraft(mockEnvelopeId());
    }

    const body = {
      title: params.securityName,
      documentContent: buildSubscriptionAgreement(params),
      recipients: params.investorIds.map((id) => ({
        investorId: id,
        // Placeholder — resolved by the envelope service from the investor record
        name: `Investor ${id}`,
        email: `${id}@placeholder.fundexecs.internal`,
        routingOrder: 1,
      })),
      metadata: {
        orgId: params.orgId,
        dealId: params.dealId,
        offeringAmountUsd: params.offeringAmountUsd,
        requestedBy: params.requestedBy,
      },
    };

    const result = await apiFetch<{ envelopeId: string; status?: string }>(
      "/api/envelopes/create",
      { method: "POST", body: JSON.stringify(body) }
    );

    if (!result.ok || !result.data?.envelopeId) {
      return {
        ok: false,
        live: true,
        detail: "Failed to create draft envelope.",
        error: result.error ?? "Unknown error from /api/envelopes/create",
      };
    }

    const envelopeId = result.data.envelopeId;
    return {
      ok: true,
      live: true,
      detail: `Draft envelope created: ${envelopeId}`,
      reference: envelopeId,
      data: { securityId: envelopeId, status: "draft" },
    };
  },

  // The envelope routes behind this adapter resolve the organization from the
  // session themselves, so `orgId` is not needed here.
  async issueSecurity(
    securityId: string,
    requestedBy: string,
    orgId: string
  ): Promise<ProviderResult<IssuanceRecord>> {
    void orgId;
    if (isMockMode()) {
      // Simulate: first send leaves it in draft (pending signatures)
      return mockIssued(securityId, "draft");
    }

    const result = await apiFetch<{ ok?: boolean }>(`/api/envelopes/${encodeURIComponent(securityId)}/send`, {
      method: "POST",
      body: JSON.stringify({ requestedBy }),
    });

    if (!result.ok) {
      return {
        ok: false,
        live: true,
        detail: `Failed to send envelope ${securityId}.`,
        error: result.error,
      };
    }

    // Sending only puts the envelope out for signature. It is issued once every
    // signer has signed, which getStatus reports as "completed".
    return {
      ok: true,
      live: true,
      detail: `Envelope ${securityId} sent for signature — awaiting signers.`,
      reference: securityId,
      data: { securityId, status: "draft" },
    };
  },

  async getStatus(
    securityId: string,
    orgId: string
  ): Promise<ProviderResult<IssuanceRecord>> {
    void orgId;
    if (isMockMode()) {
      return mockIssued(securityId, "draft");
    }

    // GET /api/envelopes/[id]/status nests the envelope under `envelope`.
    const result = await apiFetch<{
      envelope?: { status?: string; completed_at?: string | null };
    }>(`/api/envelopes/${encodeURIComponent(securityId)}/status`);

    if (!result.ok) {
      return {
        ok: false,
        live: true,
        detail: `Failed to retrieve status for envelope ${securityId}.`,
        error: result.error,
      };
    }

    const rawStatus = result.data?.envelope?.status;
    const completedAt = result.data?.envelope?.completed_at;
    const status = mapEnvelopeStatus(rawStatus);

    return {
      ok: true,
      live: true,
      detail: `Envelope ${securityId} — status: ${status} (raw: ${rawStatus ?? "unknown"}).`,
      reference: securityId,
      data: {
        securityId,
        status,
        ...(status === "issued" && completedAt ? { issuedAt: completedAt } : {}),
      },
    };
  },
};
