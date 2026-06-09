import type { Metadata } from 'next';
import Link from 'next/link';
import { Building2 } from 'lucide-react';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { EmptyState } from '@/components/shell/EmptyState';
import { MaterialsStudio } from '@/components/materials';
import { getActiveOrg } from '@/lib/queries/org';
import { getMaterialsStudioData } from '@/lib/queries/materials';

const ROUTE = '/materials';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Capital Materials Studio',
  description:
    'Generate, edit, version, mark ready, copy, and download capital materials from live Source-of-Truth fields.'
};

export default async function MaterialsPage() {
  const org = await getActiveOrg().catch(() => null);

  if (!org) {
    return (
      <AuthedShell
        title="Capital Materials Studio"
        subtitle="Capital Formation"
        redirectFrom={ROUTE}
      >
        <EmptyState
          icon={Building2}
          title="Create or join a workspace"
          body="Materials are generated from your active organization's Source of Truth, capital stack, and raise record."
          action={
            <Link
              href="/onboarding"
              className="inline-flex items-center justify-center rounded-xl border border-transparent bg-azure-1 px-4 py-2.5 text-sm font-medium text-white transition hover:brightness-110"
            >
              Start onboarding
            </Link>
          }
        />
      </AuthedShell>
    );
  }

  const data = await getMaterialsStudioData(org.orgId);

  return (
    <AuthedShell title="Capital Materials Studio" subtitle="Capital Formation" redirectFrom={ROUTE}>
      <MaterialsStudio data={data} />
    </AuthedShell>
  );
}
