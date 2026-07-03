// lib/providers/types.ts
// Infrastructure provider interfaces — the seam between FundExecs OS native
// workflows and external rails.  Every provider is a swappable adapter; the
// user never sees the underlying service name.
//
// Three primitives per the build spec:
//   IssuanceProvider    — digital securities issuance (ERC-1400-style semantics)
//   CapitalRailProvider — capital movement (ACH / wire / card)
//   IdentityVerificationProvider — KYC / AML / accreditation
//
// All providers follow mock-or-real discipline: when credentials are absent the
// mock returns a well-formed result so the product runs locally with no external
// account.

// ─── Shared ───────────────────────────────────────────────────────────────────

export interface ProviderResult<T = unknown> {
  ok: boolean;
  /** True only when a real external call was made. */
  live: boolean;
  /** Human-readable outcome for the operator. */
  detail: string;
  /** External reference (envelope id, transaction id, verification id). */
  reference?: string;
  /** Structured payload; shape depends on the provider method. */
  data?: T;
  error?: string;
}

// ─── IssuanceProvider ─────────────────────────────────────────────────────────

export interface IssuanceParams {
  orgId: string;
  dealId: string;
  /** Display name for this security (e.g. "Series A Preferred Units"). */
  securityName: string;
  /** Total offering amount in USD. */
  offeringAmountUsd: number;
  /** Investor identifiers who will receive the digital certificate. */
  investorIds: string[];
  /** Internal actor requesting issuance (for audit). */
  requestedBy: string;
}

export interface IssuanceRecord {
  securityId: string;
  status: "draft" | "issued" | "cancelled";
  issuedAt?: string;
}

export interface IssuanceProvider {
  /** Stable provider name surfaced in provenance logs. */
  name: string;
  isConfigured(): boolean;
  /** Create a draft security; returns immediately without minting. */
  draftSecurity(params: IssuanceParams): Promise<ProviderResult<IssuanceRecord>>;
  /** Mint / finalize the security after operator approval. */
  issueSecurity(securityId: string, requestedBy: string): Promise<ProviderResult<IssuanceRecord>>;
  /** Retrieve current status of a security. */
  getStatus(securityId: string): Promise<ProviderResult<IssuanceRecord>>;
}

// ─── CapitalRailProvider ──────────────────────────────────────────────────────

export type CapitalRailType = "ach" | "wire" | "card" | "internal";

export interface CapitalTransferParams {
  orgId: string;
  /** Internal ledger reference linking this to a capital event. */
  capitalEventId: string;
  amountUsd: number;
  railType: CapitalRailType;
  // TODO: wire to source_transaction / source param when multi-ledger is needed.
  // Currently unused — internal rail draws from the platform balance;
  // ACH/wire rails source from STRIPE_FINANCIAL_ACCOUNT_ID.
  fromAccountRef: string;
  toAccountRef: string;
  memo?: string;
  requestedBy: string;
}

export interface CapitalTransferRecord {
  transferId: string;
  status: "initiated" | "pending" | "settled" | "failed";
  settledAt?: string;
  feeUsd?: number;
}

export interface CapitalRailProvider {
  name: string;
  isConfigured(): boolean;
  supportedRails(): CapitalRailType[];
  /** Initiate a transfer; always requires prior Tier-3 gate approval. */
  initiate(params: CapitalTransferParams): Promise<ProviderResult<CapitalTransferRecord>>;
  getStatus(transferId: string): Promise<ProviderResult<CapitalTransferRecord>>;
}

// ─── IdentityVerificationProvider ────────────────────────────────────────────

export type VerificationLevel = "accreditation" | "kyc" | "kyb" | "aml";

export interface IdentityVerificationParams {
  orgId: string;
  subjectId: string;
  subjectType: "individual" | "entity";
  subjectName: string;
  subjectEmail?: string;
  level: VerificationLevel;
  requestedBy: string;
}

export interface VerificationRecord {
  verificationId: string;
  level: VerificationLevel;
  status: "pending" | "approved" | "rejected" | "expired";
  completedAt?: string;
  expiresAt?: string;
  notes?: string;
}

export interface IdentityVerificationProvider {
  name: string;
  isConfigured(): boolean;
  /** Initiate a verification; sends request to the counterparty. */
  initiate(params: IdentityVerificationParams): Promise<ProviderResult<VerificationRecord>>;
  getStatus(verificationId: string): Promise<ProviderResult<VerificationRecord>>;
}
