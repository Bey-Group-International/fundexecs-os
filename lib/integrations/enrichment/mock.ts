import type {
  CompanyInput,
  EnrichedCompany,
  EnrichedPerson,
  EnrichmentProvider,
  PersonInput
} from './types';

/* ============================================================================
 * lib/integrations/enrichment/mock.ts — deterministic fallback provider.
 *
 * Used when no real vendor key is configured (dev, tests, and a safe default in
 * prod): it echoes the normalized input back as a "found" record only when the
 * caller already supplied an identifier, so the surface is demonstrable without
 * inventing facts. It never enriches beyond what it was given.
 * ========================================================================= */

export const mockEnrichmentProvider: EnrichmentProvider = {
  id: 'mock',

  async enrichPerson(input: PersonInput): Promise<EnrichedPerson> {
    const hasIdentity = !!(input.email || input.linkedinUrl || input.fullName);
    if (!hasIdentity) return { found: false };
    return {
      found: true,
      fullName: input.fullName,
      company: input.company,
      linkedinUrl: input.linkedinUrl,
      emails: input.email ? [input.email.toLowerCase()] : [],
      raw: { provider: 'mock', echo: input }
    };
  },

  async enrichCompany(input: CompanyInput): Promise<EnrichedCompany> {
    const hasIdentity = !!(input.domain || input.name);
    if (!hasIdentity) return { found: false };
    return {
      found: true,
      name: input.name,
      domain: input.domain?.trim().toLowerCase(),
      raw: { provider: 'mock', echo: input }
    };
  }
};
