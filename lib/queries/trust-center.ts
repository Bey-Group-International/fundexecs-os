import 'server-only';
import { createClient } from '@/lib/supabase/server';
import { getAuthUser } from '@/lib/queries/auth';
import { shortLayerKey, type TrustLayerKey } from '@/lib/queries/trust';

/* ============================================================================
 * Trust Center — org-wide Chain-of-Trust aggregation.
 *
 * This is the intelligence layer behind the standalone /trust surface. Where
 * the dashboard strip shows ONE member's chain, the Trust Center rolls every
 * chain in the org into a single institutional posture and ties it to the
 * capital it secures.
 *
 * The headline number is the Institutional Readiness Index (IRI): a
 * capital-weighted, layer-weighted roll-up. Two ideas make it "intelligent":
 *   1. Later proof layers are worth more — delivered Work and signed-off
 *      Execution are what an institution actually trusts, so they carry more
 *      weight than an unverified Truth claim.
 *   2. Proof is weighted by the capital it sits behind — a fully-proven $50M
 *      deal moves the index far more than a proven $250k one. Posture follows
 *      the money, the way a seasoned allocator's attention does.
 * ========================================================================= */

export type TrustTierKey = 'forming' | 'building' | 'proven' | 'trusted' | 'institutional';

export interface TrustTier {
  key: TrustTierKey;
  label: string;
  /** Lower bound (inclusive) of the IRI band. */
  floor: number;
}

// Tier bands match the ChainOfTrustStrip exactly (25 / 50 / 75 / 100) so the
// org-wide posture and a single member's strip speak the same language — a
// chain reads "Institutional" in both places only when fully proven.
const TIERS: TrustTier[] = [
  { key: 'institutional', label: 'Institutional', floor: 100 },
  { key: 'trusted', label: 'Trusted', floor: 75 },
  { key: 'proven', label: 'Proven', floor: 50 },
  { key: 'building', label: 'Building', floor: 25 },
  { key: 'forming', label: 'Forming', floor: 0 }
];

export function tierForScore(score: number): TrustTier {
  return TIERS.find((t) => score >= t.floor) ?? TIERS[TIERS.length - 1];
}

/**
 * Per-layer weights. Truth is the price of entry; Execution and delivered Work
 * are what counterparties underwrite. Weighting them higher means the index
 * rewards proof that has actually been done and signed off, not just asserted.
 */
const LAYER_WEIGHT: Record<TrustLayerKey, number> = {
  truth: 1.0,
  concept: 1.3,
  execution: 1.6,
  work: 2.0
};
const LAYER_KEYS: TrustLayerKey[] = ['truth', 'concept', 'execution', 'work'];

/** Capital floor so non-deal chains (profiles, objectives, the org) still count. */
const CAPITAL_FLOOR = 250_000;
/** Evidence sitting in the approval queue longer than this is "stale". */
const STALE_APPROVAL_DAYS = 7;

export interface TrustRecordSummary {
  id: string;
  title: string;
  entityType: string;
  entityId: string;
  /** Capital-weighted, layer-weighted completion for this record (0–100). */
  score: number;
  tier: TrustTier;
  currentLayer: string;
  currentLayerKey: TrustLayerKey;
  /** Per-layer completion %, ordered truth→work. */
  layers: Record<TrustLayerKey, number>;
  /** Capital this chain secures (deal amount, or the floor for non-deal chains). */
  capitalAtStake: number;
  approvedEvidence: number;
  pendingEvidence: number;
  status: string;
  createdAt: string;
}

export interface ApprovalQueueItem {
  evidenceId: string;
  fileName: string;
  recordId: string;
  recordTitle: string;
  layerName: string;
  layerKey: TrustLayerKey;
  uploadedAt: string | null;
  uploaderName: string | null;
  aiValidated: boolean;
  aiValidationNotes: string | null;
  /** Capital gated behind the chain this evidence belongs to. */
  capitalAtStake: number;
  stale: boolean;
}

export interface ChecklistItem {
  key: string;
  label: string;
  met: boolean;
  detail: string;
}

