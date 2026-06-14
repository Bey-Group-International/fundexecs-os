import { Route, ArrowRight } from 'lucide-react';
import type { IntroPath } from '@/lib/intelligence/warm-intro';

/* Warm-Intro Pathfinder panel: the warmest relationship path into each live
 * deal. Pure read, key-free — derived from the desk's own relationship graph
 * matched to deal companies. Renders nothing when no path exists. */

function warmthTone(warmth: number): string {
  if (warmth >= 70) return 'border-[var(--gold-line)] bg-[var(--gold-soft)] text-gold-1';
  if (warmth >= 45) return 'border-hairline bg-surface-2 text-fg-2';
  return 'border-hairline bg-surface-2 text-fg-4';
}

export function WarmIntroPanel({ paths }: { paths: IntroPath[] }) {
  if (paths.length === 0) return null;

  return (
    <section className="mb-4 rounded-[14px] border border-hairline bg-surface-1 p-4">
      <header className="flex items-center gap-2">
        <Route size={17} className="text-accent" aria-hidden />
        <h2 className="text-[14.5px] font-semibold text-fg-1">Warm-intro paths</h2>
      </header>

      <p className="mt-1 text-[12.5px] text-fg-3">
        Your warmest way into each live deal — routed from your own relationships, ranked by how
        strong, deep, and recent the connection is.
      </p>

      <ul className="mt-3 space-y-1.5">
        {paths.map((p) => (
          <li
            key={`${p.dealId}-${p.connectorId}`}
            className="flex items-center gap-3 rounded-[10px] border border-hairline bg-bg-1 px-3 py-2"
          >
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-1.5 truncate text-[13px] font-medium text-fg-1">
                <span className="truncate">{p.dealName}</span>
                <ArrowRight size={12} className="flex-none text-fg-4" aria-hidden />
                <span className="truncate text-fg-2">{p.connectorName}</span>
              </div>
              <div className="truncate text-[11.5px] text-fg-4">
                {p.reason}
                {p.altPaths > 0 ? ` · +${p.altPaths} other path${p.altPaths === 1 ? '' : 's'}` : ''}
              </div>
            </div>
            <span
              className={`flex-none rounded-full border px-2 py-0.5 text-[10.5px] font-semibold tabular-nums ${warmthTone(p.warmth)}`}
            >
              {p.warmth}
            </span>
          </li>
        ))}
      </ul>
    </section>
  );
}
