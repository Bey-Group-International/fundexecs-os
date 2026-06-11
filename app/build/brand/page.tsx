import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { Card } from '@/components/ui';
import { getActiveOrg } from '@/lib/queries/org';
import { getFundProfile } from '@/lib/queries/fund-profile';
import { BrandStudioFlow } from '@/components/brand-studio/BrandStudioFlow';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Profile & Brand',
  description:
    'The public face of your raise — your GP profile, firm brand kit, and digital presence, produced copiloted from your fund story. You set the posture; Earn produces it.'
};

/**
 * Profile & Brand — the prototype's brand surface ported in: the GP profile
 * preview, the firm brand kit (palette, aesthetic, voice), and the digital
 * presence grid, each produced through a copiloted builder (you set the posture,
 * Earn produces it). Illustrative (client-side, no brand/profile writes) until a
 * brand schema lands.
 */
export default async function BrandPage() {
  const org = await getActiveOrg();

  if (!org) {
    return (
      <AuthedShell title="Profile & Brand" subtitle="Build" redirectFrom="/build/brand">
        <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
          <Card className="p-10 text-center">
            <h2 className="text-[15px] font-semibold text-fg-1">No workspace yet</h2>
            <p className="mx-auto mt-2 max-w-md text-[12.5px] text-fg-4">
              Your workspace is being set up. Refresh in a moment to build your profile and brand.
            </p>
          </Card>
        </div>
      </AuthedShell>
    );
  }

  const profile = await getFundProfile(org.orgId).catch(() => null);

  return (
    <AuthedShell title="Profile & Brand" subtitle="Build" redirectFrom="/build/brand">
      <div className="mx-auto max-w-5xl px-4 py-8 sm:px-6">
        <BrandStudioFlow
          firm={profile?.fundName || 'your fund'}
          principal={profile?.managerName || 'Managing Partner'}
        />
      </div>
    </AuthedShell>
  );
}
