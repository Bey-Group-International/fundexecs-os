import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';

/* ============================================================================
 * lib/queries/raise-leads.ts — the org's inbound raise leads & reservations.
 *
 * Authed read under RLS ("owners read raise interests"), so only an org
 * owner/admin sees their workspace's leads. Powers the Reservations &
 * verification inbox on the Capital Stack screen, where owners review
 * accredited-investor verification for 506(c) reservations.
 * ========================================================================= */

export type VerificationStatus = 'unverified' | 'pending' | 'verified' | 'rejected';

export interface RaiseLead {
  id: string;
  name: string;
  email: string;
  /** 'interest' | 'reserved'. */
  kind: string;
  note: string | null;
  indicativeAmount: number | null;
  reservationAmount: number | null;
  reservationStatus: string;
  verificationStatus: VerificationStatus;
  verificationMethod: string | null;
  verificationEvidence: string | null;
  reviewerNote: string | null;
  verifiedAt: string | null;
  verificationDocumentPath: string | null;
  verificationProvider: string | null;
  verificationProviderStatus: string | null;
  verificationProviderUrl: string | null;
  createdAt: string;
}

export interface RaiseLeadsData {
  leads: RaiseLead[];
  counts: { total: number; reserved: number; pendingVerification: number; verified: number };
}

function vStatus(value: string | null): VerificationStatus {
  return value === 'pending' || value === 'verified' || value === 'rejected' ? value : 'unverified';
}

/** Inbound leads + reservations for the active org, newest first. */
export async function getRaiseLeads(): Promise<RaiseLeadsData> {
  const empty: RaiseLeadsData = {
    leads: [],
    counts: { total: 0, reserved: 0, pendingVerification: 0, verified: 0 }
  };

  const org = await getActiveOrg().catch(() => null);
  if (!org) return empty;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from('raise_interests')
    .select('*')
    .eq('org_id', org.orgId)
    .order('created_at', { ascending: false })
    .limit(500);

  if (error) throw new Error(`Failed to load raise leads: ${error.message}`);

  const leads: RaiseLead[] = (data ?? []).map((r) => ({
    id: r.id,
    name: r.name,
    email: r.email,
    kind: r.kind,
    note: r.note,
    indicativeAmount: r.indicative_amount != null ? Number(r.indicative_amount) : null,
    reservationAmount: r.reservation_amount != null ? Number(r.reservation_amount) : null,
    reservationStatus: r.reservation_status,
    verificationStatus: vStatus(r.verification_status),
    verificationMethod: r.verification_method,
    verificationEvidence: r.verification_evidence,
    reviewerNote: r.reviewer_note,
    verifiedAt: r.verified_at,
    verificationDocumentPath: r.verification_document_path ?? null,
    verificationProvider: r.verification_provider ?? null,
    verificationProviderStatus: r.verification_provider_status ?? null,
    verificationProviderUrl: r.verification_provider_url ?? null,
    createdAt: r.created_at
  }));

  return {
    leads,
    counts: {
      total: leads.length,
      reserved: leads.filter((l) => l.kind === 'reserved').length,
      pendingVerification: leads.filter((l) => l.verificationStatus === 'pending').length,
      verified: leads.filter((l) => l.verificationStatus === 'verified').length
    }
  };
}