export interface NextAction {
  key: string;
  kind: 'advance' | 'approve' | 'cover' | 'maintain';
  title: string;
  detail: string;
  /** Estimated capital influenced by closing this action. Drives ranking. */
  capitalImpact: number;
  recordId?: string;
}

export interface CapitalPosture {
  pipelineValue: number;
  capitalDeployed: number;
  /** Active deal value sitting behind a Proven-or-better chain. */
  capitalUnderProof: number;
  /** Active deal value with no chain, or a chain below Proven. */
  capitalExposed: number;
  /** capitalUnderProof / pipelineValue, 0–100. */
  proofCoveragePct: number;
  activeDeals: number;
  coveredDeals: number;
}

export interface TrustCenterData {
  empty: boolean;
  /** Institutional Readiness Index — capital-weighted org posture, 0–100. */
  iri: number;
  /** Unweighted mean of record scores, shown alongside the IRI for transparency. */
  simpleMean: number;
  tier: TrustTier;
  /** Org-wide mean completion per layer, truth→work. */
  layerRollup: Record<TrustLayerKey, number>;
  records: TrustRecordSummary[];
  approvals: ApprovalQueueItem[];
  checklist: ChecklistItem[];
  nextActions: NextAction[];
  capital: CapitalPosture;
  recordCount: number;
  pendingCount: number;
  viewer: { id: string; canApprove: boolean };
  generatedAt: string;
}

const EMPTY_LAYERS: Record<TrustLayerKey, number> = { truth: 0, concept: 0, execution: 0, work: 0 };

function emptyData(viewerId: string, canApprove: boolean): TrustCenterData {
  return {
    empty: true,
    iri: 0,
    simpleMean: 0,
    tier: tierForScore(0),
    layerRollup: { ...EMPTY_LAYERS },
    records: [],
    approvals: [],
    checklist: [],
    nextActions: [],
    capital: {
      pipelineValue: 0,
      capitalDeployed: 0,
      capitalUnderProof: 0,
      capitalExposed: 0,
      proofCoveragePct: 0,
      activeDeals: 0,
      coveredDeals: 0
    },
    recordCount: 0,
    pendingCount: 0,
    viewer: { id: viewerId, canApprove },
    generatedAt: new Date().toISOString()
  };
}

/** Layer-weighted completion for one record's four layers (0–100). */
function weightedRecordScore(layers: Record<TrustLayerKey, number>): number {
  let num = 0;
  let den = 0;
  for (const k of LAYER_KEYS) {
    num += layers[k] * LAYER_WEIGHT[k];
    den += 100 * LAYER_WEIGHT[k];
  }
  return den > 0 ? Math.round((num / den) * 100) : 0;
}

/**
 * Load the full Trust Center payload for an org. Every read is RLS-bound; a
 * failure on any non-critical slice degrades to an empty section rather than
 * throwing the whole surface.
 */
