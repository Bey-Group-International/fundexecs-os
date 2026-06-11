import type { Metadata } from 'next';
import Link from 'next/link';
import { redirect } from 'next/navigation';
import { Cpu } from 'lucide-react';
import { StartDiligence, type DiligenceDealOption } from '@/components/run/StartDiligence';
import { Badge } from '@/components/ui/Badge';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { convictionTone, statusLabel, statusTone } from '@/lib/diligence-ui';
import { getDiligenceRuns } from '@/lib/queries/diligence';
import { getActiveOrg } from '@/lib/queries/org';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Diligence',
  description:
    "Earn's investment committee — six analyst agents and a synthesis verdict over your deal documents. Ask your documents what matters; get an institutional-grade answer."
};

function formatDate(iso: string): string {
  try {
    return new Date(iso).toLocaleDateString('en-US', {
      month: 'short',
      day: 'numeric',
      year: 'numeric'
    });
  } catch {
    return iso;
  }
}

/**
 * Diligence — the Run hub's centerpiece, on the real Diligence Intelligence
 * Layer: runs listed from `diligence_runs` (member-read RLS), and new reviews
 * started through the approve loop over `runDiligenceForDeal` (the full
 * 7-agent orchestration, which also closes the loop into readiness).
 */
export default async function RunDiligencePage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const supabase = await createClient();
  const [runs, { data: dealRows }] = await Promise.all([
    getDiligenceRuns(org.orgId),
    supabase
      .from('deals')
      .select('id, name, stage')
      .eq('org_id', org.orgId)
      .neq('stage', 'closed')
      .order('created_at', { ascending: false })
      .limit(12)
  ]);

  const deals: DiligenceDealOption[] = (dealRows ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    stage: d.stage
  }));

  return (
    <div className="fx-rise mx-auto flex max-w-[920px] flex-col gap-4">
      {/* hero */}
      <Card className="p-5">
        <div className="flex items-center gap-3">
          <span className="flex h-11 w-11 flex-none items-center justify-center rounded-[12px] border border-[var(--accent-line)] bg-[var(--accent-soft)] text-[var(--accent)]">
            <Cpu size={22} strokeWidth={1.9} aria-hidden />
          </span>
          <div className="min-w-0 flex-1">
            <h1 className="text-[19px] font-semibold tracking-[-0.015em] text-fg-1">Diligence</h1>
            <p className="mt-0.5 text-[12.5px] text-fg-3">
              Earn&apos;s investment committee — six analysts and a synthesis verdict over your deal
              documents.
            </p>
          </div>
          <div className="flex-none text-right">
            <div className="text-[22px] font-semibold tabular-nums text-gold-1">{runs.length}</div>
            <div className="text-[10.5px] text-fg-5">runs on record</div>
          </div>
        </div>
      </Card>

      <StartDiligence deals={deals} />

      {/* the record */}
      {runs.length === 0 ? (
        <Card className="p-8 text-center">
          <Cpu size={22} className="mx-auto text-fg-4" aria-hidden />
          <h2 className="mt-3 text-[15px] font-semibold text-fg-1">No diligence runs yet</h2>
          <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
            Pick a deal above and Earn&apos;s committee reviews it like an institutional LP — every
            verdict lands here, on the record.
          </p>
        </Card>
      ) : (
        <div className="flex flex-col gap-2.5">
          {runs.map((run) => (
            <Link key={run.id} href={`/run/diligence/${run.id}`} className="block">
              <Card clickable className="flex items-center gap-4 p-4">
                <div className="min-w-0 flex-1">
                  <div className="truncate text-[13.5px] font-semibold text-fg-1">
                    {run.summary || 'Diligence review'}
                  </div>
                  <div className="mt-1 text-[11px] text-fg-4">
                    {formatDate(run.createdAt)} · {run.findingCount}{' '}
                    {run.findingCount === 1 ? 'finding' : 'findings'}
                  </div>
                </div>
                <Badge tone={statusTone(run.status)} className="flex-none text-[10px]">
                  {statusLabel(run.status)}
                </Badge>
                {run.conviction != null ? (
                  <Badge tone={convictionTone(run.conviction)} className="flex-none text-[10px]">
                    Conviction {run.conviction}
                  </Badge>
                ) : null}
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Card className="flex items-center gap-3 border-[var(--gold-line)] bg-[var(--gold-soft)] p-4">
        <EarnCoin size={26} className="flex-none" />
        <p className="flex-1 text-[12.5px] leading-relaxed text-fg-2">
          <b className="text-gold-1">Earn:</b> Six layers automate; the seventh is why you get paid.
          The analysts score the evidence — the synthesis is the judgment call, prepared for yours.
        </p>
      </Card>
    </div>
  );
}
