'use server';

import { createClient } from '@/lib/supabase/server';
import { getActiveOrg } from '@/lib/queries/org';

/**
 * Verify chain — the prototype's button, made real and honest. Records are
 * not cryptographically hashed yet, so this does what CAN be verified
 * today: re-query the ledger server-side and cross-check its continuity —
 * every record's completion in bounds, every proof-layer set complete and
 * in order, no layers orphaned from their record. The copy in the UI
 * claims exactly this and no more.
 */

export type VerifyChainResult =
  | { ok: true; records: number; layers: number; issues: string[] }
  | { ok: false; error: string };

export async function verifyChain(): Promise<VerifyChainResult> {
  const org = await getActiveOrg();
  if (!org) return { ok: false, error: 'No active workspace.' };

  const supabase = await createClient();
  const [{ data: recsRaw }, { data: layersRaw }] = await Promise.all([
    supabase
      .from('chain_of_trust_records')
      .select('id, entity_type, current_layer, completion_percentage, created_at')
      .eq('org_id', org.orgId),
    supabase
      .from('proof_layers')
      .select('id, chain_record_id, layer_order, completion_percentage')
      .eq('org_id', org.orgId)
  ]);

  const records = (recsRaw ?? []) as {
    id: string;
    entity_type: string;
    current_layer: string;
    completion_percentage: number;
    created_at: string;
  }[];
  const layers = (layersRaw ?? []) as {
    id: string;
    chain_record_id: string;
    layer_order: number;
    completion_percentage: number;
  }[];

  const issues: string[] = [];
  const recordIds = new Set(records.map((r) => r.id));

  for (const r of records) {
    const pct = Number(r.completion_percentage);
    if (!Number.isFinite(pct) || pct < 0 || pct > 100) {
      issues.push(`Record ${r.id.slice(0, 8)} has completion out of bounds (${pct}).`);
    }
  }

  // Layer continuity: every record that carries layers must carry the full
  // ordered set of four. Attestation-style records (wires, signatures,
  // diligence findings) carry none — that's expected, not a break.
  const layersByRecord = new Map<string, number[]>();
  for (const l of layers) {
    if (!recordIds.has(l.chain_record_id)) {
      issues.push(`Layer ${l.id.slice(0, 8)} is orphaned from its record.`);
      continue;
    }
    const orders = layersByRecord.get(l.chain_record_id) ?? [];
    orders.push(l.layer_order);
    layersByRecord.set(l.chain_record_id, orders);
    const lpct = Number(l.completion_percentage);
    if (!Number.isFinite(lpct) || lpct < 0 || lpct > 100) {
      issues.push(`Layer ${l.id.slice(0, 8)} has completion out of bounds (${lpct}).`);
    }
  }
  for (const [recordId, orders] of layersByRecord) {
    const sorted = orders.slice().sort((a, b) => a - b);
    if (sorted.length !== 4 || sorted.some((o, i) => o !== i + 1)) {
      issues.push(
        `Record ${recordId.slice(0, 8)} has an incomplete layer set (${sorted.join(', ')}).`
      );
    }
  }

  return { ok: true, records: records.length, layers: layers.length, issues };
}
