import 'server-only';
import { createClient } from '@/lib/supabase/server';

/* ============================================================================
 * lib/queries/partners.ts — Partner Marketplace surface loader.
 *
 * Reads both `service_providers` (legal, compliance, admin, tech, etc.) and
 * `capital_providers` (LPs, family offices, fund-of-funds, etc.) for the
 * org and returns a unified directory. Also surfaces any pending intro
 * requests the viewer has submitted so the UI can show per-card status.
 * ========================================================================= */

export interface ServiceProvider {
  id: string;
  name: string;
  category: string | null;
  status: string;
  capabilities: Record<string, unknown>;
  createdAt: string;
}

export interface CapitalProvider {
  id: string;
  name: string;
  status: string;
  capitalTypes: string[];
  checkSizeMin: number | null;
  checkSizeMax: number | null;
  criteria: Record<string, unknown>;
  createdAt: string;
}

/** Facets derived from real data for filter dropdowns. */
export interface PartnerFacets {
  /** Distinct non-null categories from service_providers. */
  categories: string[];
  /** Distinct capital_type values across all capital_providers. */
  capitalTypes: string[];
}

/** Sparse map of partner_id → intro request status (only if a request exists). */
export type IntroStatusMap = Record<string, string>;

export interface PartnersData {
  serviceProviders: ServiceProvider[];
  capitalProviders: CapitalProvider[];
  facets: PartnerFacets;
  /** Intro request status keyed by partner id, for the current user/org. */
  introStatus: IntroStatusMap;
  /** Most recent intro-request activity (updated_at ISO) keyed by partner id. */
  introActivity: Record<string, string>;
  empty: boolean;
}

export async function getPartnersData(orgId: string): Promise<PartnersData> {
  const supabase = await createClient();

  const [spResult, cpResult, introResult] = await Promise.all([
    supabase
      .from('service_providers')
      .select('id, name, category, status, capabilities, created_at')
      .eq('org_id', orgId)
      .order('name'),

    supabase
      .from('capital_providers')
      .select(
        'id, name, status, capital_types, check_size_min, check_size_max, criteria, created_at'
      )
      .eq('org_id', orgId)
      .order('name'),

    supabase
      .from('partner_intro_requests')
      .select('partner_id, status, updated_at')
      .eq('org_id', orgId)
      .order('updated_at', { ascending: false })
  ]);

  const serviceProviders: ServiceProvider[] = (spResult.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    category: r.category,
    status: r.status,
    capabilities: (r.capabilities as Record<string, unknown>) ?? {},
    createdAt: r.created_at
  }));

  const capitalProviders: CapitalProvider[] = (cpResult.data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    status: r.status,
    capitalTypes: r.capital_types ?? [],
    checkSizeMin: r.check_size_min,
    checkSizeMax: r.check_size_max,
    criteria: (r.criteria as Record<string, unknown>) ?? {},
    createdAt: r.created_at
  }));

  // Derive real facets from loaded data.
  const categories = Array.from(
    new Set(serviceProviders.map((p) => p.category).filter((c): c is string => Boolean(c)))
  ).sort();

  const capitalTypesSet = new Set<string>();
  for (const cp of capitalProviders) {
    for (const t of cp.capitalTypes) capitalTypesSet.add(t);
  }
  const capitalTypes = Array.from(capitalTypesSet).sort();

  // Build intro status + activity maps (most-recent request per partner).
  const introStatus: IntroStatusMap = {};
  const introActivity: Record<string, string> = {};
  for (const row of introResult.data ?? []) {
    if (!introStatus[row.partner_id]) {
      introStatus[row.partner_id] = row.status;
      introActivity[row.partner_id] = row.updated_at;
    }
  }

  const empty = serviceProviders.length === 0 && capitalProviders.length === 0;
  return {
    serviceProviders,
    capitalProviders,
    facets: { categories, capitalTypes },
    introStatus,
    introActivity,
    empty
  };
}
