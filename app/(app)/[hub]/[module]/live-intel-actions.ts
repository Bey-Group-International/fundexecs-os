"use server";
// app/(app)/[hub]/[module]/live-intel-actions.ts
// Server actions powering live Apollo + AI enrichment for the three priority modules:
//   - Investor / LP Intelligence
//   - Deal Sourcing + Company Lookups
//   - People Lookups + Outreach
//
// All results flow through the verification engine and are cached in Supabase.

import { requireOrgContext } from "@/lib/auth";
import { getCached, setCached } from "@/lib/source-cache";
import {
  searchPeople,
  enrichPerson,
  searchOrganizations,
  enrichOrganization,
  searchInvestors,
  verifyEmail,
  type PeopleSearchParams,
  type OrgSearchParams,
} from "@/lib/integrations/providers/apollo";
import { enrichCompanyFit, enrichInvestorProfile } from "@/lib/integrations/providers/ai-enrichment";
import type { VerifiedResult, VerifiedPerson, VerifiedCompany, VerifiedInvestor, FitAnalysis, InvestorFitAnalysis } from "@/lib/source-hub-types";

// ── People Lookups ──────────────────────────────────────────────────────────

export async function liveSearchPeople(
  params: PeopleSearchParams
): Promise<VerifiedResult<VerifiedPerson[]>> {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return {
      status: "failed",
      verified: false,
      confidence: 0,
      timestamp: new Date().toISOString(),
      sources: [],
      data: [],
      errors: ["Not authorized"],
    };
  }

  const cached = await getCached<VerifiedPerson[]>(
    auth.ctx.orgId,
    "people",
    "apollo",
    params as Record<string, unknown>
  );
  if (cached) return cached;

  const result = await searchPeople(params);
  if (result.status !== "failed") {
    await setCached(auth.ctx.orgId, "people", "apollo", params as Record<string, unknown>, result);
  }
  return result;
}

export async function liveEnrichPerson(params: {
  email?: string;
  linkedin_url?: string;
  name?: string;
  company?: string;
}): Promise<VerifiedResult<VerifiedPerson | null>> {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return {
      status: "failed",
      verified: false,
      confidence: 0,
      timestamp: new Date().toISOString(),
      sources: [],
      data: null,
      errors: ["Not authorized"],
    };
  }

  const cached = await getCached<VerifiedPerson | null>(
    auth.ctx.orgId,
    "people",
    "apollo",
    params as Record<string, unknown>
  );
  if (cached) return cached;

  const result = await enrichPerson(params);
  if (result.status !== "failed") {
    await setCached(auth.ctx.orgId, "people", "apollo", params as Record<string, unknown>, result);
  }
  return result;
}

export async function liveVerifyEmail(
  email: string
): Promise<VerifiedResult<{ email: string; valid: boolean; status: string }>> {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return {
      status: "failed",
      verified: false,
      confidence: 0,
      timestamp: new Date().toISOString(),
      sources: [],
      data: { email, valid: false, status: "unknown" },
      errors: ["Not authorized"],
    };
  }

  const params = { email };
  const cached = await getCached<{ email: string; valid: boolean; status: string }>(
    auth.ctx.orgId,
    "people",
    "apollo",
    params
  );
  if (cached) return cached;

  const result = await verifyEmail(email);
  if (result.status !== "failed") {
    await setCached(auth.ctx.orgId, "people", "apollo", params, result);
  }
  return result;
}

// ── Company / Deal Sourcing ─────────────────────────────────────────────────

export async function liveSearchCompanies(
  params: OrgSearchParams
): Promise<VerifiedResult<VerifiedCompany[]>> {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return {
      status: "failed",
      verified: false,
      confidence: 0,
      timestamp: new Date().toISOString(),
      sources: [],
      data: [],
      errors: ["Not authorized"],
    };
  }

  const cached = await getCached<VerifiedCompany[]>(
    auth.ctx.orgId,
    "company",
    "apollo",
    params as Record<string, unknown>
  );
  if (cached) return cached;

  const result = await searchOrganizations(params);
  if (result.status !== "failed") {
    await setCached(auth.ctx.orgId, "company", "apollo", params as Record<string, unknown>, result);
  }
  return result;
}

export async function liveEnrichCompany(params: {
  domain?: string;
  name?: string;
}): Promise<VerifiedResult<VerifiedCompany | null>> {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return {
      status: "failed",
      verified: false,
      confidence: 0,
      timestamp: new Date().toISOString(),
      sources: [],
      data: null,
      errors: ["Not authorized"],
    };
  }

  const cached = await getCached<VerifiedCompany | null>(
    auth.ctx.orgId,
    "company",
    "apollo",
    params as Record<string, unknown>
  );
  if (cached) return cached;

  const result = await enrichOrganization(params);
  if (result.status !== "failed") {
    await setCached(auth.ctx.orgId, "company", "apollo", params as Record<string, unknown>, result);
  }
  return result;
}

export async function liveEnrichCompanyFit(
  company: VerifiedCompany,
  mandate: { strategy?: string; geography?: string; targetSize?: string; sector?: string }
): Promise<FitAnalysis> {
  return enrichCompanyFit(company, mandate);
}

// ── Investor / LP Intelligence ──────────────────────────────────────────────

export async function liveSearchInvestors(params: {
  name?: string;
  firm?: string;
  seniority?: string[];
  page?: number;
  per_page?: number;
}): Promise<VerifiedResult<VerifiedPerson[]>> {
  const auth = await requireOrgContext();
  if (!auth.ok) {
    return {
      status: "failed",
      verified: false,
      confidence: 0,
      timestamp: new Date().toISOString(),
      sources: [],
      data: [],
      errors: ["Not authorized"],
    };
  }

  const cached = await getCached<VerifiedPerson[]>(
    auth.ctx.orgId,
    "investor",
    "apollo",
    params as Record<string, unknown>
  );
  if (cached) return cached;

  const result = await searchInvestors(params);
  if (result.status !== "failed") {
    await setCached(auth.ctx.orgId, "investor", "apollo", params as Record<string, unknown>, result);
  }
  return result;
}

export async function liveEnrichInvestor(
  investor: VerifiedInvestor,
  mandate: { strategy?: string; targetAUM?: string; sector?: string }
): Promise<InvestorFitAnalysis> {
  return enrichInvestorProfile(investor, mandate);
}
