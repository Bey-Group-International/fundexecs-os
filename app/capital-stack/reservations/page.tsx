import type { Metadata } from 'next';
import { AuthedShell } from '@/components/shell/AuthedShell';
import { getRaiseLeads } from '@/lib/queries/raise-leads';
import { ReservationsInbox } from '@/components/capital-stack/ReservationsInbox';

export const dynamic = 'force-dynamic';

export const metadata: Metadata = {
  title: 'Reservations & verification',
  description:
    'Inbound raise leads and reservations, with accredited-investor verification review for 506(c) raises.'
};

/**
 * Reservations & accreditation-verification inbox. Owner/admin review of inbound
 * raise leads: reservation payment status plus the 506(c) accredited-investor
 * verification workflow (verify / reject). RLS scopes reads + the decision write
 * to the org's owners/admins.
 */
export default async function ReservationsPage() {
  const data = await getRaiseLeads().catch(() => ({
    leads: [],
    counts: { total: 0, reserved: 0, pendingVerification: 0, verified: 0 }
  }));

  return (
    <AuthedShell
      title="Reservations & verification"
      subtitle="Capital Formation"
      redirectFrom="/capital-stack/reservations"
    >
      <div className="mx-auto max-w-3xl px-4 py-8 sm:px-6">
        <ReservationsInbox data={data} />
      </div>
    </AuthedShell>
  );
}
