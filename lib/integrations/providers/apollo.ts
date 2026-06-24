// lib/integrations/providers/apollo.ts
// Apollo.io REST API adapter for live people, company, and investor data.
// All functions return VerifiedResult — never throws, always structured.

import { verifiedFetch, scoreConfidence, failedResult } from '../../verification-engine';
import type { VerifiedResult, VerifiedPerson, VerifiedCompany } from '../../source-hub-types';

const APOLLO_BASE = 'https://api.apollo.io/v1';

function getApiKey(): string | null {
  return process.env.APOLLO_API_KEY ?? null;
}

// ── Apollo response shapes ──────────────────────────────────────────────────

interface ApolloEmailStatus {
  email: string;
  email_status?: string;
}

interface ApolloPerson {
  id?: string;
  first_name?: string;
  last_name?: string;
  name?: string;
  title?: string;
  email?: string;
  email_status?: string;
  linkedin_url?: string;
  phone_numbers?: Array<{ raw_number?: string }>;
  city?: string;
  state?: string;
  country?: string;
  seniority?: string;
  departments?: string[];
  organization?: { name?: string };
}

interface ApolloOrganization {
  id?: string;
  name?: string;
  website_url?: string;
  linkedin_url?: string;
  primary_domain?: string;
  short_description?: string;
  industry?: string;
  estimated_num_employees?: number;
  employee_count?: number;
  num_employees_enum?: string;
  annual_revenue_printed?: string;
  city?: string;
  state?: string;
  country?: string;
  founded_year?: number;
  funding_total?: number;
  latest_funding_stage?: string;
  keywords?: string[];
}

// ── Mappers ────────────────────────────────────────────────────────────────

function mapPerson(p: ApolloPerson): VerifiedPerson {
  const name = p.name ?? [p.first_name, p.last_name].filter(Boolean).join(' ') ?? 'Unknown';
  const location = [p.city, p.state, p.country].filter(Boolean).join(', ') || undefined;
  const email = p.email && p.email_status !== 'invalid' ? p.email : undefined;
  const phone = p.phone_numbers?.[0]?.raw_number;

  return {
    id: p.id,
    name,
    title: p.title,
    company: p.organization?.name,
    email,
    linkedin_url: p.linkedin_url,
    phone,
    location,
    seniority: p.seniority,
    departments: p.departments,
    provenance: 'apollo',
    confidence: scoreConfidence({
      hasName: !!name,
      hasEmail: !!email,
      hasLinkedIn: !!p.linkedin_url,
      hasPhone: !!phone,
    }),
  };
}

function mapOrganization(o: ApolloOrganization): VerifiedCompany {
  const headquarters = [o.city, o.state, o.country].filter(Boolean).join(', ') || undefined;

  return {
    id: o.id,
    name: o.name ?? 'Unknown',
    domain: o.primary_domain ?? (o.website_url ? new URL(o.website_url).hostname : undefined),
    description: o.short_description,
    industry: o.industry,
    employee_count: o.estimated_num_employees ?? o.employee_count,
    employee_range: o.num_employees_enum,
    revenue_range: o.annual_revenue_printed,
    headquarters,
    founded_year: o.founded_year,
    linkedin_url: o.linkedin_url,
    website: o.website_url,
    funding_total: o.funding_total,
    funding_stage: o.latest_funding_stage,
    keywords: o.keywords,
    provenance: 'apollo',
    confidence: scoreConfidence({
      hasName: !!o.name,
      hasEmail: false,
      hasLinkedIn: !!o.linkedin_url,
      hasRevenue: !!o.annual_revenue_printed,
      hasEmployees: !!(o.estimated_num_employees ?? o.employee_count),
    }),
  };
}

// ── Apollo POST helper ─────────────────────────────────────────────────────

async function apolloPost<T>(
  path: string,
  body: Record<string, unknown>
): Promise<T> {
  const apiKey = getApiKey();
  if (!apiKey) throw new Error('APOLLO_API_KEY not configured');

  const res = await fetch(`${APOLLO_BASE}${path}`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Cache-Control': 'no-cache',
    },
    body: JSON.stringify({ api_key: apiKey, ...body }),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => res.statusText);
    throw new Error(`Apollo ${path} responded ${res.status}: ${text}`);
  }

  return res.json() as Promise<T>;
}

// ── Public API ─────────────────────────────────────────────────────────────

export interface PeopleSearchParams {
  name?: string;
  title?: string[];
  company?: string;
  company_domain?: string;
  person_seniority?: string[];
  person_department?: string[];
  page?: number;
  per_page?: number;
}

export async function searchPeople(
  params: PeopleSearchParams
): Promise<VerifiedResult<VerifiedPerson[]>> {
  if (!getApiKey()) {
    return failedResult('apollo', '/mixed_people/search', ['APOLLO_API_KEY not configured'], []);
  }

  return verifiedFetch<VerifiedPerson[]>({
    provider: 'apollo',
    endpoint: '/mixed_people/search',
    fetch: async () => {
      const body: Record<string, unknown> = {
        page: params.page ?? 1,
        per_page: params.per_page ?? 10,
      };
      if (params.name) body['q_keywords'] = params.name;
      if (params.title?.length) body['person_titles'] = params.title;
      if (params.company) body['q_organization_name'] = params.company;
      if (params.company_domain) body['q_organization_domains'] = [params.company_domain];
      if (params.person_seniority?.length) body['person_seniorities'] = params.person_seniority;
      if (params.person_department?.length) body['person_departments'] = params.person_department;

      const res = await apolloPost<{ people?: ApolloPerson[] }>('/mixed_people/search', body);
      return (res.people ?? []).map(mapPerson);
    },
    validate: (data) => Array.isArray(data),
    confidenceScore: (data) =>
      data.length > 0
        ? parseFloat(
            (data.reduce((sum, p) => sum + p.confidence, 0) / data.length).toFixed(2)
          )
        : 0.5,
  });
}

