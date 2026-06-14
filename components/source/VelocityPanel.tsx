import { TimerReset, Clock } from 'lucide-react';
import type { VelocityBand } from '@/lib/intelligence/velocity';
import type { PipelineVelocity } from '@/lib/queries/velocity';

/* Pipeline Velocity panel: live deals that have stalled in their current stage,
 * ranked by time-in-stage. Pure read, key-free — from the deal's own loop-event
 * history. Renders nothing when the pipeline is moving. */

const BAND_TONE: Record<VelocityBand, string> = {
  Stuck: 'border-[var(--danger-line)] bg-[var(--danger-soft)] text-danger',
  Slowing: 'border-[var(--warning-line)] bg-[var(--warning-soft)] text-warning',
  Moving: 'border-hairline bg-surface-2 text-fg-3'
};

export function VelocityPanel({ data }: { data: PipelineVelocity }) {
  if (data.items.length === 0) return null;

  return (
    <section className="mb-4 rounded-[14px] border border-hairline bg-surface-1 p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <TimerReset size={17} className="text-accent" aria-hidden />
          <h2 className="text-[14.5px] font-semibold text-fg-1">Pipeline velocity</h2>
        </div>
        <div className="flex items-center gap-2 text-[11.5px]">
          {data.stuckCount > 0 && (
            <span className="rounded-full border border-[var(--danger-line)] bg-[var(--danger-soft)] px-2 py-0.5 font-medium text-danger">
              {data.stuckCount} stuck
            </span>
          )}
          {data.slowingCount > 0 && (
            <span className="rounded-full border border-[var(--warning-line)] bg-[var(--warning-soft)] px-2 py-0.5 font-medium text-warning">
              {data.slowingCount} slowing
            </span>
          )}
        </div>
      </header>

      <p className="mt-1 text-[12.5px] text-fg-3">
        Live deals that have stalled in their current stage — ranked by how long since they last
        moved, so nothing parks unnoticed.
      </p>

      <ul className="mt-3 space-y-1.5">
        {data.items.map((r) => (
          <li
            key={r.dealId}
            className="flex items-center gap-3 rounded-[10px] border border-hairline bg-bg-1 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-fg-1">{r.dealName}</div>
              <div className="flex items-center gap-1 truncate text-[11.5px] text-fg-4">
                <Clock size={12} className="flex-none" aria-hidden />
                {r.reason}
              </div>
            </div>
            <span
              className={`flex-none rounded-full border px-2 py-0.5 text-[10.5px] font-semibold ${BAND_TONE[r.band]}`}
            >
              {r.band}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
