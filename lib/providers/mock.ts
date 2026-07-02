// lib/providers/mock.ts
// Deterministic mock adapters for all three infrastructure providers.
// Used in development, CI, and any environment where real credentials are absent.
// Every method returns a well-formed result so the full workflow runs locally.
import type {
  IssuanceProvider,
  IssuanceParams,
  IssuanceRecord,
  CapitalRailProvider,
  CapitalTransferParams,
  CapitalTransferRecord,
  CapitalRailType,
  IdentityVerificationProvider,
  IdentityVerificationParams,
  VerificationRecord,
  ProviderResult,
} from "./types";

// ─── Mock Issuance ────────────────────────────────────────────────────────────

export const mockIssuanceProvider: IssuanceProvider = {
  name: "mock-issuance",
  isConfigured: () => false,

  async draftSecurity(params: IssuanceParams): Promise<ProviderResult<IssuanceRecord>> {
    const securityId = `mock-sec-${params.dealId.slice(0, 8)}`;
    return {
      ok: true,
      live: false,
      detail: `Drafted security "${params.securityName}" for ${params.investorIds.length} investor(s) — $${params.offeringAmountUsd.toLocaleString()} offering (mock).`,
      reference: securityId,
      data: { securityId, status: "draft" },
    };
  },

  async issueSecurity(securityId: string, requestedBy: string): Promise<ProviderResult<IssuanceRecord>> {
    void requestedBy;
    return {
      ok: true,
      live: false,
      detail: `Security ${securityId} marked as issued (mock — no real minting occurred).`,
      reference: securityId,
      data: { securityId, status: "issued", issuedAt: new Date().toISOString() },
    };
  },

  async getStatus(securityId: string): Promise<ProviderResult<IssuanceRecord>> {
    return {
      ok: true,
      live: false,
      detail: `Status for ${securityId} (mock).`,
      data: { securityId, status: "draft" },
    };
  },
};

// ─── Mock Capital Rail ────────────────────────────────────────────────────────

export const mockCapitalRailProvider: CapitalRailProvider = {
  name: "mock-capital-rail",
  isConfigured: () => false,
  supportedRails: (): CapitalRailType[] => ["ach", "wire", "internal"],

  async initiate(params: CapitalTransferParams): Promise<ProviderResult<CapitalTransferRecord>> {
    const transferId = `mock-xfr-${params.capitalEventId.slice(0, 8)}`;
    return {
      ok: true,
      live: false,
      detail: `Initiated ${params.railType.toUpperCase()} transfer of $${params.amountUsd.toLocaleString()} (mock — not sent).`,
      reference: transferId,
      data: { transferId, status: "pending" },
    };
  },

  async getStatus(transferId: string): Promise<ProviderResult<CapitalTransferRecord>> {
    return {
      ok: true,
      live: false,
      detail: `Status for ${transferId} (mock).`,
      data: { transferId, status: "pending" },
    };
  },
};

// ─── Mock Identity Verification ───────────────────────────────────────────────

export const mockIdentityVerificationProvider: IdentityVerificationProvider = {
  name: "mock-identity",
  isConfigured: () => false,

  async initiate(params: IdentityVerificationParams): Promise<ProviderResult<VerificationRecord>> {
    const verificationId = `mock-kyc-${params.subjectId.slice(0, 8)}`;
    return {
      ok: true,
      live: false,
      detail: `Initiated ${params.level.toUpperCase()} verification for ${params.subjectName} (mock — not sent to external provider).`,
      reference: verificationId,
      data: { verificationId, level: params.level, status: "pending" },
    };
  },

  async getStatus(verificationId: string): Promise<ProviderResult<VerificationRecord>> {
    return {
      ok: true,
      live: false,
      detail: `Status for ${verificationId} (mock — approved for dev).`,
      data: { verificationId, level: "kyc", status: "approved" },
    };
  },
};
