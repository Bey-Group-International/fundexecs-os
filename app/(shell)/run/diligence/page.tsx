import type { Metadata } from 'next';
import { redirect } from 'next/navigation';
import { FileSearch } from 'lucide-react';
import { StartDiligence, type DiligenceDealOption } from '@/components/run/StartDiligence';
import { Card } from '@/components/ui/Card';
import { EarnCoin } from '@/components/ui/EarnCoin';
import { getDiligenceRuns } from '@/lib/queries/diligence';
import { getActiveOrg } from '@/lib/queries/org';
import { createClient } from '@/lib/supabase/server';

export const metadata: Metadata = {
  title: 'Diligence',
  description:
    "Earn's investment committee — six analyst agents and a synthesis verdict over your deal documents. Ask your documents what matters; get an institutional-grade answer."
};

/**
 * /run/diligence resolves to the active (latest) run — the prototype's
 * Diligence tab opens on a deal, and every run keeps its deep link at
 * /run/diligence/[runId]. With no runs yet, this is the honest empty state
 * and the committee's starting point.
 */
export default async function RunDiligencePage() {
  const org = await getActiveOrg();
  if (!org) redirect('/onboarding');

  const runs = await getDiligenceRuns(org.orgId);
  if (runs.length > 0) redirect(`/run/diligence/${runs[0].id}`);

  const supabase = await createClient();
  const { data: dealRows } = await supabase
    .from('deals')
    .select('id, name, stage')
    .eq('org_id', org.orgId)
    .neq('stage', 'closed')
    .order('created_at', { ascending: false })
    .limit(12);

  const deals: DiligenceDealOption[] = (dealRows ?? []).map((d) => ({
    id: d.id,
    name: d.name,
    stage: d.stage
  }));

  return (
    <div className="flex flex-col gap-4">
      <Card className="p-8 text-center">
        <FileSearch size={22} className="mx-auto text-fg-4" aria-hidden />
        <h2 className="mt-3 text-[15px] font-semibold text-fg-1">No diligence runs yet</h2>
        <p className="mx-auto mt-1.5 max-w-md text-[12.5px] leading-relaxed text-fg-4">
          Pick a deal below and Earn&apos;s committee reviews it like an institutional LP — six
          analysts, a verdict ladder, and a risk register you resolve together. Every verdict lands
          on the record with its own link.
        </p>
      </Card>

      <StartDiligence deals={deals} />

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
