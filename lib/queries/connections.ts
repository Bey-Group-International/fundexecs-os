import { createClient } from '@/lib/supabase/server';
import type { Database } from '@/lib/supabase/database.types';

type ContactRow = Database['public']['Tables']['contacts']['Row'];
type RelationshipRow = Database['public']['Tables']['relationships']['Row'];

export interface ConnectionRow {
  id: string;
  full_name: string;
  company: string | null;
  title: string | null;
  primary_email: string | null;
  strength: number;
  status: string;
  last_interaction_at: string | null;
  interaction_count: number;
}

export interface WarmIntroRow {
  id: string;
  target: string;
  connector: string;
  strength: number;
  rationale: string | null;
  status: string;
}

export interface ConnectionsData {
  rows: ConnectionRow[];
  intros: WarmIntroRow[];
}

const EMPTY: ConnectionsData = { rows: [], intros: [] };

/**
 * Fetch contacts joined with their relationship (ordered by strength desc)
 * plus suggested warm introductions for the org. RLS-scoped via the server
 * client; query errors degrade to empty arrays so the page never throws.
 */
export async function getConnectionsData(orgId: string): Promise<ConnectionsData> {
  const supabase = await createClient();

  const [relRes, introsRes] = await Promise.all([
    supabase
      .from('relationships')
      .select(
        'id, strength, status, last_interaction_at, interaction_count, contact:contacts(id, full_name, company, title, primary_email)'
      )
      .eq('org_id', orgId)
      .order('strength', { ascending: false }),
    supabase
      .from('warm_introductions')
      .select(
        'id, rationale, status, strength, target:contacts!warm_introductions_target_contact_id_fkey(full_name), connector:contacts!warm_introductions_connector_contact_id_fkey(full_name)'
      )
      .eq('org_id', orgId)
      .order('strength', { ascending: false, nullsFirst: false })
      .limit(10)
  ]);

  type RelJoined = Pick<
    RelationshipRow,
    'id' | 'strength' | 'status' | 'last_interaction_at' | 'interaction_count'
  > & {
    contact: Pick<ContactRow, 'id' | 'full_name' | 'company' | 'title' | 'primary_email'> | null;
  };

  const rows: ConnectionRow[] = ((relRes.data ?? []) as RelJoined[])
    .filter((r) => r.contact)
    .map((r) => ({
      id: r.contact!.id,
      full_name: r.contact!.full_name ?? 'Unknown contact',
      company: r.contact!.company,
      title: r.contact!.title,
      primary_email: r.contact!.primary_email,
      strength: r.strength,
      status: r.status,
      last_interaction_at: r.last_interaction_at,
      interaction_count: r.interaction_count
    }));

  type IntroJoined = {
    id: string;
    rationale: string | null;
    status: string;
    strength: number | null;
    target: { full_name: string | null } | null;
    connector: { full_name: string | null } | null;
  };

  const intros: WarmIntroRow[] = ((introsRes.data ?? []) as unknown as IntroJoined[]).map((i) => ({
    id: i.id,
    target: i.target?.full_name ?? 'Unknown contact',
    connector: i.connector?.full_name ?? 'A connector',
    strength: i.strength ?? 0,
    rationale: i.rationale,
    status: i.status
  }));

  if (rows.length === 0 && intros.length === 0) return EMPTY;

  return { rows, intros };
}
