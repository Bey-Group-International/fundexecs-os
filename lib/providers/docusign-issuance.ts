// lib/providers/docusign-issuance.ts
// Docusign adapter for IssuanceProvider.
//
// Docusign is already wired as the Tier-3 signing adapter in the dispatch layer
// (lib/integrations/adapters/docusign.ts). This adapter lifts it to the
// IssuanceProvider interface so the Commitment-to-Close Tracker and Capital Flow
// Engine can drive envelope creation through a stable interface without knowing
// which signing service is underneath.
//
// Real-adapter scope: envelope creation (draftSecurity) and status polling
// (getStatus). Minting (issueSecurity) maps to sending the Docusign envelope for
// signature — still Tier-3 gated, only called after operator approval.
//
// Mock-or-real: no Docusign credentials → mock responses. The product behaves
// identically whether connected or not.
import type {
  IssuanceProvider,
  IssuanceParams,
  IssuanceRecord,
  ProviderResult,
} from "./types";

function configured(): boolean {
  return Boolean(
    process.env.DOCUSIGN_ACCESS_TOKEN || process.env.DOCUSIGN_INTEGRATION_KEY,
  );
}

// Docusign base URL from env, defaulting to sandbox.
// Only allow known Docusign hostnames to prevent SSRF via env var injection.
const ALLOWED_DOCUSIGN_HOSTS = ["demo.docusign.net", "na4.docusign.net", "eu.docusign.net", "docusign.net"];
function safeBaseUrl(): string {
  const raw = process.env.DOCUSIGN_BASE_URL;
  if (!raw) return "https://demo.docusign.net/restapi";
  try {
    const parsed = new URL(raw);
    if (!ALLOWED_DOCUSIGN_HOSTS.some(h => parsed.hostname === h || parsed.hostname.endsWith("." + h))) {
      return "https://demo.docusign.net/restapi";
    }
    return raw;
  } catch {
    return "https://demo.docusign.net/restapi";
  }
}
const BASE_URL = safeBaseUrl();
const ACCOUNT_ID = process.env.DOCUSIGN_ACCOUNT_ID ?? "";

async function createEnvelope(params: IssuanceParams): Promise<string> {
  // Build a minimal Docusign envelope request for a subscription document.
  const signers = params.investorIds.map((id, idx) => ({
    email: `investor-${id}@placeholder.internal`,
    name: `Investor ${id.slice(0, 6)}`,
    recipientId: String(idx + 1),
    routingOrder: String(idx + 1),
  }));

  const body = {
    emailSubject: `Subscription agreement — ${params.securityName}`,
    documents: [
      {
        documentBase64: Buffer.from(
          `Subscription agreement for ${params.securityName} — $${params.offeringAmountUsd.toLocaleString()} offering`,
        ).toString("base64"),
        name: `${params.securityName} Subscription.txt`,
        fileExtension: "txt",
        documentId: "1",
      },
    ],
    recipients: { signers },
    status: "created", // "created" = draft; "sent" = dispatched for signing
  };

  const res = await fetch(`${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes`, {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.DOCUSIGN_ACCESS_TOKEN}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify(body),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Docusign envelope creation failed: ${res.status} ${text}`);
  }

  const data = await res.json();
  return data.envelopeId as string;
}

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function assertEnvelopeId(envelopeId: string): void {
  if (!UUID_RE.test(envelopeId)) {
    throw new Error(`Invalid envelope ID: must be a UUID`);
  }
}

async function sendEnvelope(envelopeId: string): Promise<void> {
  assertEnvelopeId(envelopeId);
  const res = await fetch(
    `${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes/${envelopeId}`,
    {
      method: "PUT",
      headers: {
        Authorization: `Bearer ${process.env.DOCUSIGN_ACCESS_TOKEN}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ status: "sent" }),
    },
  );
  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Docusign send failed: ${res.status} ${text}`);
  }
}

async function getEnvelopeStatus(envelopeId: string): Promise<string> {
  assertEnvelopeId(envelopeId);
  const res = await fetch(
    `${BASE_URL}/v2.1/accounts/${ACCOUNT_ID}/envelopes/${envelopeId}`,
    {
      headers: { Authorization: `Bearer ${process.env.DOCUSIGN_ACCESS_TOKEN}` },
    },
  );
  if (!res.ok) throw new Error(`Docusign status fetch failed: ${res.status}`);
  const data = await res.json();
  return data.status as string;
}

// Map Docusign envelope status to our IssuanceRecord status.
function mapStatus(ds: string): IssuanceRecord["status"] {
  if (ds === "completed") return "issued";
  if (ds === "voided" || ds === "declined") return "cancelled";
  return "draft";
}

export const docusignIssuanceProvider: IssuanceProvider = {
  name: "docusign-issuance",
  isConfigured: configured,

  async draftSecurity(params: IssuanceParams): Promise<ProviderResult<IssuanceRecord>> {
    if (!configured()) {
      return {
        ok: true,
        live: false,
        detail: `Prepared subscription envelope for "${params.securityName}" — ${params.investorIds.length} signer(s) (Docusign not connected).`,
        data: { securityId: `draft-${Date.now()}`, status: "draft" },
      };
    }

    try {
      const envelopeId = await createEnvelope(params);
      return {
        ok: true,
        live: true,
        detail: `Docusign envelope created for "${params.securityName}". Ready to send for signature after operator approval.`,
        reference: envelopeId,
        data: { securityId: envelopeId, status: "draft" },
      };
    } catch (err) {
      return {
        ok: false,
        live: true,
        detail: "Docusign envelope creation failed.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async issueSecurity(securityId: string, requestedBy: string): Promise<ProviderResult<IssuanceRecord>> {
    void requestedBy;
    if (!configured()) {
      return {
        ok: true,
        live: false,
        detail: `Envelope ${securityId} sent for signature (mock — Docusign not connected).`,
        data: { securityId, status: "issued", issuedAt: new Date().toISOString() },
      };
    }

    try {
      await sendEnvelope(securityId);
      return {
        ok: true,
        live: true,
        detail: `Docusign envelope ${securityId} sent for signature.`,
        reference: securityId,
        data: { securityId, status: "draft", issuedAt: new Date().toISOString() },
      };
    } catch (err) {
      return {
        ok: false,
        live: true,
        detail: "Docusign send failed.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },

  async getStatus(securityId: string): Promise<ProviderResult<IssuanceRecord>> {
    if (!configured()) {
      return {
        ok: true,
        live: false,
        detail: `Status for ${securityId} (mock).`,
        data: { securityId, status: "draft" },
      };
    }

    try {
      const ds = await getEnvelopeStatus(securityId);
      return {
        ok: true,
        live: true,
        detail: `Docusign envelope status: ${ds}`,
        reference: securityId,
        data: { securityId, status: mapStatus(ds) },
      };
    } catch (err) {
      return {
        ok: false,
        live: true,
        detail: "Docusign status fetch failed.",
        error: err instanceof Error ? err.message : String(err),
      };
    }
  },
};
