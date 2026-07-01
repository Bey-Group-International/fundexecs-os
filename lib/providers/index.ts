// lib/providers/index.ts
// Provider factory — selects the live adapter when credentials are present,
// falls back to the deterministic mock otherwise.
import type { IssuanceProvider, CapitalRailProvider, IdentityVerificationProvider } from "./types";
import { mockIssuanceProvider, mockCapitalRailProvider, mockIdentityVerificationProvider } from "./mock";
import { docusignIssuanceProvider } from "./docusign-issuance";

export function getIssuanceProvider(): IssuanceProvider {
  return docusignIssuanceProvider.isConfigured()
    ? docusignIssuanceProvider
    : mockIssuanceProvider;
}

export function getCapitalRailProvider(): CapitalRailProvider {
  return mockCapitalRailProvider;
}

export function getIdentityVerificationProvider(): IdentityVerificationProvider {
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
