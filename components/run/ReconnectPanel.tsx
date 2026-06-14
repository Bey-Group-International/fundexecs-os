import { HeartHandshake, Clock } from 'lucide-react';
import type { ReconnectBand } from '@/lib/intelligence/reconnect';
import type { ReconnectList } from '@/lib/queries/reconnect';

/* The Relationship Reconnect Engine panel: durable relationships going cold,
 * ranked by depth × staleness, so a warm contact never quietly lapses. Pure
 * read, key-free — computed from the relationship graph. */

const BAND_TONE: Record<ReconnectBand, string> = {
  Overdue: 'border-[var(--danger-line)] bg-[var(--danger-soft)] text-danger',
  'Due soon': 'border-[var(--warning-line)] bg-[var(--warning-soft)] text-warning',
  Healthy: 'border-hairline bg-surface-2 text-fg-3'
};

export function ReconnectPanel({ data }: { data: ReconnectList }) {
  if (data.items.length === 0) return null;

  return (
    <section className="mb-4 rounded-[14px] border border-hairline bg-surface-1 p-4">
      <header className="flex items-center justify-between gap-3">
        <div className="flex items-center gap-2">
          <HeartHandshake size={17} className="text-accent" aria-hidden />
          <h2 className="text-[14.5px] font-semibold text-fg-1">Reconnect engine</h2>
        </div>
        <div className="flex items-center gap-2 text-[11.5px]">
          {data.overdueCount > 0 && (
            <span className="rounded-full border border-[var(--danger-line)] bg-[var(--danger-soft)] px-2 py-0.5 font-medium text-danger">
              {data.overdueCount} overdue
            </span>
          )}
          {data.dueSoonCount > 0 && (
            <span className="rounded-full border border-[var(--warning-line)] bg-[var(--warning-soft)] px-2 py-0.5 font-medium text-warning">
              {data.dueSoonCount} due soon
            </span>
          )}
        </div>
      </header>

      <p className="mt-1 text-[12.5px] text-fg-3">
        Durable relationships going cold — ranked by how deep they run and how long since your last
        touch, so you reconnect before they decay.
      </p>

      <ul className="mt-3 space-y-1.5">
        {data.items.map((r) => (
          <li
            key={r.id}
            className="flex items-center gap-3 rounded-[10px] border border-hairline bg-bg-1 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="truncate text-[13px] font-medium text-fg-1">
                {r.fullName}
                {r.company ? <span className="text-fg-4"> · {r.company}</span> : null}
              </div>
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
