'use client';

import { ShieldCheck } from 'lucide-react';
import { Badge } from '@/components/ui';
import { useTrustDrawer } from '@/components/shell/trust/TrustDrawerHost';
import type { DealTrustRef } from '@/lib/queries/dashboard';
import { trustLayerMeta } from '@/components/shell/trust/trust-layers';

export interface DealTrustChipProps {
  dealId: string;
  dealName: string;
  trustRef?: DealTrustRef | null;
}

/**
 * DealTrustChip — small clickable chip rendered next to a deal row.
 *
 *  - With an existing trust record → shows "Trust · {pct}%" tinted to the
 *    current layer hue. Click opens the drawer at that record.
 *  - Without a trust record → shows "Start CoT". Click opens the drawer in
 *    starter mode for `entity_type='deal', entity_id=dealId, title=dealName`,
 *    which creates the chain on confirm.
 */
export function DealTrustChip({ dealId, dealName, trustRef }: DealTrustChipProps) {
  const drawer = useTrustDrawer();

  if (trustRef) {
    const meta = trustLayerMeta(trustRef.currentLayerKey);
    return (
      <button
        type="button"
        onClick={() => drawer.open({ recordId: trustRef.recordId })}
        data-testid={`deal-trust-chip-${dealId}`}
        className="inline-flex items-center gap-1.5 rounded-full border px-2 py-0.5 text-[10px] font-semibold transition hover:brightness-110"
        style={{
          background: meta.soft,
          borderColor: meta.line,
          color: meta.color
        }}
        title={`${trustRef.currentLayer} · ${trustRef.completionPercentage}%`}
      >
        <ShieldCheck size={11} strokeWidth={2.1} aria-hidden />
        Trust · {trustRef.completionPercentage}%
      </button>
    );
  }

  return (
    <button
      type="button"
      onClick={() =>
        drawer.open({
          starter: {
            subjectEntityType: 'deal',
            subjectEntityId: dealId,
            title: dealName
          }
        })
      }
      data-testid={`deal-trust-start-${dealId}`}
      className="inline-flex items-center gap-1.5 rounded-full border border-dashed border-hairline px-2 py-0.5 text-[10px] font-semibold text-fg-4 transition hover:border-azure-1/40 hover:text-azure-1"
    >
      <ShieldCheck size={11} strokeWidth={2.1} aria-hidden />
      Start CoT
    </button>
  );
}

export interface DealTrustChipFromRefsProps {
  dealId: string;
  dealName: string;
  refs: DealTrustRef[];
}

/**
 * Convenience wrapper: resolves the matching ref from a precomputed list
 * (typed array passed down from the server payload) and renders the chip.
 */
export function DealTrustChipFromRefs({ dealId, dealName, refs }: DealTrustChipFromRefsProps) {
  const trustRef = refs.find((r) => r.dealId === dealId) ?? null;
  return <DealTrustChip dealId={dealId} dealName={dealName} trustRef={trustRef} />;
}

/** Render a Badge tone for a deal's trust state — used in cards/list rows. */
export function trustBadgeTone(ref: DealTrustRef | null | undefined) {
  if (!ref) return 'neutral' as const;
  if (ref.completionPercentage >= 100) return 'success' as const;
  if (ref.completionPercentage >= 50) return 'azure' as const;
  return 'gold' as const;
}

export function TrustBadgeFromRef({ trustRef }: { trustRef: DealTrustRef | null }) {
  if (!trustRef) return null;
  return (
    <Badge tone={trustBadgeTone(trustRef)} className="text-[9.5px] uppercase">
      Trust {trustRef.completionPercentage}%
    </Badge>
  );
}
