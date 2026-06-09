import { ShieldCheck, Calendar, AlertTriangle, Radar, Check } from 'lucide-react';
import { Badge, Card, SectionTitle, type BadgeTone } from '@/components/ui';
import { cn } from '@/lib/utils';
import type {
  ComplianceLane as ComplianceLaneData,
  ComplianceObjective
} from '@/lib/queries/compliance';

/**
 * The standing compliance tier on `/strategy` (blueprint Phase 4): a permanent,
 * never-empty lane owned by Adrian (GC/Compliance), seeded with baseline RIA /
 * exempt-reporting cadence and refreshed from SEC filing signals. Visually
 * distinct from the 100/30/10 plan — its own eyebrow, a left accent rail, and a
 * shield mark — so it reads as the always-on compliance backbone, not another
 * checklist horizon. Read-only and tokens-only; it degrades to its own empty
 * state (still owned by Adrian) but in practice the loader guarantees a seed.
 */
export interface ComplianceLaneProps {
  lane: ComplianceLaneData;
}

const PRIORITY_TONE: Record<ComplianceObjective['priority'], BadgeTone> = {
  High: 'warning',
  Medium: 'azure',
  Low: 'neutral'
};

function ComplianceRow({ o }: { o: ComplianceObjective }) {
  const done = o.state === 'done';
  return (
    <div
      className={cn(
        'flex items-start gap-3 rounded-[12px] border border-hairline bg-surface-1 p-3.5',
        done && 'opacity-60'
      )}
    >
      <span
        className="mt-px flex h-[26px] w-[26px] flex-none items-center justify-center rounded-md border border-[var(--azure-line)] bg-[var(--azure-soft)] text-azure-1"
        aria-hidden
      >
        {done ? (
          <Check size={13} strokeWidth={2} />
        ) : o.source === 'signal' ? (
          <Radar size={13} strokeWidth={1.9} />
        ) : (
          <ShieldCheck size={13} strokeWidth={1.9} />
        )}
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className={cn('text-[13.5px] font-semibold text-fg-1', done && 'line-through')}>
            {o.title}
          </span>
          <Badge tone={PRIORITY_TONE[o.priority]} className="text-[10px]">
            {o.priority} priority
          </Badge>
          {o.escalated && (
            <Badge tone="warning" className="flex items-center gap-1 text-[10px]">
              <AlertTriangle size={10} strokeWidth={2} aria-hidden />
              Overdue
            </Badge>
          )}
          {o.source === 'signal' && (
            <Badge tone="azure" className="text-[10px]">
              From SEC filing
            </Badge>
          )}
        </div>
        <div className="mt-1.5 flex flex-wrap items-center gap-x-4 gap-y-1 text-[11.5px] text-fg-4">
          <span className="flex items-center gap-1.5">
            <Calendar size={12} strokeWidth={1.9} aria-hidden />
            {o.timeline ?? 'Ongoing'}
          </span>
        </div>
        {o.ai && <p className="mt-1.5 text-[11px] leading-relaxed text-fg-5">{o.ai}</p>}
      </div>
    </div>
  );
}

export function ComplianceLane({ lane }: ComplianceLaneProps) {
  const { ownerName, ownerRole, objectives, highCount } = lane;

  return (
    <Card className="border-l-[3px] border-l-[var(--azure-line)] p-[18px]">
      <SectionTitle
        eyebrow="Standing compliance · maintained by Adrian"
        title="Always-on compliance tier"
        className="mb-3"
        action={
          highCount > 0 ? (
            <Badge tone="warning" dot>
              {highCount} need{highCount === 1 ? 's' : ''} attention
            </Badge>
          ) : (
            <Badge tone="success" dot>
              On track
            </Badge>
          )
        }
      />

      <div className="flex items-start gap-2 text-[11.5px] leading-relaxed text-fg-4">
        <ShieldCheck
          size={13}
          strokeWidth={1.9}
          className="mt-px flex-none text-azure-1"
          aria-hidden
        />
        <p className="max-w-2xl">
          <span className="font-semibold text-fg-2">
            {ownerName}, {ownerRole}
          </span>{' '}
          keeps this lane live — baseline filing cadence plus follow-ups drafted off live SEC
          filings. Items left unaddressed escalate to High on their own. This feeds the Compliance
          pillar of your Institutional Posture.
        </p>
      </div>

      {objectives.length === 0 ? (
        <div className="mt-4 rounded-[12px] border border-hairline bg-surface-1 p-6 text-center text-[12.5px] text-fg-4">
          Adrian is standing up your compliance cadence. Check back shortly.
        </div>
      ) : (
        <div className="mt-4 flex flex-col gap-2.5">
          {objectives.map((o) => (
            <ComplianceRow key={o.id} o={o} />
          ))}
        </div>
      )}
    </Card>
  );
}
