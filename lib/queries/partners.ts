import 'server-only';
import { createClient } from '@/lib/supabase/server';

/* ============================================================================
 * lib/queries/partners.ts — Partner Marketplace surface loader.
 *
 * Reads both `service_providers` (legal, compliance, admin, tech, etc.) and
 * `capital_providers` (LPs, family offices, fund-of-funds, etc.) for the
 * org and returns a unified directory. Claude's backend may extend the shape
 * with contact details or relationship metadata — the UI binds to these typed
 * contracts and falls back gracefully when tables are empty.
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

export interface PartnersData {
  serviceProviders: ServiceProvider[];
  capitalProviders: CapitalProvider[];
  empty: boolean;
}

export async function getPartnersData(orgId: string): Promise<PartnersData> {
  const supabase = await createClient();

  const [spResult, cpResult] = await Promise.all([
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
      .order('name')
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

  const empty = serviceProviders.length === 0 && capitalProviders.length === 0;
  return { serviceProviders, capitalProviders, empty };
}