export interface PersonEnrichParams {
  email?: string;
  linkedin_url?: string;
  name?: string;
  company?: string;
}

export async function enrichPerson(
  params: PersonEnrichParams
): Promise<VerifiedResult<VerifiedPerson | null>> {
  if (!getApiKey()) {
    return failedResult('apollo', '/people/match', ['APOLLO_API_KEY not configured'], null);
  }
  if (!params.email && !params.linkedin_url) {
    return failedResult('apollo', '/people/match', ['email or linkedin_url required'], null);
  }

  return verifiedFetch<VerifiedPerson | null>({
    provider: 'apollo',
    endpoint: '/people/match',
    fetch: async () => {
      const body: Record<string, unknown> = { reveal_personal_emails: false };
      if (params.email) body['email'] = params.email;
      if (params.linkedin_url) body['linkedin_url'] = params.linkedin_url;
      if (params.name) body['name'] = params.name;
      if (params.company) body['organization_name'] = params.company;

      const res = await apolloPost<{ person?: ApolloPerson }>('/people/match', body);
      return res.person ? mapPerson(res.person) : null;
    },
    validate: (data) => data !== undefined,
    confidenceScore: (data) => (data ? data.confidence : 0),
  });
}

export interface OrgSearchParams {
  q_organization_name?: string;
  industry?: string[];
  employee_ranges?: string[]; // e.g. ['1,10','11,50']
  keywords?: string[];
  page?: number;
  per_page?: number;
}

export async function searchOrganizations(
  params: OrgSearchParams
): Promise<VerifiedResult<VerifiedCompany[]>> {
  if (!getApiKey()) {
    return failedResult('apollo', '/mixed_companies/search', ['APOLLO_API_KEY not configured'], []);
  }

  return verifiedFetch<VerifiedCompany[]>({
    provider: 'apollo',
    endpoint: '/mixed_companies/search',
    fetch: async () => {
      const body: Record<string, unknown> = {
        page: params.page ?? 1,
        per_page: params.per_page ?? 10,
      };
      if (params.q_organization_name) body['q_organization_name'] = params.q_organization_name;
      if (params.industry?.length) body['organization_industry_tag_ids'] = params.industry;
      if (params.employee_ranges?.length)
        body['organization_num_employees_ranges'] = params.employee_ranges;
      if (params.keywords?.length) body['q_organization_keyword_tags'] = params.keywords;

      const res = await apolloPost<{ organizations?: ApolloOrganization[] }>(
        '/mixed_companies/search',
        body
      );
      return (res.organizations ?? []).map(mapOrganization);
    },
    validate: (data) => Array.isArray(data),
    confidenceScore: (data) =>
      data.length > 0
        ? parseFloat(
            (data.reduce((sum, c) => sum + c.confidence, 0) / data.length).toFixed(2)
          )
        : 0.5,
  });
}

export interface OrgEnrichParams {
  domain?: string;
  name?: string;
}

export async function enrichOrganization(
  params: OrgEnrichParams
): Promise<VerifiedResult<VerifiedCompany | null>> {
  if (!getApiKey()) {
    return failedResult('apollo', '/organizations/enrich', ['APOLLO_API_KEY not configured'], null);
  }
  if (!params.domain && !params.name) {
    return failedResult('apollo', '/organizations/enrich', ['domain or name required'], null);
  }

  return verifiedFetch<VerifiedCompany | null>({
    provider: 'apollo',
    endpoint: '/organizations/enrich',
    fetch: async () => {
      const body: Record<string, unknown> = {};
      if (params.domain) body['domain'] = params.domain;
      if (params.name) body['name'] = params.name;

      const res = await apolloPost<{ organization?: ApolloOrganization }>(
        '/organizations/enrich',
        body
      );
      return res.organization ? mapOrganization(res.organization) : null;
    },
    validate: (data) => data !== undefined,
    confidenceScore: (data) => (data ? data.confidence : 0),
  });
}

// Convenience: find investors (senior finance/capital people at asset managers)
export async function searchInvestors(params: {
  name?: string;
  firm?: string;
  seniority?: string[];
  page?: number;
  per_page?: number;
}): Promise<VerifiedResult<VerifiedPerson[]>> {
  return searchPeople({
    name: params.name,
    company: params.firm,
    title: ['Managing Director', 'Partner', 'Chief Investment Officer', 'Portfolio Manager', 'Investment Manager'],
    person_seniority: params.seniority ?? ['c_suite', 'vp', 'director', 'manager'],
    person_department: ['finance', 'investment'],
    page: params.page,
    per_page: params.per_page,
  });
}

// Email status check — used to validate before outreach
export async function verifyEmail(
  email: string
): Promise<VerifiedResult<{ email: string; valid: boolean; status: string }>> {
  if (!getApiKey()) {
    return failedResult('apollo', '/email_accounts/check', ['APOLLO_API_KEY not configured'], {
      email,
      valid: false,
      status: 'unknown',
    });
  }

  return verifiedFetch({
    provider: 'apollo',
    endpoint: '/email_accounts/check',
    fetch: async () => {
      const res = await apolloPost<ApolloEmailStatus>('/email_accounts/check', {
        email,
      });
      const status = res.email_status ?? 'unknown';
      return {
        email: res.email ?? email,
        valid: status === 'verified',
        status,
      };
    },
    validate: (data) => !!data.email,
    confidenceScore: (data) => (data.valid ? 0.95 : 0.4),
  });
}
