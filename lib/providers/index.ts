// lib/providers/index.ts
// Provider factory — selects the live adapter when credentials are present,
// falls back to the deterministic mock otherwise.
import type { IssuanceProvider, CapitalRailProvider, IdentityVerificationProvider } from "./types";
import { mockIssuanceProvider, mockCapitalRailProvider, mockIdentityVerificationProvider } from "./mock";
import { docusignIssuanceProvider } from "./docusign-issuance";
import { nativeSigningProvider } from "./native-signing";
import { stripeCapitalRailProvider } from "./stripe-rail";
import { stripeIdentityProvider } from "./stripe-identity";

// Priority: native signing (always available) → Docusign (when credentials set) → mock.
// Native signing is the default; Docusign is an override for orgs that prefer it.
export function getIssuanceProvider(): IssuanceProvider {
  if (docusignIssuanceProvider.isConfigured()) return docusignIssuanceProvider;
  return nativeSigningProvider;
}

// Stripe Treasury/Transfers when STRIPE_SECRET_KEY is set; mock otherwise.
export function getCapitalRailProvider(): CapitalRailProvider {
  if (stripeCapitalRailProvider.isConfigured()) return stripeCapitalRailProvider;
  return mockCapitalRailProvider;
}

// Stripe Identity when STRIPE_SECRET_KEY is set; mock otherwise.
export function getIdentityVerificationProvider(): IdentityVerificationProvider {
  if (stripeIdentityProvider.isConfigured()) return stripeIdentityProvider;
  return mockIdentityVerificationProvider;
}

export type { IssuanceProvider, CapitalRailProvider, IdentityVerificationProvider };
export type {
  IssuanceParams,
  IssuanceRecord,
  CapitalRailType,
  CapitalTransferParams,
  CapitalTransferRecord,
  VerificationLevel,
  IdentityVerificationParams,
  VerificationRecord,
  ProviderResult,
} from "./types";
