import { Boxes, Database, Inbox, ShieldCheck } from 'lucide-react';
import type { AdminMetrics, TrustLayerKey } from '@/lib/queries/admin-metrics';

const TRUST_LAYERS: TrustLayerKey[] = ['truth', 'concept', 'execution', 'work'];

/** Average Chain-of-Trust coverage across the four layers, rounded to a percent. */
function avgTrust(coverage: AdminMetrics['trust']['layerCoverage']): number {
  const sum = TRUST_LAYERS.reduce((acc, k) => acc + coverage[k], 0);
  return Math.round(sum / TRUST_LAYERS.length);
}

const VECTOR_LABEL: Record<AdminMetrics['vector']['status'], string> = {
  live: 'Live',
  degraded: 'Degraded',
  unknown: 'Unknown'
};

/**
 * Platform health strip for the admin portal — real metrics from
 * `getAdminMetrics` (brains/embeddings, pgvector store, knowledge intake, Chain
 * of Trust coverage). When the loader degrades to placeholders it labels the
 * strip "reference" rather than presenting fabricated numbers as live.
 */
export function MetricsStrip({ metrics }: { metrics: AdminMetrics }) {
  const tiles = [
    {
      icon: Boxes,
      label: 'AI brains embedded',
      value: `${metrics.brains.embedded} / ${metrics.brains.total}`
    },
    {
      icon: Database,
      label: 'Knowledge vector store',
      value: `${VECTOR_LABEL[metrics.vector.status]} · ${metrics.vector.chunks.toLocaleString()}`
    },
    {
      icon: Inbox,
      label: 'Intake processed',
      value: `${metrics.intake.processed} / ${metrics.intake.queued + metrics.intake.processed}`
    },
    {
      icon: ShieldCheck,
      label: 'Chain-of-Trust coverage',
      value: `${avgTrust(metrics.trust.layerCoverage)}%`
    }
  ];

  return (
    <section className="mb-8">
      <div className="mb-3 flex items-center gap-2">
        <h2 className="text-[13px] font-semibold tracking-tight text-fg-2">Platform health</h2>
        {metrics.placeholder && (
          <span className="rounded-md border border-hairline bg-surface-2 px-1.5 py-0.5 text-[10.5px] uppercase tracking-[0.08em] text-fg-5">
            Reference
          </span>
        )}
      </div>
      <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
        {tiles.map(({ icon: Icon, label, value }) => (
          <div key={label} className="rounded-2xl border border-hairline bg-bg-1 p-4">
            <div className="flex h-8 w-8 items-center justify-center rounded-lg border border-hairline bg-surface-2 text-fg-3">
              <Icon size={15} aria-hidden />
            </div>
            <p className="mt-3 text-[18px] font-semibold tracking-tight text-fg-1">{value}</p>
            <p className="mt-0.5 text-[11.5px] text-fg-4">{label}</p>
          </div>
        ))}
      </div>
    </section>
  );
}
