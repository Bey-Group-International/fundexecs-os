import type {
  CompanyInput,
  EnrichedCompany,
  EnrichedPerson,
  EnrichmentProvider,
  PersonInput
} from './types';

/* ============================================================================
 * lib/integrations/enrichment/orthogonal.ts — Orthogonal aggregator adapter
 * (Phase 2, P2-A). Orthogonal exposes a unified, pay-per-call API that fronts
 * many enrichment vendors, so one key buys broad coverage.
 *
 * Config-driven on purpose: base URL, paths, and the API key come from env, so
 * the exact endpoint contract can be tuned to the live API without code churn
 * (the docs are gated and the contract may evolve). NEVER-BLOCK: no key or any
 * error → `{ found: false }`. The response mappers are pure + exported so they
 * can be unit-tested against real sample payloads.
 * ========================================================================= */

const DEFAULT_BASE = 'https://api.orthogonal.com';
const REQUEST_TIMEOUT_MS = 10_000;

function cfg() {
  return {
    key: process.env.ORTHOGONAL_API_KEY,
    base: (process.env.ORTHOGONAL_BASE_URL || DEFAULT_BASE).replace(/\/$/, ''),
    personPath: process.env.ORTHOGONAL_PERSON_PATH || '/v1/enrich/person',
    companyPath: process.env.ORTHOGONAL_COMPANY_PATH || '/v1/enrich/company'
  };
}

/** Pull the most likely data object out of a vendor envelope (`data`/`result`/root). */
function unwrap(json: unknown): Record<string, unknown> {
  if (!json || typeof json !== 'object') return {};
  const o = json as Record<string, unknown>;
  for (const k of ['data', 'result', 'person', 'company', 'profile']) {
    if (o[k] && typeof o[k] === 'object') return o[k] as Record<string, unknown>;
  }
  return o;
}

function str(o: Record<string, unknown>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = o[k];
    if (typeof v === 'string' && v.trim()) return v.trim();
  }
  return undefined;
}

function num(o: Record<string, unknown>, ...keys: string[]): number | undefined {
  for (const k of keys) {
    const v = o[k];
    const n = typeof v === 'number' ? v : typeof v === 'string' ? Number(v) : NaN;
    if (Number.isFinite(n)) return n;
  }
  return undefined;
}

function strList(o: Record<string, unknown>, ...keys: string[]): string[] {
  for (const k of keys) {
    const v = o[k];
    if (Array.isArray(v)) {
      const out = v.filter((x): x is string => typeof x === 'string' && x.trim().length > 0);
      if (out.length) return out.map((s) => s.trim());
    }
    if (typeof v === 'string' && v.trim()) return [v.trim()];
  }
  return [];
}

/** Map an Orthogonal person payload into the normalized shape. Pure + total. */
export function mapPersonResponse(json: unknown): EnrichedPerson {
  const o = unwrap(json);
  const emails = strList(o, 'emails', 'email', 'work_email', 'personal_emails');
  const phones = strList(o, 'phones', 'phone', 'phone_numbers', 'mobile');
  const person: EnrichedPerson = {
    found: false,
    fullName: str(o, 'full_name', 'name', 'fullName'),
    title: str(o, 'title', 'job_title', 'headline'),
    company: str(o, 'company', 'company_name', 'organization'),
    companyDomain: str(o, 'company_domain', 'companyDomain', 'domain'),
    location: str(o, 'location', 'city', 'geo'),
    linkedinUrl: str(o, 'linkedin_url', 'linkedinUrl', 'linkedin'),
    emails: emails.map((e) => e.toLowerCase()),
    phones,
    raw: json
  };
  person.found = !!(
    person.fullName ||
    person.title ||
    person.company ||
    person.emails!.length ||
    person.phones!.length
  );
  return person;
}

/** Map an Orthogonal company payload into the normalized shape. Pure + total. */
export function mapCompanyResponse(json: unknown): EnrichedCompany {
  const o = unwrap(json);
  const company: EnrichedCompany = {
    found: false,
    name: str(o, 'name', 'company_name', 'legal_name'),
    domain: str(o, 'domain', 'website', 'company_domain')?.toLowerCase(),
    industry: str(o, 'industry', 'sector'),
    description: str(o, 'description', 'summary', 'about'),
    employeeCount: num(o, 'employee_count', 'employees', 'headcount', 'size'),
    location: str(o, 'location', 'hq', 'headquarters'),
    foundedYear: num(o, 'founded_year', 'founded', 'year_founded'),
    linkedinUrl: str(o, 'linkedin_url', 'linkedinUrl', 'linkedin'),
    raw: json
  };
  company.found = !!(
    company.name ||
    company.domain ||
    company.industry ||
    company.description ||
    company.employeeCount
  );
  return company;
}

async function post(path: string, body: unknown): Promise<unknown | null> {
  const { key, base } = cfg();
  if (!key) return null; // never-block: no key → no data
  try {
    const res = await fetch(`${base}${path}`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Accept: 'application/json',
        Authorization: `Bearer ${key}`
      },
      body: JSON.stringify(body),
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS)
    });
    if (!res.ok) return null;
    return await res.json();
  } catch {
    return null; // timeout / network / parse → degrade
  }
}

export const orthogonalEnrichmentProvider: EnrichmentProvider = {
  id: 'orthogonal',

  async enrichPerson(input: PersonInput): Promise<EnrichedPerson> {
    const json = await post(cfg().personPath, {
      email: input.email,
      name: input.fullName,
      company: input.company,
      linkedin_url: input.linkedinUrl
    });
    if (!json) return { found: false };
    return mapPersonResponse(json);
  },

  async enrichCompany(input: CompanyInput): Promise<EnrichedCompany> {
    const json = await post(cfg().companyPath, {
      domain: input.domain,
      name: input.name
    });
    if (!json) return { found: false };
    return mapCompanyResponse(json);
  }
};

/** True when a real Orthogonal key is configured (else callers use the mock). */
export function orthogonalConfigured(): boolean {
  return !!process.env.ORTHOGONAL_API_KEY;
}