export async function getTrustCenterData(orgId: string): Promise<TrustCenterData> {
  const supabase = await createClient();
  const user = await getAuthUser();
  const viewerId = user?.id ?? '';

  // Viewer approval permission (owner/admin gates the governance queue).
  let canApprove = false;
  if (user) {
    const { data: actor } = await supabase
      .from('org_members')
      .select('role, status')
      .eq('org_id', orgId)
      .eq('user_id', user.id)
      .maybeSingle();
    const a = actor as { role: string; status: string } | null;
    canApprove = !!a && a.status === 'active' && (a.role === 'owner' || a.role === 'admin');
  }

  // Records + deals/allocations in parallel — the two halves of the join
  // between proof posture and strategic capital.
  const [{ data: recsRaw }, { data: dealsRaw }, { data: allocRaw }] = await Promise.all([
    supabase
      .from('chain_of_trust_records')
      .select('id, entity_type, entity_id, current_layer, status, created_at')
      .eq('org_id', orgId),
    supabase.from('deals').select('id, name, amount, status').eq('org_id', orgId),
    supabase.from('allocations').select('amount, status').eq('org_id', orgId)
  ]);

  const records = (recsRaw ?? []) as {
    id: string;
    entity_type: string;
    entity_id: string;
    current_layer: string;
    status: string;
    created_at: string;
  }[];
  const deals = (dealsRaw ?? []) as {
    id: string;
    name: string;
    amount: number | null;
    status: string;
  }[];
  const allocs = (allocRaw ?? []) as { amount: number | null; status: string }[];

  // Only short-circuit to the empty state when there's nothing at all. An org
  // with active deals but no chains yet should still see its capital posture
  // (exposed capital + a "start a Chain of Trust" action), so we fall through
  // and merely skip the proof_layers / evidence lookups when records is empty.
  if (records.length === 0 && deals.length === 0) {
    return { ...emptyData(viewerId, canApprove), empty: true };
  }

  const recordIds = records.map((r) => r.id);
  const dealById = new Map(deals.map((d) => [d.id, d]));

  // Layers for every record. (Event history is owned by the Audit Trail at
  // /audit — the Trust Center deliberately does not re-render that log.)
  // Skip the lookup for a deals-only org (no records → nothing to fetch).
  const layersRaw = recordIds.length
    ? (
        await supabase
          .from('proof_layers')
          .select(
            'id, chain_record_id, layer_name, layer_order, human_approval_status, completion_percentage'
          )
          .in('chain_record_id', recordIds)
      ).data
    : [];

  const layers = (layersRaw ?? []) as {
    id: string;
    chain_record_id: string;
    layer_name: string;
    layer_order: number;
    human_approval_status: string;
    completion_percentage: number;
  }[];
  const layerIds = layers.map((l) => l.id);
  const layerById = new Map(layers.map((l) => [l.id, l]));

  // Evidence keyed by layer (the placeholder query above can't see layerIds, so
  // run the real one now that we have them).
  let evidence: {
    id: string;
    proof_layer_id: string;
    file_name: string | null;
    approval_status: string;
    uploaded_at: string | null;
    uploaded_by: string | null;
    ai_validated_at: string | null;
    ai_validation_notes: string | null;
  }[] = [];
  if (layerIds.length > 0) {
    const { data } = await supabase
      .from('evidence')
      .select(
        'id, proof_layer_id, file_name, approval_status, uploaded_at, uploaded_by, ai_validated_at, ai_validation_notes'
      )
      .in('proof_layer_id', layerIds);
    evidence = (data ?? []) as typeof evidence;
  }

  // Group layers by record.
  const layersByRecord = new Map<string, typeof layers>();
  for (const l of layers) {
    if (!layersByRecord.has(l.chain_record_id)) layersByRecord.set(l.chain_record_id, []);
    layersByRecord.get(l.chain_record_id)!.push(l);
  }

  // Evidence counts per record + pending queue rows.
  const approvedByRecord = new Map<string, number>();
  const pendingByRecord = new Map<string, number>();
  const pendingEvidence: typeof evidence = [];
  for (const e of evidence) {
    const layer = layerById.get(e.proof_layer_id);
    if (!layer) continue;
    const rid = layer.chain_record_id;
    if (e.approval_status === 'approved') {
      approvedByRecord.set(rid, (approvedByRecord.get(rid) ?? 0) + 1);
    } else if (e.approval_status === 'pending') {
      pendingByRecord.set(rid, (pendingByRecord.get(rid) ?? 0) + 1);
      pendingEvidence.push(e);
    }
  }

  // Resolve a human-readable title + capital-at-stake per record.
  function titleFor(rec: (typeof records)[number]): string {
    if (rec.entity_type === 'deal') {
      return dealById.get(rec.entity_id)?.name ?? `Deal · ${rec.entity_id.slice(0, 8)}`;
    }
    if (rec.entity_type === 'member_profile') return 'Member Proof of Truth';
    if (rec.entity_type === 'objective') return `Objective · ${rec.entity_id.slice(0, 8)}`;
    if (rec.entity_type === 'org') return 'Organization chain';
    return `${rec.entity_type} · ${rec.entity_id.slice(0, 8)}`;
  }
  function capitalFor(rec: (typeof records)[number]): number {
    if (rec.entity_type === 'deal') {
      // Use the deal's real amount — the floor is reserved for non-deal chains
      // so a small deal isn't ranked/weighted as if it were CAPITAL_FLOOR.
      return dealById.get(rec.entity_id)?.amount ?? 0;
    }
    return CAPITAL_FLOOR;
  }

  // Build record summaries.
  const summaries: TrustRecordSummary[] = records.map((rec) => {
    const recLayers = layersByRecord.get(rec.id) ?? [];
    const layerPct: Record<TrustLayerKey, number> = { ...EMPTY_LAYERS };
    for (const l of recLayers) {
      const key = shortLayerKey(l.layer_name);
      layerPct[key] = Math.max(0, Math.min(100, Math.round(Number(l.completion_percentage ?? 0))));
    }
    const score = weightedRecordScore(layerPct);
    return {
      id: rec.id,
      title: titleFor(rec),
      entityType: rec.entity_type,
      entityId: rec.entity_id,
      score,
      tier: tierForScore(score),
      currentLayer: rec.current_layer,
      currentLayerKey: shortLayerKey(rec.current_layer),
      layers: layerPct,
      capitalAtStake: capitalFor(rec),
      approvedEvidence: approvedByRecord.get(rec.id) ?? 0,
      pendingEvidence: pendingByRecord.get(rec.id) ?? 0,
      status: rec.status,
      createdAt: rec.created_at
    };
  });
  summaries.sort((a, b) => b.capitalAtStake - a.capitalAtStake || b.score - a.score);

  // ---- Institutional Readiness Index: capital-weighted posture. ----
  let weightedNum = 0;
  let weightedDen = 0;
  for (const s of summaries) {
    weightedNum += s.score * s.capitalAtStake;
    weightedDen += s.capitalAtStake;
  }
  const iri = weightedDen > 0 ? Math.round(weightedNum / weightedDen) : 0;
  const simpleMean =
    summaries.length > 0
      ? Math.round(summaries.reduce((sum, s) => sum + s.score, 0) / summaries.length)
      : 0;

  // ---- Per-layer org rollup. ----
  const layerRollup: Record<TrustLayerKey, number> = { ...EMPTY_LAYERS };
  for (const k of LAYER_KEYS) {
    const vals = summaries.map((s) => s.layers[k]);
    layerRollup[k] = vals.length
      ? Math.round(vals.reduce((sum, v) => sum + v, 0) / vals.length)
      : 0;
  }

  // ---- Strategic capital posture. ----
  const activeDeals = deals.filter(
    (d) => d.status !== 'won' && d.status !== 'lost' && d.status !== 'passed'
  );
  const dealRecordByDealId = new Map(
    summaries.filter((s) => s.entityType === 'deal').map((s) => [s.entityId, s])
  );
  let capitalUnderProof = 0;
  let capitalExposed = 0;
  let coveredDeals = 0;
  for (const d of activeDeals) {
    const amount = d.amount ?? 0;
    const rec = dealRecordByDealId.get(d.id);
    if (rec && rec.score >= 50) {
      capitalUnderProof += amount;
      coveredDeals += 1;
    } else {
      capitalExposed += amount;
    }
  }
  const pipelineValue = activeDeals.reduce((s, d) => s + (d.amount ?? 0), 0);
  const capitalDeployed = allocs
    .filter((a) => a.status === 'accepted' || a.status === 'funded')
    .reduce((s, a) => s + (a.amount ?? 0), 0);
  const capital: CapitalPosture = {
    pipelineValue,
    capitalDeployed,
    capitalUnderProof,
    capitalExposed,
    proofCoveragePct: pipelineValue > 0 ? Math.round((capitalUnderProof / pipelineValue) * 100) : 0,
    activeDeals: activeDeals.length,
    coveredDeals
  };

  // ---- Approval queue (pending evidence, capital-ranked). ----
  const layerRecordTitle = new Map(summaries.map((s) => [s.id, s]));
  const uploaderIds = Array.from(
    new Set(pendingEvidence.map((e) => e.uploaded_by).filter((id): id is string => !!id))
  );
  const nameMap = new Map<string, string>();
  if (uploaderIds.length > 0) {
    const { data: ppl } = await supabase
      .from('profiles')
      .select('id, full_name')
      .in('id', uploaderIds);
    for (const p of (ppl ?? []) as { id: string; full_name: string | null }[]) {
      nameMap.set(p.id, p.full_name ?? 'Member');
    }
  }

  const now = Date.now();
  const approvals: ApprovalQueueItem[] = pendingEvidence
    .map((e) => {
      const layer = layerById.get(e.proof_layer_id)!;
      const rec = layerRecordTitle.get(layer.chain_record_id);
      const uploadedMs = e.uploaded_at ? new Date(e.uploaded_at).getTime() : now;
      const stale = now - uploadedMs > STALE_APPROVAL_DAYS * 86400_000;
      return {
        evidenceId: e.id,
        fileName: e.file_name ?? 'Evidence file',
        recordId: layer.chain_record_id,
        recordTitle: rec?.title ?? 'Chain of Trust',
        layerName: layer.layer_name,
        layerKey: shortLayerKey(layer.layer_name),
        uploadedAt: e.uploaded_at,
        uploaderName: e.uploaded_by ? (nameMap.get(e.uploaded_by) ?? null) : null,
        aiValidated: !!e.ai_validated_at,
        aiValidationNotes: e.ai_validation_notes,
        capitalAtStake: rec?.capitalAtStake ?? CAPITAL_FLOOR,
        stale
      };
    })
    .sort((a, b) => b.capitalAtStake - a.capitalAtStake);

  // ---- Institutional readiness checklist. ----
  const uncoveredActiveDeals = activeDeals.filter((d) => !dealRecordByDealId.has(d.id));
  const startedExecution = layers.filter(
    (l) => shortLayerKey(l.layer_name) === 'execution' && Number(l.completion_percentage) > 0
  );
  const execSignedOff = startedExecution.filter((l) => l.human_approval_status === 'approved');
  const workEvidence = evidence.filter((e) => {
    const layer = layerById.get(e.proof_layer_id);
    return layer && shortLayerKey(layer.layer_name) === 'work';
  });
  const workValidated = workEvidence.filter((e) => !!e.ai_validated_at);
  const staleApprovals = approvals.filter((a) => a.stale);
  const institutionalRecords = summaries.filter((s) => s.tier.key === 'institutional');

  const checklist: ChecklistItem[] = [
    {
      key: 'coverage',
      label: 'Every active deal carries a Chain of Trust',
      met: uncoveredActiveDeals.length === 0 && activeDeals.length > 0,
      detail:
        activeDeals.length === 0
          ? 'No active deals to cover yet.'
          : uncoveredActiveDeals.length === 0
            ? `All ${activeDeals.length} active deals are on the record.`
            : `${uncoveredActiveDeals.length} of ${activeDeals.length} active deals have no chain.`
    },
    {
      key: 'signoff',
      label: 'Execution proof is human-approved, not just asserted',
      met: startedExecution.length > 0 && execSignedOff.length === startedExecution.length,
      detail:
        startedExecution.length === 0
          ? 'No Execution layers in progress yet.'
          : `${execSignedOff.length} of ${startedExecution.length} Execution layers signed off.`
    },
    {
      key: 'freshness',
      label: 'No evidence waiting on approval beyond a week',
      met: staleApprovals.length === 0,
      detail:
        staleApprovals.length === 0
          ? 'Approval queue is current.'
          : `${staleApprovals.length} item(s) stale (> ${STALE_APPROVAL_DAYS} days).`
    },
    {
      key: 'validation',
      label: 'Delivered Work is AI-validated',
      met: workEvidence.length > 0 && workValidated.length === workEvidence.length,
      detail:
        workEvidence.length === 0
          ? 'No Work evidence uploaded yet.'
          : `${workValidated.length} of ${workEvidence.length} Work files validated.`
    },
    {
      key: 'depth',
      label: 'At least one chain reaches Institutional grade',
      met: institutionalRecords.length > 0,
      detail:
        institutionalRecords.length > 0
          ? `${institutionalRecords.length} chain(s) at Institutional tier.`
          : 'No chain has cleared all four layers yet.'
    }
  ];

  // ---- Next-best actions, ranked by capital leverage. ----
  const nextActions: NextAction[] = [];

  // Advance the highest-leverage incomplete chain.
  const advanceCandidates = summaries
    .filter((s) => s.score < 100)
    .map((s) => ({ s, leverage: (s.capitalAtStake * (100 - s.score)) / 100 }))
    .sort((a, b) => b.leverage - a.leverage);
  if (advanceCandidates[0]) {
    const { s } = advanceCandidates[0];
    nextActions.push({
      key: `advance-${s.id}`,
      kind: 'advance',
      title: `Advance ${s.currentLayer} on ${s.title}`,
      detail: `At ${s.score}% with ${fmtMoney(s.capitalAtStake)} at stake — the single highest-leverage proof to close.`,
      capitalImpact: Math.round(advanceCandidates[0].leverage),
      recordId: s.id
    });
  }

  // Clear the approval queue.
  if (approvals.length > 0) {
    // Capital-at-stake is per chain, so dedupe by record before summing —
    // two pending files on the same chain must not double-count the capital.
    const gated = Array.from(
      new Map(approvals.map((a) => [a.recordId, a.capitalAtStake])).values()
    ).reduce((sum, capital) => sum + capital, 0);
    nextActions.push({
      key: 'approve-queue',
      kind: 'approve',
      title: `Sign off ${approvals.length} item${approvals.length === 1 ? '' : 's'} awaiting approval`,
      detail: `${fmtMoney(gated)} of proof is gated behind your review${
        staleApprovals.length ? `, ${staleApprovals.length} already stale` : ''
      }.`,
      capitalImpact: gated
    });
  }

  // Cover the biggest unproven deal.
  const topUncovered = uncoveredActiveDeals
    .slice()
    .sort((a, b) => (b.amount ?? 0) - (a.amount ?? 0))[0];
  if (topUncovered) {
    nextActions.push({
      key: `cover-${topUncovered.id}`,
      kind: 'cover',
      title: `Start a Chain of Trust on ${topUncovered.name}`,
      detail: `${fmtMoney(topUncovered.amount ?? 0)} of active pipeline is carrying no proof at all.`,
      capitalImpact: topUncovered.amount ?? 0
    });
  }

  // Maintain posture when everything's clean.
  if (nextActions.length === 0) {
    nextActions.push({
      key: 'maintain',
      kind: 'maintain',
      title: 'Posture is institutional — keep evidence current',
      detail: 'Every chain is proven and the queue is clear. Refresh evidence as deals progress.',
      capitalImpact: 0
    });
  }
  nextActions.sort((a, b) => b.capitalImpact - a.capitalImpact);

  const pendingCount = approvals.length;

  return {
    empty: false,
    iri,
    simpleMean,
    tier: tierForScore(iri),
    layerRollup,
    records: summaries,
    approvals,
    checklist,
    nextActions: nextActions.slice(0, 4),
    capital,
    recordCount: summaries.length,
    pendingCount,
    viewer: { id: viewerId, canApprove },
    generatedAt: new Date().toISOString()
  };
}

/** Compact money formatter shared with the view (server-computed strings). */
function fmtMoney(n: number): string {
  if (!Number.isFinite(n) || n === 0) return '$0';
  const abs = Math.abs(n);
  if (abs >= 1_000_000_000) return `$${(n / 1_000_000_000).toFixed(1)}B`;
  if (abs >= 1_000_000) return `$${(n / 1_000_000).toFixed(1)}M`;
  if (abs >= 1_000) return `$${Math.round(n / 1_000)}K`;
  return `$${Math.round(n)}`;
}
