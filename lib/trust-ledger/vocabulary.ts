/**
 * lib/trust-ledger/vocabulary.ts — the Chain of Trust ledger's pure
 * vocabulary: the prototype's four proof layers (COT_LAYERS), per-layer
 * counting and filtering, block numbering, the record's real id rendered
 * where the prototype showed a hash, source-surface deep links, and the
 * CSV export builder. Pure so the page, the export route and the verify
 * action can never disagree on what the ledger says.
 */

export type LedgerLayerKey = 'truth' | 'concept' | 'execution' | 'work';

export interface LedgerLayerMeta {
  key: LedgerLayerKey;
  name: string;
  desc: string;
  /** Badge tone token — matches the prototype's COT_LAYERS tones. */
  tone: 'azure' | 'info' | 'warning' | 'success';
}

/** The prototype's COT_LAYERS, in proof order. */
export const LEDGER_LAYERS: readonly LedgerLayerMeta[] = [
  { key: 'truth', name: 'Proof of Truth', desc: 'Verified identity & source data', tone: 'azure' },
  { key: 'concept', name: 'Proof of Concept', desc: 'Thesis, terms & decisions', tone: 'info' },
  {
    key: 'execution',
    name: 'Proof of Execution',
    desc: 'Signatures, filings & wires',
    tone: 'warning'
  },
  { key: 'work', name: 'Proof of Work', desc: 'Operating actions & outcomes', tone: 'success' }
];

export function ledgerLayerMeta(key: string): LedgerLayerMeta {
  return LEDGER_LAYERS.find((l) => l.key === key) ?? LEDGER_LAYERS[0];
}

export type LedgerFilter = LedgerLayerKey | 'all';

export interface LedgerRecordLike {
  currentLayerKey: LedgerLayerKey;
}

/** Records per layer — the counts on the prototype's layer strip. */
export function countByLayer(records: readonly LedgerRecordLike[]): Record<LedgerLayerKey, number> {
  const counts: Record<LedgerLayerKey, number> = { truth: 0, concept: 0, execution: 0, work: 0 };
  for (const r of records) {
    if (r.currentLayerKey in counts) counts[r.currentLayerKey] += 1;
  }
  return counts;
}

export function filterByLayer<T extends LedgerRecordLike>(
  records: readonly T[],
  filter: LedgerFilter
): T[] {
  return filter === 'all' ? [...records] : records.filter((r) => r.currentLayerKey === filter);
}

/**
 * Block number — oldest record is block 0001, matching the prototype's
 * drawer meta. `indexNewestFirst` is the row's position in a newest-first
 * ledger of `total` records.
 */
export function blockNumber(indexNewestFirst: number, total: number): string {
  const n = Math.max(0, total - indexNewestFirst);
  return String(n).padStart(4, '0');
}

/**
 * The prototype showed a truncated hash; real records aren't hashed yet,
 * so render the record's REAL id the same way — first and last four hex
 * characters of the uuid.
 */
export function shortRecordId(id: string): string {
  const hex = id.replace(/-/g, '');
  if (hex.length < 8) return id;
  return `${hex.slice(0, 4)}…${hex.slice(-4)}`;
}

/** Where a ledger record came from, and where to see the real thing. */
export interface LedgerSource {
  label: string;
  href: string | null;
}

const SOURCES: Record<string, LedgerSource> = {
  deal: { label: 'Deal pipeline', href: '/source/pipeline' },
  diligence_finding: { label: 'Diligence', href: '/run/diligence' },
  formation_step: { label: 'Formation', href: '/build/formation' },
  signature: { label: 'Signatures & wires', href: '/execute/wires' },
  wire: { label: 'Signatures & wires', href: '/execute/wires' },
  closing: { label: 'Closings', href: '/execute/closings' },
  capital_call: { label: 'Capital calls', href: '/execute/capital' },
  member_profile: { label: 'Member profile', href: '/settings' },
  objective: { label: 'Objectives', href: null },
  org: { label: 'Organization', href: null }
};

export function ledgerSource(entityType: string): LedgerSource {
  return SOURCES[entityType] ?? { label: entityType.replace(/[_-]+/g, ' '), href: null };
}

/* ── Export ───────────────────────────────────────────────────────────── */

export interface LedgerExportRow {
  id: string;
  title: string;
  entityType: string;
  entityId: string;
  currentLayer: string;
  completion: number;
  status: string;
  createdAt: string;
}

function csvCell(value: string | number): string {
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/** The Export-ledger payload — one CSV row per chain record, oldest first. */
export function ledgerToCsv(rows: readonly LedgerExportRow[]): string {
  const header = [
    'block',
    'record_id',
    'title',
    'entity_type',
    'entity_id',
    'current_layer',
    'completion_pct',
    'status',
    'created_at'
  ].join(',');
  const sorted = rows
    .slice()
    .sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const lines = sorted.map((r, i) =>
    [
      String(i + 1).padStart(4, '0'),
      r.id,
      csvCell(r.title),
      csvCell(r.entityType),
      r.entityId,
      csvCell(r.currentLayer),
      r.completion,
      csvCell(r.status),
      r.createdAt
    ].join(',')
  );
  return [header, ...lines].join('\n') + '\n';
}
