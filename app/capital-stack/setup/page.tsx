import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { getActiveRaisePage } from '@/lib/queries/raise-page';
import { RaiseSetupWizard } from '@/components/capital-stack/RaiseSetupWizard';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Raise setup',
  description:
    'Guided setup for your public raise page — terms, sizing, Reg D exemption, and publish.'
};

/**
 * Guided raise-setup wizard (W4). Walks an owner from blank to a published
 * raise page (Terms → Sizing → Compliance → Review), seeded from any existing
 * active page so it doubles as an editor. The Compliance step explains Reg D
 * 506(b)/(c) and routes to legal counsel in the partner directory.
 */
export default async function RaiseSetupPage() {
  const raisePage = await getActiveRaisePage().catch(() => null);

  return (
    <AuthedShell
      title="Raise setup"
      subtitle="Capital Formation"
      redirectFrom="/capital-stack/setup"
    >
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <RaiseSetupWizard initial={raisePage} />
      </div>
    </AuthedShell>
  );
}
