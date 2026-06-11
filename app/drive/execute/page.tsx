import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { ExecuteClosingsFlow } from '@/components/execute-closings/ExecuteClosingsFlow';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Execute · Closings',
  description:
    'Drive every engagement to a signed close. The signature room where a deal, fund close, or LP subscription moves through its execution steps — sign, escrow, conditions, wire, record — each approved by you and logged to the Chain of Trust.'
};

/**
 * Execute · Closings — the prototype's signature room ported in: an ordered
 * execution timeline per closing (deal close, fund close, LP subscription) with
 * a close-readiness header, sequential one-at-a-time approval, and a copiloted
 * step drawer that executes each step and seals it to the Chain of Trust.
 * Illustrative (client-side, no execution writes) until a closings schema lands.
 */
export default async function ExecuteClosingsPage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AuthedShell title="Execute · Closings" subtitle="Drive" redirectFrom="/drive/execute">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <Card className="p-10 text-center">
            <h2 className="text-[15px] font-semibold text-fg-1">No workspace yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
              Your workspace is being set up. Refresh in a moment to drive your closings.
            </p>
          </Card>
        </div>
      </AuthedShell>
    );
  }

  const profile = await getFundProfile(org.orgId).catch(() => null);

  return (
    <AuthedShell title="Execute · Closings" subtitle="Drive" redirectFrom="/drive/execute">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <ExecuteClosingsFlow firm={profile?.fundName || 'your fund'} />
      </div>
    </AuthedShell>
  );
}
